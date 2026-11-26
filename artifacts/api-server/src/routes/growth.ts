import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadsTable,
  meetingsTable,
  objectionsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  suppressionsTable,
  teamMembersTable,
} from "@workspace/db";
import {
  AddSuppressionsBody,
  CreateMeetingBody,
  CreateObjectionBody,
  CreateTeamMemberBody,
  DeleteMeetingParams,
  DeleteObjectionParams,
  DeleteSuppressionParams,
  DeleteTeamMemberParams,
  DraftMeetingFollowUpParams,
  ListMeetingsQueryParams,
  ScanLeadSignalsBody,
  SendMeetingFollowUpParams,
  UpdateMeetingBody,
  UpdateMeetingParams,
  UpdateObjectionBody,
  UpdateObjectionParams,
  UpdateTeamMemberBody,
  UpdateTeamMemberParams,
  VerifyLeadEmailsBody,
} from "@workspace/api-zod";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { addSuppressions, removeSuppression } from "../lib/suppression";
import { draftFollowUp, recordMeeting, sendFollowUp, serializeMeetings } from "../lib/meetings";
import { scanSignals } from "../lib/signals";
import { verifyLead } from "../lib/email-check";
import { websiteFor } from "../lib/web";
import { getSettings, leadName, logActivity } from "../lib/outreach";

/** Objection library, do-not-contact list, team, meetings, lead signals/email checks and the outreach report. */
const router: IRouter = Router();

type Res = Parameters<Parameters<IRouter["get"]>[1]>[1];
const bad = (res: Res, error: unknown) => res.status(400).json({ error: error instanceof Error ? error.message : String(error) });

// ---------- objection library ----------

router.get("/objections", async (_req, res): Promise<void> => {
  res.json(await db.select().from(objectionsTable).orderBy(asc(objectionsTable.id)));
});

router.post("/objections", async (req, res): Promise<void> => {
  const parsed = CreateObjectionBody.safeParse(req.body);
  if (!parsed.success) return void bad(res, parsed.error.message);
  const [row] = await db.insert(objectionsTable).values({ objection: parsed.data.objection.trim(), answer: parsed.data.answer.trim() }).returning();
  res.status(201).json(row);
});

router.patch("/objections/:id", async (req, res): Promise<void> => {
  const params = UpdateObjectionParams.safeParse(req.params);
  const parsed = UpdateObjectionBody.safeParse(req.body);
  if (!params.success || !parsed.success) return void bad(res, (params.error ?? parsed.error)?.message);
  const [row] = await db.update(objectionsTable).set(parsed.data).where(eq(objectionsTable.id, params.data.id)).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.delete("/objections/:id", async (req, res): Promise<void> => {
  const params = DeleteObjectionParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  await db.delete(objectionsTable).where(eq(objectionsTable.id, params.data.id));
  res.sendStatus(204);
});

// ---------- do-not-contact list ----------

router.get("/suppressions", async (_req, res): Promise<void> => {
  res.json(await db.select().from(suppressionsTable).orderBy(desc(suppressionsTable.createdAt)));
});

router.post("/suppressions", async (req, res): Promise<void> => {
  const parsed = AddSuppressionsBody.safeParse(req.body);
  if (!parsed.success) return void bad(res, parsed.error.message);
  const result = await addSuppressions(parsed.data.values, parsed.data.reason?.trim() || "manual");
  if (result.added) await logActivity({ type: "suppression_added", description: `${result.added} added to the do-not-contact list` });
  res.json(result);
});

router.delete("/suppressions/:id", async (req, res): Promise<void> => {
  const params = DeleteSuppressionParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  await removeSuppression(params.data.id);
  res.sendStatus(204);
});

// ---------- team ----------

async function serializeTeam(ids?: number[]) {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .where(ids ? inArray(teamMembersTable.id, ids) : undefined)
    .orderBy(asc(teamMembersTable.id));
  const counts = await db
    .select({ ownerId: leadsTable.ownerId, n: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(isNotNull(leadsTable.ownerId))
    .groupBy(leadsTable.ownerId);
  return rows.map((m) => ({ ...m, leadCount: counts.find((c) => c.ownerId === m.id)?.n ?? 0 }));
}

router.get("/team", async (_req, res): Promise<void> => {
  res.json(await serializeTeam());
});

router.post("/team", async (req, res): Promise<void> => {
  const parsed = CreateTeamMemberBody.safeParse(req.body);
  if (!parsed.success) return void bad(res, parsed.error.message);
  const [row] = await db
    .insert(teamMembersTable)
    .values({ name: parsed.data.name.trim(), email: parsed.data.email.trim().toLowerCase(), role: parsed.data.role ?? "member" })
    .returning();
  res.status(201).json((await serializeTeam([row!.id]))[0]);
});

router.patch("/team/:id", async (req, res): Promise<void> => {
  const params = UpdateTeamMemberParams.safeParse(req.params);
  const parsed = UpdateTeamMemberBody.safeParse(req.body);
  if (!params.success || !parsed.success) return void bad(res, (params.error ?? parsed.error)?.message);
  const [row] = await db.update(teamMembersTable).set(parsed.data).where(eq(teamMembersTable.id, params.data.id)).returning();
  if (!row) return void res.status(404).json({ error: "Not found" });
  res.json((await serializeTeam([row.id]))[0]);
});

router.delete("/team/:id", async (req, res): Promise<void> => {
  const params = DeleteTeamMemberParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  // Their leads become unassigned rather than deleted.
  await db.update(leadsTable).set({ ownerId: null }).where(eq(leadsTable.ownerId, params.data.id));
  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, params.data.id));
  res.sendStatus(204);
});

// ---------- meetings ----------

router.get("/meetings", async (req, res): Promise<void> => {
  const q = ListMeetingsQueryParams.safeParse(req.query);
  if (!q.success) return void bad(res, q.error.message);
  const conds = [
    q.data.leadId ? eq(meetingsTable.leadId, q.data.leadId) : undefined,
    q.data.dealId ? eq(meetingsTable.dealId, q.data.dealId) : undefined,
  ].filter((c) => !!c);
  const rows = await db
    .select()
    .from(meetingsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(meetingsTable.startsAt));
  res.json(await serializeMeetings(rows));
});

router.post("/meetings", async (req, res): Promise<void> => {
  const parsed = CreateMeetingBody.safeParse(req.body);
  if (!parsed.success) return void bad(res, parsed.error.message);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, parsed.data.leadId));
  if (!lead) return void res.status(404).json({ error: "Lead not found" });
  const settings = await getSettings();
  const m = await recordMeeting({
    lead,
    startsAt: new Date(parsed.data.startsAt),
    minutes: parsed.data.minutes ?? settings.meetingMinutes,
    title: parsed.data.title?.trim() || `${settings.companyName} <> ${lead.company || leadName(lead)}`,
    link: parsed.data.link?.trim() || null,
    provider: "manual",
    notes: parsed.data.notes?.trim() || null,
  });
  await logActivity({ type: "meeting_booked", description: `Meeting logged with ${leadName(lead)}`, leadId: lead.id, dealId: m.dealId });
  res.status(201).json((await serializeMeetings([m]))[0]);
});

