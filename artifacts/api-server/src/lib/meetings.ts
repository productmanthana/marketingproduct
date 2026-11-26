import { and, desc, eq, gt, inArray, isNull, lte, notInArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  dealsTable,
  leadsTable,
  meetingsTable,
  type LeadRow,
  type MeetingRow,
} from "@workspace/db";
import { meetingFollowUp } from "./ai";
import { CLOSED_STAGES, STAGES, STAGE_PROBABILITY, ensureDealForBookedLead, isClosed, stageLabel, type Stage } from "./crm";
import { createTask, getOrCreateConversation, getSettings, leadName, logActivity, recordOutbound } from "./outreach";
import { logger } from "./logger";

/** Meetings: stored when booked, reminder emails before they start, and an AI follow-up draft once they end. */

const MIN = 60_000;
/** How long after the meeting's end the follow-up is drafted. */
const FOLLOW_UP_AFTER_MIN = 30;

async function openDealId(leadId: number): Promise<number | null> {
  const [deal] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(eq(dealsTable.leadId, leadId), notInArray(dealsTable.stage, CLOSED_STAGES)))
    .orderBy(desc(dealsTable.createdAt))
    .limit(1);
  return deal?.id ?? null;
}

export async function recordMeeting(args: {
  lead: LeadRow;
  startsAt: Date;
  minutes: number;
  title: string;
  link?: string | null;
  provider: "manual" | "google" | "calcom";
  externalId?: string | null;
  notes?: string | null;
}): Promise<MeetingRow> {
  await ensureDealForBookedLead(args.lead.id).catch((err) => logger.error({ err }, "Could not open a deal for the meeting"));
  const [row] = await db
    .insert(meetingsTable)
    .values({
      leadId: args.lead.id,
      dealId: await openDealId(args.lead.id),
      title: args.title,
      startsAt: args.startsAt,
      minutes: args.minutes,
      link: args.link ?? null,
      provider: args.provider,
      externalId: args.externalId ?? null,
      notes: args.notes ?? null,
    })
    .returning();
  if (args.lead.status !== "meeting_booked") {
    await db.update(leadsTable).set({ status: "meeting_booked", nextStepAt: null }).where(eq(leadsTable.id, args.lead.id));
  }
  return row!;
}

function formatWhen(d: Date, tz: string): string {
  return d.toLocaleString("en-US", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

async function loadLead(id: number) {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  return lead ?? null;
}

async function campaignOf(lead: LeadRow) {
  if (!lead.campaignId) return null;
  const [c] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, lead.campaignId));
  return c ?? null;
}

