import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, callsTable, leadsTable, type CallRow } from "@workspace/db";
import {
  CreateCallBody,
  GenerateCallScriptParams,
  GetCallParams,
  GetCallResponse,
  ListCallsQueryParams,
  ListCallsResponse,
  StartAiCallParams,
  SummarizeCallParams,
  UpdateCallBody,
  UpdateCallParams,
} from "@workspace/api-zod";
import { startAiCall, summarizeAndFollowUp, writeScript } from "../lib/calls";
import { leadName, logActivity, serializeCalls } from "../lib/outreach";

const router: IRouter = Router();

async function one(call: CallRow) {
  return GetCallResponse.parse((await serializeCalls([call]))[0]);
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
  await writeScript(call);
  const [updated] = await db.select().from(callsTable).where(eq(callsTable.id, call.id));
  res.json(await one(updated!));
});

router.post("/calls/:id/ai-dial", async (req, res): Promise<void> => {
  const params = StartAiCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, params.data.id));
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  try {
    res.json(await one(await startAiCall(call)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
  if (!call.notes?.trim() && !call.transcript?.trim()) {
    res.status(400).json({ error: "Add call notes before summarizing" });
    return;
  }
  res.json(await one(await summarizeAndFollowUp(call)));
});

export default router;