router.patch("/meetings/:id", async (req, res): Promise<void> => {
  const params = UpdateMeetingParams.safeParse(req.params);
  const parsed = UpdateMeetingBody.safeParse(req.body);
  if (!params.success || !parsed.success) return void bad(res, (params.error ?? parsed.error)?.message);
  const { startsAt, ...rest } = parsed.data;
  const [row] = await db
    .update(meetingsTable)
    // Moving a meeting means the reminder has to go out again.
    .set({ ...rest, ...(startsAt ? { startsAt: new Date(startsAt), reminderSentAt: null } : {}) })
    .where(eq(meetingsTable.id, params.data.id))
    .returning();
  if (!row) return void res.status(404).json({ error: "Meeting not found" });
  res.json((await serializeMeetings([row]))[0]);
});

router.delete("/meetings/:id", async (req, res): Promise<void> => {
  const params = DeleteMeetingParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  await db.delete(meetingsTable).where(eq(meetingsTable.id, params.data.id));
  res.sendStatus(204);
});

async function meetingOr404(id: number, res: Res) {
  const [m] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!m) res.status(404).json({ error: "Meeting not found" });
  return m ?? null;
}

router.post("/meetings/:id/draft-follow-up", async (req, res): Promise<void> => {
  const params = DraftMeetingFollowUpParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  const m = await meetingOr404(params.data.id, res);
  if (!m) return;
  res.json((await serializeMeetings([await draftFollowUp(m)]))[0]);
});

router.post("/meetings/:id/send-follow-up", async (req, res): Promise<void> => {
  const params = SendMeetingFollowUpParams.safeParse(req.params);
  if (!params.success) return void bad(res, params.error.message);
  const m = await meetingOr404(params.data.id, res);
  if (!m) return;
  try {
    res.json((await serializeMeetings([await sendFollowUp(m)]))[0]);
  } catch (err) {
    bad(res, err);
  }
});

// ---------- lead signals and email checks ----------

router.post("/leads/signals", async (req, res): Promise<void> => {
  const parsed = ScanLeadSignalsBody.safeParse(req.body ?? {});
  if (!parsed.success) return void bad(res, parsed.error.message);
  const leads = parsed.data.leadIds?.length
    ? await db.select().from(leadsTable).where(inArray(leadsTable.id, parsed.data.leadIds))
    : await db.select().from(leadsTable).where(isNull(leadsTable.signalsAt)).limit(50);
  const withSite = leads.filter((l) => websiteFor(l));
  const results = await batchProcess(withSite, (l) => scanSignals(l), { concurrency: 3, retries: 1 });
  res.json({ scanned: withSite.length, withSignals: results.filter((r) => r && r.length).length, skipped: leads.length - withSite.length });
});

