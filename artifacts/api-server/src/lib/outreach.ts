import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  activitiesTable,
  callsTable,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  sequenceStepsTable,
  settingsTable,
  type CallRow,
  type CampaignRow,
  type ConversationRow,
  type LeadRow,
  type SettingsRow,
} from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { analyzeAndDraftReply, personalizeMessage } from "./ai";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Leads in these statuses still receive automated sequence steps. */
const SEQUENCE_ACTIVE_STATUSES = ["new", "contacted"];

// ---------- settings ----------

export async function getSettings(): Promise<SettingsRow> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(settingsTable)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  return again!;
}

// ---------- activity ----------

export async function logActivity(entry: {
  type: string;
  description: string;
  channel?: string | null;
  leadId?: number | null;
}): Promise<void> {
  await db.insert(activitiesTable).values({
    type: entry.type,
    description: entry.description,
    channel: entry.channel ?? null,
    leadId: entry.leadId ?? null,
  });
}

// ---------- serializers ----------

export function leadName(lead: Pick<LeadRow, "firstName" | "lastName">): string {
  return `${lead.firstName} ${lead.lastName}`.trim();
}

export async function serializeLeads(leads: LeadRow[]) {
  const campaignIds = [...new Set(leads.map((l) => l.campaignId).filter((x): x is number => x != null))];
  const campaigns = campaignIds.length
    ? await db.select().from(campaignsTable).where(inArray(campaignsTable.id, campaignIds))
    : [];
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  return leads.map((l) => ({
    ...l,
    campaignName: l.campaignId != null ? (names.get(l.campaignId) ?? null) : null,
  }));
}

