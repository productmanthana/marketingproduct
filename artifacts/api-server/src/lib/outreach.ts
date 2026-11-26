import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  accountsTable,
  activitiesTable,
  callsTable,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  objectionsTable,
  sequenceStepsTable,
  settingsTable,
  tasksTable,
  teamMembersTable,
  type CallRow,
  type CampaignRow,
  type ConversationRow,
  type LeadRow,
  type SettingsRow,
} from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { analyzeAndDraftReply, personalizeMessage } from "./ai";
import { hasEmailCapacity, linkedinQuotaLeft, sendEmail, sendLinkedIn, unipileConfigured } from "./delivery";
import { logger } from "./logger";
import { ensureDealForBookedLead } from "./crm";
import { schedulerFor } from "./scheduling";
import { recordMeeting } from "./meetings";
import { suppressLead, suppressionFor } from "./suppression";
import { verifyLead } from "./email-check";
import { contentFor, maybePickWinner, variantFor } from "./ab-test";
import { guessTimezone } from "./timezones";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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

/** Settings as the API returns them: provider keys are never sent back, only whether they are set. */
export function publicSettings(s: SettingsRow) {
  const { unipileApiKey, voiceApiKey, googleRefreshToken: _g, calcomApiKey: _c, ...rest } = s;
  return {
    ...rest,
    unipileConnected: unipileConfigured(s),
    voiceConnected: !!(voiceApiKey && s.voicePhoneNumberId),
  };
}

/** True when the current time is inside the configured sending window (hour range and weekdays, in the chosen time zone, or `tz` when given). */
export function withinSendWindow(s: SettingsRow, now = new Date(), tz?: string | null): boolean {
  let hour: number;
  let weekday: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || s.timezone || "UTC", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(now);
    hour = Number(parts.find((p) => p.type === "hour")?.value ?? now.getUTCHours());
    weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  } catch {
    hour = now.getUTCHours();
    weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getUTCDay()]!;
  }
  if (s.sendWeekdaysOnly && (weekday === "Sat" || weekday === "Sun")) return false;
  return hour >= s.sendWindowStart && hour < s.sendWindowEnd;
}

// ---------- tasks ----------

export async function createTask(entry: { title: string; leadId?: number | null; dealId?: number | null; dueAt?: Date | null; source: string }) {
  const [task] = await db
    .insert(tasksTable)
    .values({ title: entry.title, leadId: entry.leadId ?? null, dealId: entry.dealId ?? null, dueAt: entry.dueAt ?? null, source: entry.source })
    .returning();
  await logActivity({ type: "task_created", description: `Task: ${entry.title}`, leadId: entry.leadId ?? null, dealId: entry.dealId ?? null });
  return task!;
}

// ---------- activity ----------