router.post("/leads/verify", async (req, res): Promise<void> => {
  const parsed = VerifyLeadEmailsBody.safeParse(req.body ?? {});
  if (!parsed.success) return void bad(res, parsed.error.message);
  const leads = (
    parsed.data.leadIds?.length
      ? await db.select().from(leadsTable).where(inArray(leadsTable.id, parsed.data.leadIds))
      : await db.select().from(leadsTable).where(isNull(leadsTable.emailStatus))
  ).filter((l) => l.email && l.emailStatus !== "bounced");
  const results = await batchProcess(leads, (l) => verifyLead(l), { concurrency: 8, retries: 0 });
  res.json({
    checked: leads.length,
    valid: results.filter((r) => r === "valid").length,
    risky: results.filter((r) => r === "risky").length,
    invalid: results.filter((r) => r === "invalid").length,
  });
});

// ---------- outreach report ----------

const repliedSql = sql<number>`count(*) filter (where exists (select 1 from outreach_messages i where i.conversation_id = "outreach_messages"."conversation_id" and i.direction = 'inbound' and i.created_at > "outreach_messages"."created_at"))::int`;
const metricCols = {
  sent: sql<number>`count(*) filter (where ${outreachMessagesTable.deliveryStatus} not in ('failed','blocked'))::int`,
  opened: sql<number>`count(${outreachMessagesTable.openedAt})::int`,
  clicked: sql<number>`count(${outreachMessagesTable.clickedAt})::int`,
  bounced: sql<number>`count(*) filter (where ${outreachMessagesTable.deliveryStatus} = 'bounced')::int`,
  replied: repliedSql,
};

router.get("/reports/outreach", async (_req, res): Promise<void> => {
  const settings = await getSettings();
  const outbound = eq(outreachMessagesTable.direction, "outbound");

  const byCampaign = await db
    .select({ campaignId: outreachConversationsTable.campaignId, ...metricCols })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(outbound)
    .groupBy(outreachConversationsTable.campaignId);
  const byChannel = await db
    .select({ channel: outreachMessagesTable.channel, ...metricCols })
    .from(outreachMessagesTable)
    .where(outbound)
    .groupBy(outreachMessagesTable.channel);
  const bySteps = await db
    .select({ campaignId: outreachConversationsTable.campaignId, stepOrder: outreachMessagesTable.stepOrder, variant: outreachMessagesTable.variant, channel: outreachMessagesTable.channel, ...metricCols })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(and(outbound, isNotNull(outreachMessagesTable.stepOrder), isNotNull(outreachConversationsTable.campaignId)))
    .groupBy(outreachConversationsTable.campaignId, outreachMessagesTable.stepOrder, outreachMessagesTable.variant, outreachMessagesTable.channel)
    .orderBy(outreachConversationsTable.campaignId, outreachMessagesTable.stepOrder, outreachMessagesTable.variant);

  // Meetings: people booked (status) or with a meeting on record, attributed to their campaign and reply channel.
  const booked = await db
    .select({ id: leadsTable.id, campaignId: leadsTable.campaignId })
    .from(leadsTable)
    .where(sql`${leadsTable.status} = 'meeting_booked' or exists (select 1 from meetings mt where mt.lead_id = ${leadsTable.id})`);
  const bookedIds = booked.map((b) => b.id);
  const replyChannels = bookedIds.length
    ? await db
        .selectDistinct({ leadId: outreachConversationsTable.leadId, channel: outreachConversationsTable.channel })
        .from(outreachConversationsTable)
        .innerJoin(outreachMessagesTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
        .where(and(inArray(outreachConversationsTable.leadId, bookedIds), eq(outreachMessagesTable.direction, "inbound")))
    : [];

  const campaigns = await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
  const zero = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  const campaignRows = campaigns.map((c) => {
    const m = byCampaign.find((r) => r.campaignId === c.id) ?? zero;
    const meetings = booked.filter((b) => b.campaignId === c.id).length;
    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      cost: c.cost,
      sent: m.sent,
      opened: m.opened,
      clicked: m.clicked,
      replied: m.replied,
      bounced: m.bounced,
      meetings,
      costPerMeeting: meetings && c.cost ? Math.round((c.cost / meetings) * 100) / 100 : null,
    };
  });
  const channelRows = byChannel.map((r) => ({ ...r, meetings: new Set(replyChannels.filter((x) => x.channel === r.channel).map((x) => x.leadId)).size }));
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  const stepRows = bySteps.map((r) => ({
    campaignId: r.campaignId!,
    campaignName: names.get(r.campaignId!) ?? "Campaign",
    stepOrder: r.stepOrder!,
    channel: r.channel,
    variant: r.variant ?? "-",
    sent: r.sent,
    opened: r.opened,
    clicked: r.clicked,
    replied: r.replied,
    bounced: r.bounced,
    meetings: 0,
  }));
  const sum = (k: keyof typeof zero) => byChannel.reduce((n, r) => n + r[k], 0);
  res.json({
    currency: settings.currency,
    totals: { sent: sum("sent"), opened: sum("opened"), clicked: sum("clicked"), replied: sum("replied"), bounced: sum("bounced"), meetings: booked.length },
    campaigns: campaignRows,
    channels: channelRows,
    steps: stepRows,
  });
});

export default router;
