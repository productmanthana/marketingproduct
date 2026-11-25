import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  db,
  activitiesTable,
  callsTable,
  leadsTable,
  outreachConversationsTable,
} from "@workspace/db";
import {
  CreateLeadBody,
  DeleteLeadParams,
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
import {
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
  res.json(
    GetLeadResponse.parse({
      ...base,
      conversations: await serializeConversations(convs),
      calls: await serializeCalls(calls),
      activity: activity.map((a) => ({ ...a, leadName: leadName(lead) })),
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