async function sendReminder(m: MeetingRow): Promise<void> {
  const lead = await loadLead(m.leadId);
  // Mark first so a failing send never repeats every minute.
  await db.update(meetingsTable).set({ reminderSentAt: new Date() }).where(eq(meetingsTable.id, m.id));
  if (!lead?.email) return;
  const settings = await getSettings();
  const when = formatWhen(m.startsAt, lead.timezone || settings.timezone || "UTC");
  const body = [
    `Hi ${lead.firstName},`,
    "",
    `Just a quick reminder about our call, ${m.title}, on ${when}.`,
    m.link ? `Join here: ${m.link}` : null,
    "",
    "Looking forward to it. If the time no longer works, just reply and we'll find another.",
    "",
    settings.signature || settings.senderName,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const conv = await getOrCreateConversation(lead, "email", lead.campaignId, `Reminder: ${m.title}`);
  await recordOutbound({ conversation: conv, lead, body, subject: `Reminder: ${m.title}`, author: "ai" });
  await logActivity({ type: "meeting_reminder", description: `Reminder sent to ${leadName(lead)} for ${m.title}`, channel: "email", leadId: lead.id, dealId: m.dealId });
}

/** Moves the meeting's deal one stage forward (never past negotiation, never out of a closed stage). */
async function advanceDeal(dealId: number | null, leadId: number): Promise<void> {
  if (!dealId) return;
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!deal || isClosed(deal.stage)) return;
  const idx = STAGES.indexOf(deal.stage as Stage);
  const next = STAGES[Math.min(idx + 1, STAGES.indexOf("negotiation"))]!;
  if (next === deal.stage) return;
  await db
    .update(dealsTable)
    .set({ stage: next, probability: STAGE_PROBABILITY[next], stageChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(dealsTable.id, deal.id));
  await logActivity({ type: "deal_stage_changed", description: `${deal.name} moved to ${stageLabel(next)} after the meeting`, leadId, dealId: deal.id });
}

export async function draftFollowUp(m: MeetingRow): Promise<MeetingRow> {
  const lead = await loadLead(m.leadId);
  if (!lead) throw new Error("Lead not found");
  const settings = await getSettings();
  const draft = await meetingFollowUp({
    lead,
    campaign: await campaignOf(lead),
    settings,
    meetingTitle: m.title,
    when: formatWhen(m.startsAt, settings.timezone || "UTC"),
    notes: m.notes,
  });
  const [row] = await db
    .update(meetingsTable)
    .set({ followUpSubject: draft.subject, followUpBody: draft.body })
    .where(eq(meetingsTable.id, m.id))
    .returning();
  return row!;
}

/** Marks a finished meeting completed, moves its deal forward and prepares the follow-up for review. */
async function completeMeeting(m: MeetingRow): Promise<void> {
  await db.update(meetingsTable).set({ status: "completed" }).where(eq(meetingsTable.id, m.id));
  const lead = await loadLead(m.leadId);
  if (!lead) return;
  await advanceDeal(m.dealId, lead.id);
  if (!m.followUpBody) await draftFollowUp(m).catch((err) => logger.error({ err }, "Meeting follow-up draft failed"));
  await createTask({ title: `Review and send the follow-up to ${leadName(lead)} (${m.title})`, leadId: lead.id, dealId: m.dealId, dueAt: new Date(), source: "meeting" });
}

export async function sendFollowUp(m: MeetingRow): Promise<MeetingRow> {
  const lead = await loadLead(m.leadId);
  if (!lead?.email) throw new Error("This person has no email address");
  if (!m.followUpBody) throw new Error("Draft the follow-up first");
  const subject = m.followUpSubject || `Following up: ${m.title}`;
  const conv = await getOrCreateConversation(lead, "email", lead.campaignId, subject);
  const msg = await recordOutbound({ conversation: conv, lead, body: m.followUpBody, subject, author: "user" });
  if (msg.deliveryStatus === "failed" || msg.deliveryStatus === "blocked") throw new Error(msg.deliveryError ?? "The email could not be sent");
  const [row] = await db.update(meetingsTable).set({ followUpSentAt: new Date(), status: "completed" }).where(eq(meetingsTable.id, m.id)).returning();
  await logActivity({ type: "meeting_follow_up", description: `Meeting follow-up sent to ${leadName(lead)}`, channel: "email", leadId: lead.id, dealId: m.dealId });
  return row!;
}

export async function meetingTick(): Promise<void> {
  const settings = await getSettings();
  const now = Date.now();
  if (settings.meetingReminderHours > 0) {
    const due = await db
      .select()
      .from(meetingsTable)
      .where(
        and(
          eq(meetingsTable.status, "scheduled"),
          isNull(meetingsTable.reminderSentAt),
          gt(meetingsTable.startsAt, new Date(now)),
          lte(meetingsTable.startsAt, new Date(now + settings.meetingReminderHours * 60 * MIN)),
        ),
      );
    // Skip meetings booked inside the reminder window less than 10 minutes ago: the confirmation just went out.
    for (const m of due.filter((x) => now - x.createdAt.getTime() > 10 * MIN)) {
      await sendReminder(m).catch((err) => logger.error({ err, meetingId: m.id }, "Meeting reminder failed"));
    }
  }
  const scheduled = await db.select().from(meetingsTable).where(and(eq(meetingsTable.status, "scheduled"), lte(meetingsTable.startsAt, new Date(now))));
  for (const m of scheduled.filter((x) => x.startsAt.getTime() + (x.minutes + FOLLOW_UP_AFTER_MIN) * MIN <= now)) {
    await completeMeeting(m).catch((err) => logger.error({ err, meetingId: m.id }, "Completing meeting failed"));
  }
}

export function startMeetingAutomation(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await meetingTick();
    } catch (err) {
      logger.error({ err }, "Meeting automation tick failed");
    } finally {
      running = false;
    }
  }, 60_000);
}

export async function serializeMeetings(rows: MeetingRow[]) {
  if (!rows.length) return [];
  const leads = await db.select().from(leadsTable).where(inArray(leadsTable.id, [...new Set(rows.map((r) => r.leadId))]));
  const dealIds = [...new Set(rows.map((r) => r.dealId).filter((x): x is number => x != null))];
  const deals = dealIds.length ? await db.select({ id: dealsTable.id, name: dealsTable.name }).from(dealsTable).where(inArray(dealsTable.id, dealIds)) : [];
  return rows.map((m) => {
    const lead = leads.find((l) => l.id === m.leadId);
    return {
      ...m,
      leadName: lead ? leadName(lead) : "Unknown",
      leadCompany: lead?.company ?? null,
      leadEmail: lead?.email ?? null,
      dealName: deals.find((d) => d.id === m.dealId)?.name ?? null,
    };
  });
}
