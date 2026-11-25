import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import {
  db,
  activitiesTable,
  callsTable,
  leadsTable,
  outreachConversationsTable,
  tasksTable,
} from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import {
  CreateLeadBody,
  DeleteLeadParams,
  EnrichLeadParams,
  EnrichLeadResponse,
  QualifyLeadsBody,
  QualifyLeadsResponse,
  GetLeadParams,
  GetLeadResponse,
  ImportLeadsBody,
  ImportLeadsResponse,
  ListLeadsQueryParams,
  ListLeadsResponse,
  UpdateLeadBody,
  UpdateLeadParams,
  UpdateLeadResponse,
} from "@workspace/api-zod";
import { qualifyLead, researchCompany } from "../lib/ai";
import { serializeTasks } from "./tasks";
import {
  getSettings,
  leadName,
  logActivity,
  serializeCalls,
  serializeConversations,
  serializeLeads,
} from "../lib/outreach";

const router: IRouter = Router();

router.get("/leads", async (req, res): Promise<void> => {
  const q = ListLeadsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [];
  if (q.data.status) conds.push(eq(leadsTable.status, q.data.status));
  if (q.data.campaignId) conds.push(eq(leadsTable.campaignId, q.data.campaignId));
  if (q.data.search) {
    const s = `%${q.data.search}%`;
    conds.push(
      or(
        ilike(leadsTable.firstName, s),
        ilike(leadsTable.lastName, s),
        ilike(leadsTable.email, s),
        ilike(leadsTable.company, s),
        ilike(leadsTable.title, s),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(leadsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leadsTable.createdAt));
  res.json(ListLeadsResponse.parse(await serializeLeads(rows)));
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lead] = await db.insert(leadsTable).values(parsed.data).returning();
  await logActivity({ type: "lead_added", description: `${leadName(lead!)} added`, leadId: lead!.id });
  const [out] = await serializeLeads([lead!]);
  res.status(201).json(out);
});

router.post("/leads/import", async (req, res): Promise<void> => {
  const parsed = ImportLeadsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const valid = parsed.data.leads.filter((l) => l.firstName?.trim());
  if (valid.length) {
    await db.insert(leadsTable).values(
      valid.map((l) => ({ ...l, campaignId: parsed.data.campaignId ?? l.campaignId ?? null })),
    );
    await logActivity({ type: "lead_added", description: `${valid.length} leads imported` });
  }
  res.json(
    ImportLeadsResponse.parse({ imported: valid.length, skipped: parsed.data.leads.length - valid.length }),
  );
});

const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|yandex|zoho)\./i;

function websiteFor(lead: typeof leadsTable.$inferSelect): string | null {
  if (lead.website?.trim()) return /^https?:\/\//.test(lead.website) ? lead.website.trim() : `https://${lead.website.trim()}`;
  if (lead.email && !FREE_MAIL.test(lead.email)) return `https://${lead.email.split("@")[1]}`;
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

router.post("/leads/qualify", async (req, res): Promise<void> => {
  const parsed = QualifyLeadsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getSettings();
  if (!settings.icpDescription.trim()) {
    res.status(400).json({ error: "Describe your ideal customer profile in Settings first" });
    return;
  }
  const leads = parsed.data.leadIds?.length
    ? await db.select().from(leadsTable).where(inArray(leadsTable.id, parsed.data.leadIds))
    : await db.select().from(leadsTable).where(isNull(leadsTable.fitScore));
  const results = await batchProcess(
    leads,
    async (lead) => {
      const r = await qualifyLead({ lead, icp: settings.icpDescription, settings });
      await db.update(leadsTable).set({ fitScore: r.score, fitReason: r.reason }).where(eq(leadsTable.id, lead.id));
      return r;
    },
    { concurrency: 3, retries: 2 },
  );
  if (leads.length) {
    await logActivity({ type: "lead_qualified", description: `AI scored ${results.length} leads against your ICP` });
  }
  res.json(QualifyLeadsResponse.parse({ qualified: results.length }));
});

router.post("/leads/:id/enrich", async (req, res): Promise<void> => {
  const params = EnrichLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const site = websiteFor(lead);
  if (!site) {
    res.status(400).json({ error: "Add the company website (or a work email) to research this lead" });
    return;
  }
  let pageText: string;
  try {
    const page = await fetch(site, { signal: AbortSignal.timeout(12_000), headers: { "user-agent": "Mozilla/5.0 (compatible; OutreachAutopilot/1.0)" } });
    if (!page.ok) throw new Error(`HTTP ${page.status}`);
    pageText = htmlToText(await page.text()).slice(0, 6000);
  } catch (err) {
    res.status(400).json({ error: `Could not read ${site}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (pageText.length < 40) {
    res.status(400).json({ error: `${site} has too little readable text to research` });
    return;
  }
  const r = await researchCompany({ lead, website: site, pageText });
  const research = `Research (${new Date().toISOString().slice(0, 10)}): ${r.summary}${r.hooks.length ? `\nHooks:\n${r.hooks.map((h) => `- ${h}`).join("\n")}` : ""}`;
  const notes = [lead.notes?.replace(/\n?Research \(\d{4}-\d{2}-\d{2}\):[\s\S]*$/, "").trim(), research].filter(Boolean).join("\n\n");
  const [updated] = await db
    .update(leadsTable)
    .set({ website: site, industry: lead.industry || r.industry, notes })
    .where(eq(leadsTable.id, lead.id))
    .returning();
  await logActivity({ type: "lead_enriched", description: `AI researched ${leadName(lead)} from ${site}`, leadId: lead.id });
  const [out] = await serializeLeads([updated!]);
  res.json(EnrichLeadResponse.parse(out));
});

router.get("/leads/:id", async (req, res): Promise<void> => {
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const [base] = await serializeLeads([lead]);
  const convs = await db
    .select()
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.leadId, lead.id))
    .orderBy(desc(outreachConversationsTable.lastMessageAt));
  const calls = await db
    .select()
    .from(callsTable)
    .where(eq(callsTable.leadId, lead.id))
    .orderBy(desc(callsTable.createdAt));
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.leadId, lead.id))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(50);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.leadId, lead.id)).orderBy(asc(tasksTable.done), desc(tasksTable.createdAt));
  res.json(
    GetLeadResponse.parse({
      ...base,
      conversations: await serializeConversations(convs),
      calls: await serializeCalls(calls),
      activity: activity.map((a) => ({ ...a, leadName: leadName(lead) })),
      tasks: await serializeTasks(tasks),
    }),
  );
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const params = UpdateLeadParams.safeParse(req.params);
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [before] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!before) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const changes: Partial<typeof leadsTable.$inferInsert> = { ...parsed.data };
  // Moving a lead to a different campaign restarts its sequence.
  if (parsed.data.campaignId !== undefined && parsed.data.campaignId !== before.campaignId) {
    changes.currentStep = 0;
    changes.nextStepAt = null;
  }
  const [lead] = await db
    .update(leadsTable)
    .set(changes)
    .where(eq(leadsTable.id, params.data.id))
    .returning();
  if (parsed.data.status && parsed.data.status !== before.status) {
    await logActivity({
      type: "status_change",
      description: `${leadName(lead!)} marked ${parsed.data.status.replace("_", " ")}`,
      leadId: lead!.id,
    });
  }
  const [out] = await serializeLeads([lead!]);
  res.json(UpdateLeadResponse.parse(out));
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const params = DeleteLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
