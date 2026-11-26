import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, accountsTable, activitiesTable, dealsTable, leadsTable, notesTable, tasksTable } from "@workspace/db";
import {
  ConvertLeadBody,
  ConvertLeadParams,
  ConvertLeadResponse,
  CreateDealBody,
  CreateNoteBody,
  DeleteDealParams,
  DeleteNoteParams,
  GetDealInsightParams,
  GetDealInsightResponse,
  GetDealParams,
  GetDealResponse,
  ListDealsQueryParams,
  ListDealsResponse,
  UpdateDealBody,
  UpdateDealParams,
  UpdateDealResponse,
} from "@workspace/api-zod";
import { dealInsight } from "../lib/ai";
import { STAGE_PROBABILITY, createDealForLead, isClosed, serializeDeals, stageLabel, type Stage } from "../lib/crm";
import { getSettings, leadName, logActivity } from "../lib/outreach";
import { serializeTasks } from "./tasks";

const router: IRouter = Router();

router.get("/deals", async (req, res): Promise<void> => {
  const q = ListDealsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [];
  if (q.data.stage) conds.push(eq(dealsTable.stage, q.data.stage));
  if (q.data.accountId) conds.push(eq(dealsTable.accountId, q.data.accountId));
  if (q.data.leadId) conds.push(eq(dealsTable.leadId, q.data.leadId));
  if (q.data.search) {
    const s = `%${q.data.search}%`;
    conds.push(or(ilike(dealsTable.name, s), ilike(dealsTable.nextStep, s), ilike(accountsTable.name, s))!);
  }
  const rows = await db
    .select({ deal: dealsTable })
    .from(dealsTable)
    .leftJoin(accountsTable, eq(dealsTable.accountId, accountsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(dealsTable.closeDate), desc(dealsTable.createdAt));
  res.json(ListDealsResponse.parse(await serializeDeals(rows.map((r) => r.deal))));
});

router.post("/deals", async (req, res): Promise<void> => {
  const parsed = CreateDealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const stage = (parsed.data.stage ?? "prospecting") as Stage;
  let accountId = parsed.data.accountId ?? null;
  // A deal for a contact defaults to that contact's account.
  if (accountId == null && parsed.data.leadId) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, parsed.data.leadId));
    accountId = lead?.accountId ?? null;
  }
  const settings = await getSettings();
  const [deal] = await db
    .insert(dealsTable)
    .values({
      ...parsed.data,
      name: parsed.data.name.trim(),
      accountId,
      stage,
      probability: parsed.data.probability ?? STAGE_PROBABILITY[stage],
      ownerName: parsed.data.ownerName || settings.senderName,
      closedAt: isClosed(stage) ? new Date() : null,
    })
    .returning();
  await logActivity({ type: "deal_created", description: `Deal ${deal!.name} created`, leadId: deal!.leadId, accountId: deal!.accountId, dealId: deal!.id });
  res.status(201).json((await serializeDeals([deal!]))[0]);
});

router.get("/deals/:id", async (req, res): Promise<void> => {
  const params = GetDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, params.data.id));
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const [base] = await serializeDeals([deal]);
  const notes = await db.select().from(notesTable).where(eq(notesTable.dealId, deal.id)).orderBy(desc(notesTable.createdAt));
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.dealId, deal.id)).orderBy(asc(tasksTable.done), desc(tasksTable.createdAt));
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(or(eq(activitiesTable.dealId, deal.id), deal.leadId ? eq(activitiesTable.leadId, deal.leadId) : undefined))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(60);
  res.json(
    GetDealResponse.parse({
      ...base,
      notes,
      tasks: await serializeTasks(tasks),
      activity: activity.map((a) => ({ ...a, leadName: a.leadId === deal.leadId ? base!.leadName : null })),
    }),
  );
});