export async function logActivity(entry: {
  type: string;
  description: string;
  channel?: string | null;
  leadId?: number | null;
  accountId?: number | null;
  dealId?: number | null;
}): Promise<void> {
  await db.insert(activitiesTable).values({
    type: entry.type,
    description: entry.description,
    channel: entry.channel ?? null,
    leadId: entry.leadId ?? null,
    accountId: entry.accountId ?? null,
    dealId: entry.dealId ?? null,
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
  const accountIds = [...new Set(leads.map((l) => l.accountId).filter((x): x is number => x != null))];
  const accounts = accountIds.length
    ? await db.select({ id: accountsTable.id, name: accountsTable.name }).from(accountsTable).where(inArray(accountsTable.id, accountIds))
    : [];
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const ownerIds = [...new Set(leads.map((l) => l.ownerId).filter((x): x is number => x != null))];
  const owners = ownerIds.length
    ? await db.select({ id: teamMembersTable.id, name: teamMembersTable.name }).from(teamMembersTable).where(inArray(teamMembersTable.id, ownerIds))
    : [];
  return leads.map((l) => ({
    ...l,
    ownerName: owners.find((o) => o.id === l.ownerId)?.name ?? null,
    campaignName: l.campaignId != null ? (names.get(l.campaignId) ?? null) : null,
    accountName: l.accountId != null ? (accountNames.get(l.accountId) ?? null) : null,
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
 * Stores an outbound message and delivers it through the connected provider:
 * SMTP mailboxes for email, Unipile for LinkedIn. With no provider connected the
 * message is kept in-app only (deliveryStatus "recorded").
 */
export async function recordOutbound(args: {
  conversation: ConversationRow;
  lead: LeadRow;
  body: string;
  subject: string | null;
  author: "user" | "ai";
  stepOrder?: number | null;
  variant?: string | null;
}) {
  const now = new Date();
  const channel = args.conversation.channel;
  // Never contact anyone on the do-not-contact list, and don't email addresses known to be undeliverable.
  const blocked =
    (channel === "email" || channel === "linkedin") && (await suppressionFor(args.lead))
      ? `On the do-not-contact list`
      : channel === "email" && (args.lead.emailStatus === "invalid" || args.lead.emailStatus === "bounced")
        ? `Email address is ${args.lead.emailStatus}`
        : null;
  const [inserted] = await db
    .insert(outreachMessagesTable)
    .values({
      conversationId: args.conversation.id,
      direction: "outbound",
      channel: args.conversation.channel,
      subject: args.subject,
      body: args.body,
      author: args.author,
      stepOrder: args.stepOrder ?? null,
      variant: args.variant ?? null,
      createdAt: now,
    })
    .returning();
  if (blocked) {
    const [message] = await db
      .update(outreachMessagesTable)
      .set({ deliveryStatus: "blocked", deliveryError: blocked })
      .where(eq(outreachMessagesTable.id, inserted!.id))
      .returning();
    await logActivity({ type: "delivery_blocked", description: `Did not contact ${leadName(args.lead)}: ${blocked}`, channel, leadId: args.lead.id });
    return message!;
  }
  const settings = await getSettings();
  const delivery =
    args.conversation.channel === "email"
      ? await sendEmail({
          settings,
          conversation: args.conversation,
          lead: args.lead,
          subject: args.subject,
          body: args.body,
          trackingToken: inserted!.trackingToken,
          manual: args.author === "user",
        })
      : args.conversation.channel === "linkedin"
        ? await sendLinkedIn({ settings, lead: args.lead, body: args.body })
        : ({ status: "recorded" } as const);
  const [message] = await db
    .update(outreachMessagesTable)
    .set({
      deliveryStatus: delivery.status,
      deliveryError: delivery.status === "failed" ? delivery.error : null,
      externalId: delivery.status === "sent" ? delivery.externalId : null,
      ...(delivery.status === "sent" && delivery.subject ? { subject: delivery.subject } : {}),
    })
    .where(eq(outreachMessagesTable.id, inserted!.id))
    .returning();
  if (delivery.status === "failed") {
    await logActivity({
      type: "delivery_failed",
      description: `${args.conversation.channel === "email" ? "Email" : "LinkedIn message"} to ${leadName(args.lead)} failed: ${delivery.error}`,
      channel: args.conversation.channel,
      leadId: args.lead.id,
    });
  }
  await db
    .update(outreachConversationsTable)
    .set({
      lastMessageAt: now,
      subject: args.conversation.subject ?? args.subject,
      ...(args.author === "user" ? { unread: false } : {}),
      ...(delivery.status === "sent" && delivery.mailboxId
        ? { mailboxId: delivery.mailboxId, externalThreadId: args.conversation.externalThreadId ?? delivery.threadId ?? null }
        : {}),
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
  input: { body: string; subject?: string | null; externalId?: string | null },
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
    deliveryStatus: "received",
    externalId: input.externalId ?? null,
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

  const scheduler = schedulerFor(settings);
  const free = scheduler
    ? await scheduler.findFreeSlots().catch((err) => {
        logger.error({ err }, "Could not read calendar availability");
        return null;
      })
    : null;
  const objections = await db.select().from(objectionsTable);
  const analysis = await analyzeAndDraftReply({
    lead,
    campaign,
    settings,
    channel: conv.channel,
    history,
    objections,
    calendar: free && scheduler && { timezone: free.timezone, summary: free.summary, minutes: scheduler.minutes, canBook: true, inviteNote: scheduler.inviteNote },
  });

  const autoEnabled = settings.globalAutoReply && (campaign?.autoReply ?? false);
  // An objection answered from the approved library is safe to send on its own.
  const risky =
    settings.escalateNegative &&
    (analysis.sentiment === "negative" || (analysis.sentiment === "objection" && !analysis.usedApprovedAnswer));

  if (analysis.bookSlot && scheduler) {
    const start = free?.slots.get(analysis.bookSlot);
    const holdBooking = (reason: string) => {
      analysis.needsHuman = reason;
      analysis.leadStatus = "interested";
    };
    if (!start) holdBooking(`Prospect picked ${analysis.bookSlot}, which is not a free slot on your calendar`);
    else if (!autoEnabled || risky || analysis.needsHuman) holdBooking(`Prospect agreed to ${analysis.bookSlot} (${free!.timezone}); book it and confirm`);
    else {
      try {
        const title = `${settings.companyName} <> ${lead.company || leadName(lead)}`;
        const event = await scheduler.book({ lead, start, title, description: campaign?.goal ? `Intro call: ${campaign.goal}` : "Intro call" });
        await recordMeeting({ lead, startsAt: start, minutes: scheduler.minutes, title, link: event.link, provider: scheduler.provider, externalId: event.externalId });
        await logActivity({
          type: "meeting_booked",
          description: `Booked ${analysis.bookSlot} (${free!.timezone}) with ${leadName(lead)}${event.link ? ` on ${event.link}` : ""}`,
          channel: conv.channel,
          leadId: lead.id,
        });
      } catch (err) {
        logger.error({ err }, "Calendar booking failed");
        holdBooking(`Could not book ${analysis.bookSlot}: ${(err as Error).message}`);
      }
    }
  }

  // ---- reply sorting: act on the type of reply ----
  if (analysis.sentiment === "out_of_office") {
    const back = analysis.returnDate && /^\d{4}-\d{2}-\d{2}$/.test(analysis.returnDate) ? new Date(`${analysis.returnDate}T09:00:00Z`) : null;
    const resumeAt = back && back.getTime() > Date.now() ? new Date(back.getTime() + DAY_MS) : new Date(Date.now() + 7 * DAY_MS);
    // Away messages are not real replies: the sequence continues once they are back.
    await db.update(leadsTable).set({ status: "contacted", nextStepAt: resumeAt }).where(eq(leadsTable.id, lead.id));
    await db
      .update(outreachConversationsTable)
      .set({ status: "snoozed", sentiment: "out_of_office", unread: false })
      .where(eq(outreachConversationsTable.id, conv.id));
    await logActivity({
      type: "reply_sorted",
      description: `${leadName(lead)} is out of office; sequence resumes ${resumeAt.toISOString().slice(0, 10)}`,
      channel: conv.channel,
      leadId: lead.id,
    });
    return;
  }
  if (analysis.sentiment === "unsubscribe" || analysis.leadStatus === "unsubscribed") {
    await suppressLead(lead, "asked to stop").catch((err) => logger.error({ err }, "Could not add to do-not-contact list"));
  }
  if (analysis.sentiment === "not_now") {
    const days = Math.min(365, Math.max(7, Math.round(Number(analysis.followUpDays) || 90)));
    analysis.leadStatus = "nurture";
    await createTask({ title: `Reconnect with ${leadName(lead)} (asked to talk later)`, leadId: lead.id, dueAt: new Date(Date.now() + days * DAY_MS), source: "follow_up" });
  }
  if (analysis.sentiment === "referral" && analysis.referral?.firstName) {
    await addReferral(lead, analysis.referral, campaign?.id ?? null).catch((err) => logger.error({ err }, "Could not add referral"));
  }

  await db
    .update(leadsTable)
    .set({ status: analysis.leadStatus })
    .where(eq(leadsTable.id, lead.id));
  if (analysis.leadStatus === "meeting_booked" && lead.status !== "meeting_booked") {
    await ensureDealForBookedLead(lead.id).catch((err) => logger.error({ err }, "Could not open a deal for booked lead"));
  }

  if (autoEnabled && analysis.shouldReply && !risky && !analysis.needsHuman && conv.channel !== "call") {
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
      description: `AI replied to ${leadName(lead)} (${analysis.sentiment.replace("_", " ")})`,
      channel: conv.channel,
      leadId: lead.id,
    });
  } else {
    const status = analysis.sentiment === "unsubscribe" ? "closed" : "needs_review";
    await db
      .update(outreachConversationsTable)
      .set({ status, sentiment: analysis.sentiment })
      .where(eq(outreachConversationsTable.id, conv.id));
    if (status === "needs_review") {
      await createTask({
        title: analysis.needsHuman
          ? `Reply to ${leadName(lead)} on ${conv.channel}: ${analysis.needsHuman}`
          : `Review ${analysis.sentiment.replace("_", " ")} reply from ${leadName(lead)} on ${conv.channel}`,
        leadId: lead.id,
        dueAt: new Date(Date.now() + DAY_MS),
        source: "review",
      });
    }
  }
  if (analysis.leadStatus !== "replied") {
    await logActivity({
      type: "status_change",
      description: `${leadName(lead)} marked ${analysis.leadStatus.replace("_", " ")}`,
      leadId: lead.id,
    });
  }
}

/** Adds the person a prospect referred us to as a new lead in the same campaign (unless they already exist). */
async function addReferral(from: LeadRow, ref: { firstName: string; lastName?: string | null; email?: string | null; title?: string | null }, campaignId: number | null) {
  const email = ref.email?.trim().toLowerCase() || null;
  if (email) {
    const [existing] = await db.select({ id: leadsTable.id }).from(leadsTable).where(sql`lower(${leadsTable.email}) = ${email}`).limit(1);
    if (existing) return;
  }
  const [created] = await db
    .insert(leadsTable)
    .values({
      firstName: ref.firstName.trim(),
      lastName: ref.lastName?.trim() || "",
      email,
      title: ref.title?.trim() || null,
      company: from.company,
      website: from.website,
      industry: from.industry,
      companyLocation: from.companyLocation,
      accountId: from.accountId,
      ownerId: from.ownerId,
      timezone: from.timezone,
      // Without an email the referral can't be sequenced yet; keep it out of the campaign until one is added.
      campaignId: email ? campaignId : null,
      notes: `Referred by ${leadName(from)}${from.title ? ` (${from.title})` : ""}. Mention them in the first message.`,
    })
    .returning();
  await logActivity({ type: "lead_added", description: `${leadName(from)} referred ${leadName(created!)}; added as a new lead`, leadId: created!.id });
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
  // Do-not-contact list: stop this person's sequence entirely.
  if (await suppressionFor(lead)) {
    await db.update(leadsTable).set({ status: "unsubscribed", nextStepAt: null }).where(eq(leadsTable.id, lead.id));
    await logActivity({ type: "delivery_blocked", description: `${leadName(lead)} is on the do-not-contact list; sequence stopped`, leadId: lead.id });
    return "none";
  }
  // Hold the lead (without advancing) when today's sending capacity for this channel is used up.
  if (step.channel === "email" && lead.email && !(await hasEmailCapacity())) return "none";
  if (step.channel === "linkedin" && lead.linkedinUrl && !(await linkedinQuotaLeft(settings))) return "none";
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
    if (step.channel === "email") {
      // Check the address once before the first email; skip email steps for undeliverable ones.
      const status = lead.emailStatus ?? (await verifyLead(lead).catch(() => null));
      if (status === "invalid" || status === "bounced") return skipStep(lead, steps);
    }
    const variant = variantFor(step, lead.id);
    const content = contentFor(step, variant);
    const msg = await personalizeMessage({
      lead,
      campaign,
      settings,
      channel: step.channel,
      subject: content.subject,
      template: content.template,
      stepNumber: step.stepOrder,
    });
    const conv = await getOrCreateConversation(lead, step.channel, campaign.id, msg.subject);
    await recordOutbound({
      conversation: conv,
      lead,
      body: msg.body,
      subject: msg.subject,
      author: "ai",
      stepOrder: step.stepOrder,
      variant: step.variantTemplate ? variant : null,
    });
    if (step.variantTemplate && !step.abWinner) {
      const winner = await maybePickWinner(step, campaign.name).catch(() => null);
      if (winner) step.abWinner = winner;
    }
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
      nextStepAt: next ? new Date(Date.now() + (immediate ? 0 : next.delayDays * DAY_MS + next.delayHours * HOUR_MS)) : null,
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

/**
 * People who haven't been scheduled for message 1 yet get a send time: the first message's wait,
 * plus `sendGapMinutes` per person ahead of them, unless the person has their own `firstWaitHours`. Returns the leads that are due right now.
 */
async function scheduleFirstMessages(
  leads: LeadRow[],
  campaign: CampaignRow,
  steps: Awaited<ReturnType<typeof loadSteps>>,
) {
  const first = steps[0];
  const firstDelay = first ? first.delayDays * DAY_MS + first.delayHours * HOUR_MS : 0;
  const gap = campaign.sendGapMinutes * 60_000;
  const unscheduled = leads.filter((l) => l.currentStep === 0 && !l.nextStepAt).sort((a, b) => a.id - b.id);
  if (!unscheduled.length || (!firstDelay && !gap && !unscheduled.some((l) => l.firstWaitHours))) return leads;
  const now = Date.now();
  const later = new Set<number>();
  let inGroup = 0;
  for (const lead of unscheduled) {
    // A person's own wait replaces the group pace for them.
    const offset = lead.firstWaitHours != null ? lead.firstWaitHours * HOUR_MS : firstDelay + inGroup++ * gap;
    if (offset <= 0) continue;
    later.add(lead.id);
    await db.update(leadsTable).set({ nextStepAt: new Date(now + offset) }).where(eq(leadsTable.id, lead.id));
  }
  return leads.filter((l) => !later.has(l.id));
}

/** The time zone a person's sequence steps follow: theirs (set or guessed from their location) when enabled, else the account's. */
export function leadTimezone(lead: LeadRow, s: SettingsRow): string {
  return (s.sendInLeadTimezone && (lead.timezone || guessTimezone(lead.companyLocation))) || s.timezone || "UTC";
}

export async function runCampaign(campaignId: number, opts: { respectWindow?: boolean } = {}) {
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
  const now = new Date();
  const eligible = await scheduleFirstMessages(
    dueLeads.filter((l) => l.currentStep < steps.length && (!opts.respectWindow || withinSendWindow(settings, now, leadTimezone(l, settings)))),
    campaign,
    steps,
  );

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
      const settings = await getSettings();
      // With per-person time zones the window is checked for each person instead.
      if (!settings.sendInLeadTimezone && !withinSendWindow(settings)) return;
      const active = await db.select().from(campaignsTable).where(eq(campaignsTable.status, "active"));
      for (const c of active) {
        const result = await runCampaign(c.id, { respectWindow: true });
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
