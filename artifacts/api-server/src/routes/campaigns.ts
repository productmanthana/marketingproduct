import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import {
  db,
  callsTable,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  sequenceStepsTable,
  type LeadRow,
} from "@workspace/db";
import {
  AddSequenceStepBody,
  AddSequenceStepParams,
  CreateCampaignBody,
  DeleteCampaignParams,
  DeleteSequenceStepParams,
  EnrollLeadsBody,
  EnrollLeadsParams,
  GenerateCampaignSequenceParams,
  GetCampaignParams,
  GetCampaignResponse,
  ListCampaignSentParams,
  ListCampaignSentResponse,
  PreviewSequenceStepBody,
  PreviewSequenceStepParams,
  PreviewSequenceStepResponse,
  ListCampaignsResponse,
  RunCampaignParams,
  RunCampaignResponse,
  UpdateCampaignBody,
  UpdateCampaignParams,
  UpdateSequenceStepBody,
  UpdateSequenceStepParams,
  WriteCampaignPitchBody,
  WriteCampaignPitchParams,
} from "@workspace/api-zod";
import { generateSequence, personalizeMessage, writePitch } from "../lib/ai";
import { getSettings, runCampaign, serializeCampaigns, serializeLeads } from "../lib/outreach";
import { variantStats } from "../lib/ab-test";

const router: IRouter = Router();

/** Stand-in prospect for previews before any leads exist. Only the profile fields the AI reads are set. */
const SAMPLE_LEAD = { firstName: "Priya", lastName: "Sharma", company: "Sample Co", title: "Operations Manager", industry: null, notes: null } as unknown as LeadRow;

async function campaignDetail(id: number) {
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!c) return null;
  const [base] = await serializeCampaigns([c]);
  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, id))
    .orderBy(asc(sequenceStepsTable.stepOrder), asc(sequenceStepsTable.id));
  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, id))
    .orderBy(desc(leadsTable.createdAt));
  const stats = await variantStats(id, steps.filter((s) => s.variantTemplate).map((s) => s.stepOrder));
  return GetCampaignResponse.parse({
    ...base,
    steps: steps.map((s) => ({ ...s, abStats: stats.get(s.stepOrder) ?? [] })),
    leads: await serializeLeads(leads),
  });
}

async function campaignSummary(id: number) {
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  return c ? (await serializeCampaigns([c]))[0]! : null;
}

router.get("/campaigns", async (_req, res): Promise<void> => {
  const rows = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
  res.json(ListCampaignsResponse.parse(await serializeCampaigns(rows)));
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await getSettings();
  const [c] = await db
    .insert(campaignsTable)
    .values({ ...parsed.data, replyTone: parsed.data.replyTone || settings.defaultTone })
    .returning();
  res.status(201).json(await campaignSummary(c!.id));
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await campaignDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(detail);
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [c] = await db
    .update(campaignsTable)
    .set(parsed.data)
    .where(eq(campaignsTable.id, params.data.id))
    .returning();
  if (!c) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(await campaignSummary(c.id));
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/campaigns/:id/steps", async (req, res): Promise<void> => {
  const params = AddSequenceStepParams.safeParse(req.params);
  const parsed = AddSequenceStepBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [{ maxOrder } = { maxOrder: 0 }] = await db
    .select({ maxOrder: max(sequenceStepsTable.stepOrder) })
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, params.data.id));
  const [step] = await db
    .insert(sequenceStepsTable)
    .values({
      campaignId: params.data.id,
      stepOrder: (maxOrder ?? 0) + 1,
      channel: parsed.data.channel,
      delayDays: parsed.data.delayDays ?? 0,
      delayHours: parsed.data.delayHours ?? 0,
      subject: parsed.data.subject ?? null,
      template: parsed.data.template,
    })
    .returning();
  res.status(201).json(step);
});

router.patch("/campaigns/:id/steps/:stepId", async (req, res): Promise<void> => {
  const params = UpdateSequenceStepParams.safeParse(req.params);
  const parsed = UpdateSequenceStepBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const changes = { ...parsed.data };
  // Removing version B ends the A/B test.
  if ("variantTemplate" in changes && !changes.variantTemplate?.trim()) Object.assign(changes, { variantTemplate: null, variantSubject: null, abWinner: null });
  const [step] = await db
    .update(sequenceStepsTable)
    .set(changes)
    .where(
      and(
        eq(sequenceStepsTable.id, params.data.stepId),
        eq(sequenceStepsTable.campaignId, params.data.id),
      ),
    )
    .returning();
  if (!step) {
    res.status(404).json({ error: "Step not found" });
    return;
  }
  res.json(step);
});

router.delete("/campaigns/:id/steps/:stepId", async (req, res): Promise<void> => {
  const params = DeleteSequenceStepParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(sequenceStepsTable)
    .where(
      and(
        eq(sequenceStepsTable.id, params.data.stepId),
        eq(sequenceStepsTable.campaignId, params.data.id),
      ),
    );
  res.sendStatus(204);
});