router.patch("/deals/:id", async (req, res): Promise<void> => {
  const params = UpdateDealParams.safeParse(req.params);
  const parsed = UpdateDealBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [before] = await db.select().from(dealsTable).where(eq(dealsTable.id, params.data.id));
  if (!before) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const changes: Partial<typeof dealsTable.$inferInsert> = { ...parsed.data, updatedAt: new Date() };
  const stage = parsed.data.stage as Stage | undefined;
  const stageChanged = stage && stage !== before.stage;
  if (stageChanged) {
    changes.stageChangedAt = new Date();
    if (parsed.data.probability === undefined) changes.probability = STAGE_PROBABILITY[stage];
    changes.closedAt = isClosed(stage) ? new Date() : null;
    if (stage !== "closed_lost") changes.lostReason = parsed.data.lostReason ?? null;
  }
  const [deal] = await db.update(dealsTable).set(changes).where(eq(dealsTable.id, before.id)).returning();
  if (stageChanged) {
    const type = stage === "closed_won" ? "deal_won" : stage === "closed_lost" ? "deal_lost" : "deal_stage_changed";
    const description =
      stage === "closed_won"
        ? `Deal ${deal!.name} won`
        : stage === "closed_lost"
          ? `Deal ${deal!.name} lost${deal!.lostReason ? `: ${deal!.lostReason}` : ""}`
          : `Deal ${deal!.name} moved to ${stageLabel(stage)}`;
    await logActivity({ type, description, leadId: deal!.leadId, accountId: deal!.accountId, dealId: deal!.id });
    // Winning the first deal turns a prospect account into a customer.
    if (stage === "closed_won" && deal!.accountId) {
      await db.update(accountsTable).set({ type: "customer" }).where(and(eq(accountsTable.id, deal!.accountId), eq(accountsTable.type, "prospect")));
    }
  }
  res.json(UpdateDealResponse.parse((await serializeDeals([deal!]))[0]));
});

router.delete("/deals/:id", async (req, res): Promise<void> => {
  const params = DeleteDealParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(tasksTable).where(eq(tasksTable.dealId, params.data.id));
  await db.delete(dealsTable).where(eq(dealsTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/deals/:id/insight", async (req, res): Promise<void> => {
  const params = GetDealInsightParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, params.data.id));
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const [lead] = deal.leadId ? await db.select().from(leadsTable).where(eq(leadsTable.id, deal.leadId)) : [];
  const [account] = deal.accountId ? await db.select().from(accountsTable).where(eq(accountsTable.id, deal.accountId)) : [];
  const notes = await db.select().from(notesTable).where(eq(notesTable.dealId, deal.id)).orderBy(desc(notesTable.createdAt)).limit(10);
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(or(eq(activitiesTable.dealId, deal.id), deal.leadId ? eq(activitiesTable.leadId, deal.leadId) : undefined))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(20);
  const settings = await getSettings();
  try {
    const insight = await dealInsight({
      deal,
      currency: settings.currency,
      accountName: account?.name ?? null,
      lead: lead ?? null,
      notes: notes.map((n) => `- ${n.createdAt.toISOString().slice(0, 10)}: ${n.body}`),
      activity: activity.map((a) => `- ${a.createdAt.toISOString().slice(0, 10)} ${a.type}: ${a.description}`),
      settings,
    });
    res.json(GetDealInsightResponse.parse(insight));
  } catch (err) {
    req.log.error({ err }, "Deal insight failed");
    res.status(502).json({ error: "The AI could not review this deal right now. Try again." });
  }
});

router.post("/leads/:id/convert", async (req, res): Promise<void> => {
  const params = ConvertLeadParams.safeParse(req.params);
  const parsed = ConvertLeadBody.safeParse(req.body ?? {});
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const deal = await createDealForLead({
    lead,
    source: "lead_conversion",
    name: parsed.data.dealName,
    amount: parsed.data.amount,
    closeDate: parsed.data.closeDate ?? null,
    stage: parsed.data.stage as Stage | undefined,
  });
  res.status(201).json(ConvertLeadResponse.parse((await serializeDeals([deal]))[0]));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.accountId && !parsed.data.dealId)) {
    res.status(400).json({ error: parsed.error?.message ?? "A note needs an account or a deal" });
    return;
  }
  let accountId = parsed.data.accountId ?? null;
  let leadId: number | null = null;
  if (parsed.data.dealId) {
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, parsed.data.dealId));
    if (!deal) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    leadId = deal.leadId;
    accountId ??= deal.accountId;
  }
  const [note] = await db
    .insert(notesTable)
    .values({ body: parsed.data.body.trim(), accountId: parsed.data.dealId ? null : accountId, dealId: parsed.data.dealId ?? null })
    .returning();
  const [lead] = leadId ? await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)) : [];
  await logActivity({
    type: "note_added",
    description: `Note${lead ? ` on ${leadName(lead)}` : ""}: ${note!.body.slice(0, 120)}`,
    leadId,
    accountId,
    dealId: note!.dealId,
  });
  res.status(201).json(note);
});

router.delete("/notes/:id", async (req, res): Promise<void> => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(notesTable).where(eq(notesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