export async function serializeCampaigns(campaigns: CampaignRow[]) {
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((c) => c.id);
  const leadCounts = await db
    .select({
      campaignId: leadsTable.campaignId,
      total: sql<number>`count(*)::int`,
      meetings: sql<number>`count(*) filter (where ${leadsTable.status} = 'meeting_booked')::int`,
    })
    .from(leadsTable)
    .where(inArray(leadsTable.campaignId, ids))
    .groupBy(leadsTable.campaignId);
  const msgCounts = await db
    .select({
      campaignId: outreachConversationsTable.campaignId,
      sent: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'outbound')::int`,
      replies: sql<number>`count(*) filter (where ${outreachMessagesTable.direction} = 'inbound')::int`,
    })
    .from(outreachMessagesTable)
    .innerJoin(
      outreachConversationsTable,
      eq(outreachMessagesTable.conversationId, outreachConversationsTable.id),
    )
    .where(inArray(outreachConversationsTable.campaignId, ids))
    .groupBy(outreachConversationsTable.campaignId);
  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(inArray(sequenceStepsTable.campaignId, ids));

  return campaigns.map((c) => {
    const lc = leadCounts.find((x) => x.campaignId === c.id);
    const mc = msgCounts.find((x) => x.campaignId === c.id);
    const cSteps = steps.filter((s) => s.campaignId === c.id);
    return {
      ...c,
      leadCount: lc?.total ?? 0,
      meetingCount: lc?.meetings ?? 0,
      sentCount: mc?.sent ?? 0,
      replyCount: mc?.replies ?? 0,
      stepCount: cSteps.length,
      channels: [...new Set(cSteps.map((s) => s.channel))],
    };
  });
}

export async function serializeConversations(convs: ConversationRow[]) {
  if (convs.length === 0) return [];
  const leadIds = [...new Set(convs.map((c) => c.leadId))];
  const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds));
  const campaignIds = [...new Set(convs.map((c) => c.campaignId).filter((x): x is number => x != null))];
  const campaigns = campaignIds.length
    ? await db.select().from(campaignsTable).where(inArray(campaignsTable.id, campaignIds))
    : [];
  const convIds = convs.map((c) => c.id);
  const counts = await db
    .select({
      conversationId: outreachMessagesTable.conversationId,
      count: sql<number>`count(*)::int`,
    })
    .from(outreachMessagesTable)
    .where(inArray(outreachMessagesTable.conversationId, convIds))
    .groupBy(outreachMessagesTable.conversationId);
  const latest = await db
    .selectDistinctOn([outreachMessagesTable.conversationId], {
      conversationId: outreachMessagesTable.conversationId,
      body: outreachMessagesTable.body,
    })
    .from(outreachMessagesTable)
    .where(inArray(outreachMessagesTable.conversationId, convIds))
    .orderBy(outreachMessagesTable.conversationId, desc(outreachMessagesTable.createdAt), desc(outreachMessagesTable.id));

  return convs.map((c) => {
    const lead = leads.find((l) => l.id === c.leadId);
    const preview = latest.find((m) => m.conversationId === c.id)?.body ?? null;
    return {
      ...c,
      leadName: lead ? leadName(lead) : "Unknown",
      leadCompany: lead?.company ?? null,
      campaignName: campaigns.find((x) => x.id === c.campaignId)?.name ?? null,
      lastMessagePreview: preview ? preview.slice(0, 160) : null,
      messageCount: counts.find((x) => x.conversationId === c.id)?.count ?? 0,
    };
  });
}

export async function getConversationDetail(id: number) {
  const [conv] = await db
    .select()
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.id, id));
  if (!conv) return null;
  const [serialized] = await serializeConversations([conv]);
  const messages = await db
    .select()
    .from(outreachMessagesTable)
    .where(eq(outreachMessagesTable.conversationId, id))
    .orderBy(asc(outreachMessagesTable.createdAt), asc(outreachMessagesTable.id));
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
  const [serializedLead] = await serializeLeads([lead!]);
  return { ...serialized!, messages, lead: serializedLead! };
}

export async function serializeCalls(calls: CallRow[]) {
  if (calls.length === 0) return [];
  const leadIds = [...new Set(calls.map((c) => c.leadId))];
  const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds));
  return calls.map((c) => {
    const lead = leads.find((l) => l.id === c.leadId);
    return {
      ...c,
      leadName: lead ? leadName(lead) : "Unknown",
      leadCompany: lead?.company ?? null,
      leadPhone: lead?.phone ?? null,
    };
  });
}

// ---------- conversations & messages ----------

export async function getOrCreateConversation(
  lead: LeadRow,
  channel: string,
  campaignId: number | null,
  subject: string | null,
): Promise<ConversationRow> {
  const [existing] = await db
    .select()
    .from(outreachConversationsTable)
    .where(
      and(
        eq(outreachConversationsTable.leadId, lead.id),
        eq(outreachConversationsTable.channel, channel),
      ),
    )
    .orderBy(desc(outreachConversationsTable.lastMessageAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(outreachConversationsTable)
    .values({ leadId: lead.id, channel, campaignId, subject, status: "open" })
    .returning();
  return created!;
}

/**
 * Records an outbound message. Delivery through real providers (Gmail, LinkedIn,
 * telephony) is not connected yet, so messages are stored as sent in-app.
 */
export async function recordOutbound(args: {
  conversation: ConversationRow;
  lead: LeadRow;
  body: string;
  subject: string | null;
  author: "user" | "ai";
}) {
  const now = new Date();
  const [message] = await db
    .insert(outreachMessagesTable)
    .values({
      conversationId: args.conversation.id,
      direction: "outbound",
      channel: args.conversation.channel,
      subject: args.subject,
      body: args.body,
      author: args.author,
      createdAt: now,
    })
    .returning();
  await db
    .update(outreachConversationsTable)
    .set({
      lastMessageAt: now,
      subject: args.conversation.subject ?? args.subject,
      ...(args.author === "user" ? { unread: false } : {}),
    })
    .where(eq(outreachConversationsTable.id, args.conversation.id));
  await db
    .update(leadsTable)
    .set({
      lastContactedAt: now,
      ...(args.lead.status === "new" ? { status: "contacted" } : {}),
    })
    .where(eq(leadsTable.id, args.lead.id));
  return message!;
}

/**
 * Core auto-reply loop: store the inbound message, let the AI classify it, update
 * the lead, and either send the AI reply automatically or flag for human review.
 */
export async function processInbound(
  conversationId: number,
  input: { body: string; subject?: string | null },
): Promise<void> {
  const [conv] = await db
    .select()
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.id, conversationId));
  if (!conv) throw new Error("Conversation not found");
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
  if (!lead) throw new Error("Lead not found");

  const now = new Date();
  await db.insert(outreachMessagesTable).values({
    conversationId: conv.id,
    direction: "inbound",
    channel: conv.channel,
    subject: input.subject ?? null,
    body: input.body,
    author: "lead",
    createdAt: now,
  });
  await db
    .update(outreachConversationsTable)
    .set({ lastMessageAt: now, unread: true })
    .where(eq(outreachConversationsTable.id, conv.id));
  // A reply stops the automated sequence for this lead.
  await db
    .update(leadsTable)
    .set({ status: "replied", nextStepAt: null })
    .where(eq(leadsTable.id, lead.id));
  await logActivity({
    type: "reply_received",
    description: `${leadName(lead)} replied on ${conv.channel}`,
    channel: conv.channel,
    leadId: lead.id,
  });

  const campaignId = conv.campaignId ?? lead.campaignId;
  const campaign = campaignId
    ? ((await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)))[0] ?? null)
    : null;
  const settings = await getSettings();
  const history = await db
    .select()
    .from(outreachMessagesTable)
    .where(eq(outreachMessagesTable.conversationId, conv.id))
    .orderBy(asc(outreachMessagesTable.createdAt), asc(outreachMessagesTable.id));

  const analysis = await analyzeAndDraftReply({
    lead,
    campaign,
    settings,
    channel: conv.channel,
    history,
  });

  await db
    .update(leadsTable)
    .set({ status: analysis.leadStatus })
    .where(eq(leadsTable.id, lead.id));

  const autoEnabled = settings.globalAutoReply && (campaign?.autoReply ?? false);
  const risky =
    settings.escalateNegative &&
    (analysis.sentiment === "negative" || analysis.sentiment === "objection");

  if (autoEnabled && analysis.shouldReply && !risky && conv.channel !== "call") {
    await recordOutbound({
      conversation: { ...conv, subject: conv.subject },
      lead: { ...lead, status: analysis.leadStatus },
      body: analysis.body,
      subject: analysis.subject ?? (conv.subject ? `Re: ${conv.subject.replace(/^re:\s*/i, "")}` : null),
      author: "ai",
    });
    await db
      .update(outreachConversationsTable)
      .set({ status: "auto_replied", sentiment: analysis.sentiment, unread: false })
      .where(eq(outreachConversationsTable.id, conv.id));
    await logActivity({
      type: "ai_reply",
      description: `AI replied to ${leadName(lead)} (${analysis.sentiment})`,
      channel: conv.channel,
      leadId: lead.id,
    });
  } else {
    const status = analysis.sentiment === "unsubscribe" ? "closed" : "needs_review";
    await db
      .update(outreachConversationsTable)
      .set({ status, sentiment: analysis.sentiment })
      .where(eq(outreachConversationsTable.id, conv.id));
  }
  if (analysis.leadStatus !== "replied") {
    await logActivity({
      type: "status_change",
      description: `${leadName(lead)} marked ${analysis.leadStatus.replace("_", " ")}`,
      leadId: lead.id,
    });
  }
}

// ---------- campaign execution ----------

async function executeStepForLead(
  lead: LeadRow,
  campaign: CampaignRow,
  steps: Awaited<ReturnType<typeof loadSteps>>,
  settings: SettingsRow,
): Promise<"message" | "call" | "none"> {
  const step = steps[lead.currentStep];
  if (!step) return "none";
  let kind: "message" | "call" = "message";

  if (step.channel === "call") {
    kind = "call";
    await db.insert(callsTable).values({
      leadId: lead.id,
      campaignId: campaign.id,
      objective: step.template,
      status: "scheduled",
      scheduledAt: new Date(),
    });
    await logActivity({
      type: "call_scheduled",
      description: `Call queued for ${leadName(lead)}`,
      channel: "call",
      leadId: lead.id,
    });
  } else {
    if (step.channel === "email" && !lead.email) return skipStep(lead, steps);
    if (step.channel === "linkedin" && !lead.linkedinUrl) return skipStep(lead, steps);
    const msg = await personalizeMessage({
      lead,
      campaign,
      settings,
      channel: step.channel,
      subject: step.subject,
      template: step.template,
      stepNumber: step.stepOrder,
    });
    const conv = await getOrCreateConversation(lead, step.channel, campaign.id, msg.subject);
    await recordOutbound({ conversation: conv, lead, body: msg.body, subject: msg.subject, author: "ai" });
    await logActivity({
      type: "message_sent",
      description: `Step ${step.stepOrder} ${step.channel === "email" ? "email" : "LinkedIn message"} sent to ${leadName(lead)}`,
      channel: step.channel,
      leadId: lead.id,
    });
  }

  await advanceLead(lead, steps);
  return kind;
}

async function skipStep(lead: LeadRow, steps: Awaited<ReturnType<typeof loadSteps>>) {
  await advanceLead(lead, steps, true);
  return "none" as const;
}

async function advanceLead(
  lead: LeadRow,
  steps: Awaited<ReturnType<typeof loadSteps>>,
  immediate = false,
) {
  const nextIndex = lead.currentStep + 1;
  const next = steps[nextIndex];
  await db
    .update(leadsTable)
    .set({
      currentStep: nextIndex,
      nextStepAt: next ? new Date(Date.now() + (immediate ? 0 : next.delayDays * DAY_MS)) : null,
      status: lead.status === "new" ? "contacted" : lead.status,
    })
    .where(eq(leadsTable.id, lead.id));
}

function loadSteps(campaignId: number) {
  return db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, campaignId))
    .orderBy(asc(sequenceStepsTable.stepOrder), asc(sequenceStepsTable.id));
}

export async function runCampaign(campaignId: number) {
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");
  const steps = await loadSteps(campaignId);
  const settings = await getSettings();
  if (campaign.status !== "active") {
    await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, campaignId));
  }

  const dueLeads = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.campaignId, campaignId),
        inArray(leadsTable.status, SEQUENCE_ACTIVE_STATUSES),
        or(isNull(leadsTable.nextStepAt), lte(leadsTable.nextStepAt, new Date())),
      ),
    );
  const eligible = dueLeads.filter((l) => l.currentStep < steps.length);

  const results = await batchProcess(
    eligible,
    async (lead) => executeStepForLead(lead, campaign, steps, settings),
    { concurrency: 3, retries: 2 },
  );
  const messagesSent = results.filter((r) => r === "message").length;
  const callsScheduled = results.filter((r) => r === "call").length;

  if (eligible.length > 0) {
    await logActivity({
      type: "campaign_run",
      description: `${campaign.name}: ${messagesSent} messages sent, ${callsScheduled} calls queued`,
    });
  }
  return { messagesSent, callsScheduled, leadsProcessed: eligible.length };
}

/** Background automation: every minute, execute due steps for all active campaigns. */
export function startScheduler(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const active = await db.select().from(campaignsTable).where(eq(campaignsTable.status, "active"));
      for (const c of active) {
        const result = await runCampaign(c.id);
        if (result.leadsProcessed > 0) {
          logger.info({ campaignId: c.id, ...result }, "Scheduled campaign run");
        }
      }
    } catch (err) {
      logger.error({ err }, "Scheduler tick failed");
    } finally {
      running = false;
    }
  };
  setInterval(tick, 60_000);
}
