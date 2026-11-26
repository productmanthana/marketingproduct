import type { LeadRow, SettingsRow } from "@workspace/db";
import { bookMeeting, calendarConnected, findFreeSlots, type FreeSlots } from "./calendar";
import { calcomBook, calcomConnected, calcomFreeSlots } from "./calcom";
import { leadName } from "./outreach";

/** The calendar the AI books on: Cal.com when its API key and meeting type are set, otherwise Google Calendar. */
export type Scheduler = {
  provider: "google" | "calcom";
  minutes: number;
  /** What the prospect receives, for the AI's confirmation message. */
  inviteNote: string;
  findFreeSlots: () => Promise<FreeSlots>;
  book: (args: { lead: LeadRow; start: Date; title: string; description: string }) => Promise<{ link: string | null; externalId: string | null }>;
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
