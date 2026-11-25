import { Router, type IRouter } from "express";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  activitiesTable,
  callsTable,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  settingsTable,
  tasksTable,
} from "@workspace/db";
import {
  GetChannelPerformanceResponse,
  GetDashboardSummaryResponse,
  GetLeadFunnelResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { getSettings, leadName, publicSettings } from "../lib/outreach";

const router: IRouter = Router();
const LEAD_STATUSES = ["new", "contacted", "replied", "interested", "meeting_booked", "not_interested", "unsubscribed"] as const;
const CHANNELS = ["email", "linkedin", "call"] as const;

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [leads] = await db
    .select({
      total: sql<number>`count(*)::int`,
      meetings: sql<number>`count(*) filter (where ${leadsTable.status} = 'meeting_booked')::int`,
    })
    .from(leadsTable);
  const [campaigns] = await db
    .select({ active: sql<number>`count(*)::int` })
    .from(campaignsTable)
    .where(eq(campaignsTable.status, "active"));
  const [msgs] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'outbound')::int`,
      replies: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'inbound')::int`,
      ai: sql<number>`count(*) filter (where ${outreachMessagesTable.author} = 'ai')::int`,
      opened: sql<number>`count(*) filter (where ${outreachMessagesTable.openedAt} is not null)::int`,
    })
    .from(outreachMessagesTable);
  const [calls] = await db
    .select({ scheduled: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(eq(callsTable.status, "scheduled"));
  const [review] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.status, "needs_review"));
  const [tasks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasksTable)
    .where(eq(tasksTable.done, false));

  const sent = msgs?.sent ?? 0;
  const replies = msgs?.replies ?? 0;
  res.json(
    GetDashboardSummaryResponse.parse({
      totalLeads: leads?.total ?? 0,
      activeCampaigns: campaigns?.active ?? 0,
      messagesSent: sent,
      repliesReceived: replies,
      replyRate: sent > 0 ? replies / sent : 0,
      aiRepliesSent: msgs?.ai ?? 0,
      meetingsBooked: leads?.meetings ?? 0,
      callsScheduled: calls?.scheduled ?? 0,
      needsReview: review?.n ?? 0,
      emailsOpened: msgs?.opened ?? 0,
      openTasks: tasks?.n ?? 0,
    }),
  );
});

router.get("/dashboard/channels", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      channel: outreachMessagesTable.channel,
      sent: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'outbound')::int`,
      replies: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'inbound')::int`,
    })
    .from(outreachMessagesTable)
    .groupBy(outreachMessagesTable.channel);
  const [calls] = await db
    .select({
      made: sql<number>`count(*) filter (where ${callsTable.status} <> 'scheduled')::int`,
      connected: sql<number>`count(*) filter (where ${callsTable.status} = 'completed')::int`,
    })
    .from(callsTable);
  const out = CHANNELS.map((channel) => {
    if (channel === "call") {
      const sent = calls?.made ?? 0;
      const replies = calls?.connected ?? 0;
      return { channel, sent, replies, replyRate: sent ? replies / sent : 0 };
    }
    const r = rows.find((x) => x.channel === channel);
    const sent = r?.sent ?? 0;
    const replies = r?.replies ?? 0;
    return { channel, sent, replies, replyRate: sent ? replies / sent : 0 };
  });
  res.json(GetChannelPerformanceResponse.parse(out));
});

router.get("/dashboard/funnel", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ status: leadsTable.status, count: sql<number>`count(*)::int` })
    .from(leadsTable)
    .groupBy(leadsTable.status);
  res.json(
    GetLeadFunnelResponse.parse(
      LEAD_STATUSES.map((status) => ({ status, count: rows.find((r) => r.status === status)?.count ?? 0 })),
    ),
  );
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const q = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = Math.min(q.success && q.data.limit ? q.data.limit : 25, 100);
  const rows = await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt), desc(activitiesTable.id)).limit(limit);
  const ids = [...new Set(rows.map((r) => r.leadId).filter((x): x is number => x != null))];
  const leads = ids.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, ids)) : [];
  res.json(
    GetRecentActivityResponse.parse(
      rows.map((r) => {
        const lead = leads.find((l) => l.id === r.leadId);
        return { ...r, leadName: lead ? leadName(lead) : null };
      }),
    ),
  );
});

router.get("/settings", async (_req, res): Promise<void> => {
  res.json(GetSettingsResponse.parse(publicSettings(await getSettings())));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await getSettings();
  const changes = { ...parsed.data };
  // Provider keys are write-only: an empty value keeps the stored key.
  if (!changes.unipileApiKey) delete changes.unipileApiKey;
  if (!changes.voiceApiKey) delete changes.voiceApiKey;
  const [row] = await db.update(settingsTable).set(changes).where(eq(settingsTable.id, 1)).returning();
  res.json(UpdateSettingsResponse.parse(publicSettings(row!)));
});

export default router;
