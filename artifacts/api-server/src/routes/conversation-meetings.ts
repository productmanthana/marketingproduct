import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, campaignsTable, leadsTable, objectionsTable, outreachConversationsTable, outreachMessagesTable } from "@workspace/db";
import {
  BookConversationMeetingBody,
  BookConversationMeetingParams,
  BookConversationMeetingResponse,
  ListConversationFreeSlotsParams,
  ListConversationFreeSlotsResponse,
} from "@workspace/api-zod";
import { analyzeAndDraftReply } from "../lib/ai";
import { bookOrReschedule, calendarContext, schedulerFor } from "../lib/scheduling";
import { getSettings, leadName, logActivity } from "../lib/outreach";

/** Book a meeting with a lead straight from the Inbox, on the connected calendar (Cal.com or Google). */
const router: IRouter = Router();

/** "2026-11-27 10:00" -> "Friday, 27 November at 10:00" */
const slotLabel = (slot: string) => {
  const [date, time] = slot.split(" ");
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return `${day} at ${time}`;
};

router.get("/conversations/:id/free-slots", async (req, res): Promise<void> => {
  const params = ListConversationFreeSlotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const settings = await getSettings();
  const scheduler = schedulerFor(settings);
  if (!scheduler) {
    res.json(ListConversationFreeSlotsResponse.parse({ provider: "none", timezone: settings.timezone || "UTC", minutes: settings.meetingMinutes, slots: [] }));
    return;
  }
  try {
    const free = await scheduler.findFreeSlots();
    res.json(ListConversationFreeSlotsResponse.parse({ provider: scheduler.provider, timezone: free.timezone, minutes: scheduler.minutes, slots: [...free.slots.keys()] }));
  } catch (err) {
    res.status(400).json({ error: `Could not read your calendar: ${(err as Error).message}` });
  }
});

router.post("/conversations/:id/book-meeting", async (req, res): Promise<void> => {
  const params = BookConversationMeetingParams.safeParse(req.params);
  const body = BookConversationMeetingBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)!.message });
    return;
  }
  const [conv] = await db.select().from(outreachConversationsTable).where(eq(outreachConversationsTable.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
  const settings = await getSettings();
  const scheduler = schedulerFor(settings);
  if (!scheduler) {
    res.status(400).json({ error: "Connect Cal.com in Settings first" });
    return;
  }
  const campaignId = conv.campaignId ?? lead!.campaignId;
  const campaign = campaignId ? ((await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)))[0] ?? null) : null;

  try {
    const free = await scheduler.findFreeSlots();
    let slot = body.data.slot ?? null;
    if (!slot) {
      // Auto: the AI picks the time that fits what the prospect said, else the earliest free one.
      const history = await db
        .select()
        .from(outreachMessagesTable)
        .where(eq(outreachMessagesTable.conversationId, conv.id))
        .orderBy(asc(outreachMessagesTable.createdAt), asc(outreachMessagesTable.id));
      const analysis = await analyzeAndDraftReply({
        lead: lead!,
        campaign,
        settings,
        channel: conv.channel,
        history,
        objections: await db.select().from(objectionsTable),
        calendar: { ...(await calendarContext(lead!, free, scheduler)), canBook: true },
      }).catch(() => null);
      slot = analysis?.bookSlot && free.slots.has(analysis.bookSlot) ? analysis.bookSlot : ([...free.slots.keys()][0] ?? null);
    }
    const start = slot ? free.slots.get(slot) : undefined;
    if (!slot || !start) {
      res.status(400).json({ error: slot ? `${slot} is no longer free on your calendar` : "No free times on your calendar in the next week" });
      return;
    }

    const title = `${settings.companyName} <> ${lead!.company || leadName(lead!)}`;
    const event = await bookOrReschedule(scheduler, { lead: lead!, start, title, description: campaign?.goal ? `Intro call: ${campaign.goal}` : "Intro call" });
    await db.update(leadsTable).set({ status: "meeting_booked" }).where(eq(leadsTable.id, lead!.id));
    await logActivity({
      type: "meeting_booked",
      description: `${event.rescheduled ? "Rescheduled to" : "Booked"} ${slot} (${free.timezone}) with ${leadName(lead!)}${event.link ? ` on ${event.link}` : ""}`,
      channel: conv.channel,
      leadId: lead!.id,
    });

    const reply = [
      `Hi ${lead!.firstName},`,
      "",
      `${event.rescheduled ? "I've moved our meeting to" : "I've booked us for"} ${slotLabel(slot)} (${free.timezone}), ${scheduler.minutes} minutes.`,
      event.link ? `Meeting link: ${event.link}` : null,
      "A calendar invite is on its way to your inbox.",
      "",
      "Best,",
      settings.senderName,
    ].filter((l) => l !== null).join("\n");
    const subject = conv.subject ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`) : null;
    res.json(BookConversationMeetingResponse.parse({ slot, timezone: free.timezone, link: event.link, subject, body: reply }));
  } catch (err) {
    res.status(400).json({ error: `Could not book the meeting: ${(err as Error).message}` });
  }
});

export default router;
