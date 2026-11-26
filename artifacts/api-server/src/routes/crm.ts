import { Router, type IRouter } from "express";
import { ilike, inArray, or } from "drizzle-orm";
import { db, accountsTable, dealsTable, leadsTable } from "@workspace/db";
import { GetCrmReportResponse, GlobalSearchQueryParams, GlobalSearchResponse } from "@workspace/api-zod";
import { STAGES, isClosed } from "../lib/crm";
import { getSettings, leadName } from "../lib/outreach";

const router: IRouter = Router();

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

router.get("/crm/report", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  const deals = await db.select().from(dealsTable);
  const now = new Date();
  const monthStart = addMonths(now, 0);
  const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));

  const open = deals.filter((d) => !isClosed(d.stage));
  const won = deals.filter((d) => d.stage === "closed_won");
  const lost = deals.filter((d) => d.stage === "closed_lost");
  const sum = (xs: typeof deals) => xs.reduce((s, d) => s + d.amount, 0);
  const wonSince = (from: Date) => sum(won.filter((d) => d.closedAt && d.closedAt >= from));
  const weighted = (d: (typeof deals)[number]) => Math.round((d.amount * d.probability) / 100);

  const forecast = Array.from({ length: 6 }, (_, i) => monthKey(addMonths(now, i))).map((month) => {
    // Open deals with an overdue or missing close date count toward this month.
    const inMonth = open.filter((d) => monthKey(d.closeDate && d.closeDate > monthStart ? d.closeDate : monthStart) === month);
    return {
      month,
      weighted: inMonth.reduce((s, d) => s + weighted(d), 0),
      open: sum(inMonth),
      won: sum(won.filter((d) => d.closedAt && monthKey(d.closedAt) === month)),
    };
  });
  const trend = Array.from({ length: 6 }, (_, i) => monthKey(addMonths(now, i - 5))).map((month) => {
    const w = won.filter((d) => d.closedAt && monthKey(d.closedAt) === month);
    return { month, wonCount: w.length, lostCount: lost.filter((d) => d.closedAt && monthKey(d.closedAt) === month).length, wonAmount: sum(w) };
  });

  const byAccount = new Map<number, { wonValue: number; pipelineValue: number }>();
  for (const d of deals) {
    if (d.accountId == null || d.stage === "closed_lost") continue;
    const e = byAccount.get(d.accountId) ?? { wonValue: 0, pipelineValue: 0 };
    if (d.stage === "closed_won") e.wonValue += d.amount;
    else e.pipelineValue += d.amount;
    byAccount.set(d.accountId, e);
  }
  const topIds = [...byAccount.entries()].sort((a, b) => b[1].wonValue + b[1].pipelineValue - (a[1].wonValue + a[1].pipelineValue)).slice(0, 5).map(([id]) => id);
  const names = topIds.length ? await db.select({ id: accountsTable.id, name: accountsTable.name }).from(accountsTable).where(inArray(accountsTable.id, topIds)) : [];
  const cycles = won.filter((d) => d.closedAt).map((d) => (d.closedAt!.getTime() - d.createdAt.getTime()) / 86_400_000);

  res.json(
    GetCrmReportResponse.parse({
      currency: settings.currency,
      openPipeline: sum(open),
      weightedPipeline: open.reduce((s, d) => s + weighted(d), 0),
      openDeals: open.length,
      wonThisMonth: wonSince(monthStart),
      wonThisQuarter: wonSince(quarterStart),
      winRate: won.length + lost.length ? won.length / (won.length + lost.length) : 0,
      avgDealSize: won.length ? Math.round(sum(won) / won.length) : 0,
      avgCycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : 0,
      byStage: STAGES.map((stage) => {
        const xs = deals.filter((d) => d.stage === stage);
        return { stage, count: xs.length, amount: sum(xs) };
      }),
      forecast,
      trend,
      topAccounts: topIds.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? "Account", ...byAccount.get(id)! })),
    }),
  );
});

router.get("/search", async (req, res): Promise<void> => {
  const q = GlobalSearchQueryParams.safeParse(req.query);
  if (!q.success || !q.data.q.trim()) {
    res.json([]);
    return;
  }
  const s = `%${q.data.q.trim()}%`;
  const [leads, accounts, deals] = await Promise.all([
    db.select().from(leadsTable).where(or(ilike(leadsTable.firstName, s), ilike(leadsTable.lastName, s), ilike(leadsTable.email, s), ilike(leadsTable.company, s))).limit(6),
    db.select().from(accountsTable).where(or(ilike(accountsTable.name, s), ilike(accountsTable.website, s))).limit(6),
    db.select().from(dealsTable).where(ilike(dealsTable.name, s)).limit(6),
  ]);
  res.json(
    GlobalSearchResponse.parse([
      ...accounts.map((a) => ({ kind: "account", id: a.id, title: a.name, subtitle: [a.industry, a.location].filter(Boolean).join(" · ") || null })),
      ...deals.map((d) => ({ kind: "deal", id: d.id, title: d.name, subtitle: d.stage.replace(/_/g, " ") })),
      ...leads.map((l) => ({ kind: "lead", id: l.id, title: leadName(l), subtitle: [l.title, l.company].filter(Boolean).join(" at ") || l.email })),
    ]),
  );
});

export default router;