router.post("/campaigns/:id/steps/:stepId/preview", async (req, res): Promise<void> => {
  const params = PreviewSequenceStepParams.safeParse(req.params);
  const parsed = PreviewSequenceStepBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  const [step] = await db
    .select()
    .from(sequenceStepsTable)
    .where(and(eq(sequenceStepsTable.id, params.data.stepId), eq(sequenceStepsTable.campaignId, params.data.id)));
  const [lead] = parsed.data.leadId
    ? await db.select().from(leadsTable).where(eq(leadsTable.id, parsed.data.leadId))
    : [SAMPLE_LEAD];
  if (!campaign || !step || !lead) {
    res.status(404).json({ error: "Campaign, step or lead not found" });
    return;
  }
  if (step.channel === "call") {
    res.json(PreviewSequenceStepResponse.parse({ subject: null, body: step.template }));
    return;
  }
  const msg = await personalizeMessage({
    lead,
    campaign,
    settings: await getSettings(),
    channel: step.channel,
    subject: step.subject,
    template: step.template,
    stepNumber: step.stepOrder,
  });
  res.json(PreviewSequenceStepResponse.parse(msg));
});

router.post("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const params = EnrollLeadsParams.safeParse(req.params);
  const parsed = EnrollLeadsBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  if (parsed.data.leadIds.length) {
    await db
      .update(leadsTable)
      .set({ campaignId: params.data.id, currentStep: 0, nextStepAt: null })
      .where(inArray(leadsTable.id, parsed.data.leadIds));
  }
  const summary = await campaignSummary(params.data.id);
  if (!summary) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(summary);
});

router.post("/campaigns/:id/generate-sequence", async (req, res): Promise<void> => {
  const params = GenerateCampaignSequenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!c) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const steps = await generateSequence(c, await getSettings());
  await db.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, c.id));
  if (steps.length) {
    await db
      .insert(sequenceStepsTable)
      .values(steps.map((s, i) => ({ ...s, campaignId: c.id, stepOrder: i + 1 })));
  }
  res.json(await campaignDetail(c.id));
});

router.post("/campaigns/:id/write-pitch", async (req, res): Promise<void> => {
  const params = WriteCampaignPitchParams.safeParse(req.params);
  const body = WriteCampaignPitchBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!c) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const pitch = await writePitch({ campaign: c, settings: await getSettings(), notes: body.data.notes?.trim() ?? "", goal: body.data.goal?.trim() || c.goal });
  res.json({ pitch });
});

/** Outbound messages and calls of one campaign, newest first. */
router.get("/campaigns/:id/sent", async (req, res): Promise<void> => {
  const params = ListCampaignSentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [messages, calls] = await Promise.all([
    db
      .select({ m: outreachMessagesTable, leadId: leadsTable.id, first: leadsTable.firstName, last: leadsTable.lastName })
      .from(outreachMessagesTable)
      .innerJoin(outreachConversationsTable, eq(outreachConversationsTable.id, outreachMessagesTable.conversationId))
      .innerJoin(leadsTable, eq(leadsTable.id, outreachConversationsTable.leadId))
      .where(and(eq(outreachConversationsTable.campaignId, id), eq(outreachMessagesTable.direction, "outbound")))
      .orderBy(desc(outreachMessagesTable.createdAt))
      .limit(200),
    db
      .select({ c: callsTable, first: leadsTable.firstName, last: leadsTable.lastName })
      .from(callsTable)
      .innerJoin(leadsTable, eq(leadsTable.id, callsTable.leadId))
      .where(eq(callsTable.campaignId, id))
      .orderBy(desc(callsTable.createdAt))
      .limit(200),
  ]);
  const name = (f: string, l: string) => `${f} ${l}`.trim();
  const items = [
    ...messages.map(({ m, leadId, first, last }) => ({
      key: `m${m.id}`, kind: "message" as const, channel: m.channel, leadId, leadName: name(first, last),
      subject: m.subject, body: m.body, status: m.deliveryStatus, error: m.deliveryError, openedAt: m.openedAt, createdAt: m.createdAt,
    })),
    ...calls.map(({ c, first, last }) => ({
      key: `c${c.id}`, kind: "call" as const, channel: "call", leadId: c.leadId, leadName: name(first, last),
      subject: c.outcome, body: c.summary ?? c.objective, status: c.status, error: null, openedAt: null, createdAt: c.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(ListCampaignSentResponse.parse(items));
});

router.post("/campaigns/:id/run", async (req, res): Promise<void> => {
  const params = RunCampaignParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!c) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const result = await runCampaign(c.id);
  res.json(RunCampaignResponse.parse(result));
});

export default router;
