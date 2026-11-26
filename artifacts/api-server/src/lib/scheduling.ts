import { and, asc, eq, gt } from "drizzle-orm";
import { db, meetingsTable, type LeadRow, type MeetingRow, type SettingsRow } from "@workspace/db";
import { bookMeeting, calendarConnected, findFreeSlots, type FreeSlots } from "./calendar";
import { calcomBook, calcomConnected, calcomFreeSlots, calcomReschedule } from "./calcom";
import { recordMeeting } from "./meetings";
import { leadName } from "./outreach";

/** The calendar the AI books on: Cal.com when its API key and meeting type are set, otherwise Google Calendar. */
export type Scheduler = {
  provider: "google" | "calcom";
  minutes: number;
  /** What the prospect receives, for the AI's confirmation message. */
  inviteNote: string;
  findFreeSlots: () => Promise<FreeSlots>;
  book: (args: { lead: LeadRow; start: Date; title: string; description: string }) => Promise<{ link: string | null; externalId: string | null }>;
  /** Moves an existing booking (by its provider id); absent when the provider can't. */
  reschedule?: (externalId: string, start: Date) => Promise<{ link: string | null; externalId: string | null }>;
};

export function schedulerFor(s: SettingsRow): Scheduler | null {
  if (calcomConnected(s)) {
    return {
      provider: "calcom",
      minutes: s.calcomEventLength ?? s.meetingMinutes,
      inviteNote: "a calendar invite from Cal.com with the meeting link is on its way",
      findFreeSlots: () => calcomFreeSlots(s),
      book: async ({ lead, start }) => {
        if (!lead.email) throw new Error("The prospect has no email address for the Cal.com invite");
        const r = await calcomBook(s, { start, attendeeEmail: lead.email, attendeeName: leadName(lead), attendeeTimezone: lead.timezone });
        return { link: r.meetLink, externalId: r.uid };
      },
      reschedule: async (uid, start) => {
        const r = await calcomReschedule(s, uid, start);
        return { link: r.meetLink, externalId: r.uid };
      },
    };
  }
  if (calendarConnected(s)) {
    return {
      provider: "google",
      minutes: s.meetingMinutes,
      inviteNote: "a Google Calendar invite with the Google Meet link is on its way",
      findFreeSlots: () => findFreeSlots(s),
      book: async ({ lead, start, title, description }) => {
        const r = await bookMeeting(s, { start, attendeeEmail: lead.email, attendeeName: leadName(lead), summary: title, description });
        return { link: r.meetLink ?? r.htmlLink, externalId: null };
      },
    };
  }
  return null;
}

/** The lead's next scheduled meeting, if any. */
export async function upcomingMeeting(leadId: number): Promise<MeetingRow | null> {
  const [m] = await db
    .select()
    .from(meetingsTable)
    .where(and(eq(meetingsTable.leadId, leadId), eq(meetingsTable.status, "scheduled"), gt(meetingsTable.startsAt, new Date())))
    .orderBy(asc(meetingsTable.startsAt))
    .limit(1);
  return m ?? null;
}

/** What the AI needs to know about the calendar for this lead (canBook is set by the caller). */
export async function calendarContext(lead: LeadRow, free: FreeSlots, scheduler: Scheduler) {
  const existing = await upcomingMeeting(lead.id);
  const fmt = (d: Date) => d.toLocaleString("sv-SE", { timeZone: free.timezone, dateStyle: "short", timeStyle: "short" });
  return {
    timezone: free.timezone,
    summary: free.summary,
    minutes: scheduler.minutes,
    inviteNote: scheduler.inviteNote,
    leadTimezone: lead.timezone,
    existingMeeting: existing ? `${fmt(existing.startsAt)} (${free.timezone})` : null,
  };
}

/** Books the meeting, or moves the lead's upcoming one on the same calendar when it can (so a reschedule never leaves two bookings). */
export async function bookOrReschedule(
  scheduler: Scheduler,
  args: { lead: LeadRow; start: Date; title: string; description: string },
): Promise<{ link: string | null; rescheduled: boolean }> {
  const existing = await upcomingMeeting(args.lead.id);
  if (existing?.externalId && existing.provider === scheduler.provider && scheduler.reschedule) {
    const r = await scheduler.reschedule(existing.externalId, args.start);
    const link = r.link ?? existing.link;
    await db
      .update(meetingsTable)
      .set({ startsAt: args.start, minutes: scheduler.minutes, link, externalId: r.externalId ?? existing.externalId, reminderSentAt: null })
      .where(eq(meetingsTable.id, existing.id));
    return { link, rescheduled: true };
  }
  const event = await scheduler.book(args);
  await recordMeeting({ lead: args.lead, startsAt: args.start, minutes: scheduler.minutes, title: args.title, link: event.link, provider: scheduler.provider, externalId: event.externalId });
  return { link: event.link, rescheduled: false };
}
