import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { db, campaignsTable, leadsTable, sequenceStepsTable } from "@workspace/db";
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

const router: IRouter = Router();

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
  return GetCampaignResponse.parse({ ...base, steps, leads: await serializeLeads(leads) });
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
  const [step] = await db
    .update(sequenceStepsTable)
    .set(parsed.data)
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
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, parsed.data.leadId));
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
