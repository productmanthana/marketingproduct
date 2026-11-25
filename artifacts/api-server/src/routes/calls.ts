import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  callsTable,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  type CallRow,
} from "@workspace/db";
import {
  CreateCallBody,
  GenerateCallScriptParams,
  GetCallParams,
  GetCallResponse,
  ListCallsQueryParams,
  ListCallsResponse,
  SummarizeCallParams,
  UpdateCallBody,
  UpdateCallParams,
} from "@workspace/api-zod";
import { generateCallScript, summarizeCall } from "../lib/ai";
import {
  getOrCreateConversation,
  getSettings,
  leadName,
  logActivity,
  recordOutbound,
  serializeCalls,
} from "../lib/outreach";

const router: IRouter = Router();

async function one(call: CallRow) {
  return GetCallResponse.parse((await serializeCalls([call]))[0]);
}

async function loadContext(call: CallRow) {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, call.leadId));
  const campaignId = call.campaignId ?? lead!.campaignId;
  const campaign = campaignId
    ? ((await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)))[0] ?? null)
    : null;
  return { lead: lead!, campaign, settings: await getSettings() };
}

router.get("/calls", async (req, res): Promise<void> => {
  const q = ListCallsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(callsTable)
    .where(q.data.status ? eq(callsTable.status, q.data.status) : undefined)
    .orderBy(desc(callsTable.createdAt));
  res.json(ListCallsResponse.parse(await serializeCalls(rows)));
});

router.post("/calls", async (req, res): Promise<void> => {
  const parsed = CreateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, parsed.data.leadId));
  if (!lead) {
    res.status(400).json({ error: "Lead not found" });
    return;
  }
  const [call] = await db
    .insert(callsTable)
    .values({
      leadId: lead.id,
      campaignId: parsed.data.campaignId ?? lead.campaignId,
      objective: parsed.data.objective ?? null,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date(),
    })
    .returning();
  await logActivity({
    type: "call_scheduled",
    description: `Call scheduled with ${leadName(lead)}`,
    channel: "call",
    leadId: lead.id,
  });
  res.status(201).json(await one(call!));
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json(await one(call));
});

router.patch("/calls/:id", async (req, res): Promise<void> => {
  const params = UpdateCallParams.safeParse(req.params);
  const parsed = UpdateCallBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const { scheduledAt, ...rest } = parsed.data;
  const [before] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!before) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const [call] = await db
    .update(callsTable)
    .set({ ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}) })
    .where(eq(callsTable.id, params.data.id))
    .returning();
  if (parsed.data.status && parsed.data.status !== before.status && parsed.data.status !== "scheduled") {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, call!.leadId));
    await logActivity({
      type: "call_completed",
      description: `Call with ${leadName(lead!)}: ${parsed.data.status === "no_answer" ? "no answer" : (parsed.data.outcome ?? "completed")}`,
      channel: "call",
      leadId: lead!.id,
    });
    if (lead!.status === "new") {
      await db.update(leadsTable).set({ status: "contacted", lastContactedAt: new Date() }).where(eq(leadsTable.id, lead!.id));
    }
  }
  res.json(await one(call!));
});

router.post("/calls/:id/script", async (req, res): Promise<void> => {
  const params = GenerateCallScriptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  const ctx = await loadContext(call);
  // Include prior written touchpoints so the script can reference them.
  const prior = await db
    .select({ channel: outreachMessagesTable.channel, direction: outreachMessagesTable.direction, body: outreachMessagesTable.body })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(eq(outreachConversationsTable.leadId, call.leadId))
    .orderBy(asc(outreachMessagesTable.createdAt))
    .limit(10);
  const script = await generateCallScript({
    ...ctx,
    objective: call.objective,
    priorContext: prior.map((p) => `${p.direction === "inbound" ? "Prospect" : "Us"} via ${p.channel}: ${p.body.slice(0, 300)}`).join("\n"),
  });
  const [updated] = await db.update(callsTable).set({ script }).where(eq(callsTable.id, call.id)).returning();
  res.json(await one(updated!));
});

router.post("/calls/:id/summarize", async (req, res): Promise<void> => {
  const params = SummarizeCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!call.notes?.trim()) {
    res.status(400).json({ error: "Add call notes before summarizing" });
    return;
  }
  const ctx = await loadContext(call);
  const result = await summarizeCall({ ...ctx, notes: call.notes, outcome: call.outcome });
  const [updated] = await db
    .update(callsTable)
    .set({
      summary: result.summary,
      nextStep: result.nextStep,
      outcome: call.outcome ?? result.outcome,
      status: "completed",
    })
    .where(eq(callsTable.id, call.id))
    .returning();
  await db
    .update(leadsTable)
    .set({ status: result.leadStatus, lastContactedAt: new Date(), nextStepAt: null })
    .where(eq(leadsTable.id, ctx.lead.id));

  // Queue the recap email automatically when the lead has an email address.
  if (ctx.lead.email && result.followUpEmail) {
    const conv = await getOrCreateConversation(ctx.lead, "email", ctx.campaign?.id ?? null, result.followUpSubject);
    await recordOutbound({
      conversation: conv,
      lead: { ...ctx.lead, status: result.leadStatus },
      body: result.followUpEmail,
      subject: result.followUpSubject,
      author: "ai",
    });
    await logActivity({
      type: "ai_reply",
      description: `AI sent call recap email to ${leadName(ctx.lead)}`,
      channel: "email",
      leadId: ctx.lead.id,
    });
  }
  await logActivity({
    type: "call_completed",
    description: `Call with ${leadName(ctx.lead)} summarized: ${result.outcome}`,
    channel: "call",
    leadId: ctx.lead.id,
  });
  res.json(await one(updated!));
});

export default router;
