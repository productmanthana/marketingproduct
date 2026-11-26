import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import {
  useGetCalendar, useListConversationFreeSlots, getListConversationFreeSlotsQueryKey, useBookConversationMeeting,
  type BookMeetingResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/components/bits";

const AUTO = "auto";

/** "2026-11-27 10:00" -> "Fri 27 Nov, 10:00" */
const slotText = (slot: string) => {
  const [date, time] = slot.split(" ");
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${d}, ${time}`;
};

/** With a calendar connected: book the meeting right from the Inbox (pick a time, or let the AI pick) and draft the confirmation with the meeting link. */
export function BookMeetingPrompt({ conversationId, onBooked }: { conversationId: number; onBooked: (r: BookMeetingResult) => void }) {
  const cal = useGetCalendar();
  const enabled = !!cal.data && cal.data.provider !== "none";
  const slots = useListConversationFreeSlots(conversationId, { query: { queryKey: getListConversationFreeSlotsQueryKey(conversationId), enabled, retry: false } });
  const book = useBookConversationMeeting();
  const { toast } = useToast();
  const [slot, setSlot] = useState(AUTO);
  const [booked, setBooked] = useState(false);
  if (!enabled || booked) return null;

  const submit = () =>
    book.mutate({ id: conversationId, data: { slot: slot === AUTO ? null : slot } }, {
      onSuccess: (r) => {
        setBooked(true);
        toast({ title: "Meeting booked", description: `${slotText(r.slot)} (${r.timezone}). Confirmation drafted below, press Send.` });
        onBooked(r);
      },
      onError: (e) => toast({ title: "Could not book", description: errMsg(e), variant: "destructive" }),
    });

  const s = slots.data;
  return (
    <div className="rounded-lg border border-primary/30 bg-accent/50 p-3 text-xs" data-testid="prompt-book-meeting">
      <div className="mb-2 flex items-center gap-1.5 font-semibold"><CalendarPlus className="h-3.5 w-3.5 text-primary" />Book the meeting</div>
      <p className="mb-2 text-muted-foreground">
        Creates the meeting on {s?.provider === "calcom" ? "Cal.com" : "your calendar"}, sends the invite with the meeting link, and drafts the confirmation. <b>Auto</b> lets the AI pick the time that fits the prospect's message.
      </p>
      <div className="flex gap-2">
        <select className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-xs" value={slot} onChange={(e) => setSlot(e.target.value)} disabled={book.isPending} data-testid="select-meeting-slot">
          <option value={AUTO}>Auto (AI picks the best time)</option>
          {s?.slots.map((x) => <option key={x} value={x}>{slotText(x)} ({s.timezone})</option>)}
        </select>
        <Button size="sm" disabled={book.isPending} onClick={submit} data-testid="button-book-meeting">
          {book.isPending ? "Booking..." : "Create meeting & draft reply"}
        </Button>
      </div>
      {slots.isLoading && <p className="mt-1.5 text-muted-foreground">Loading free times...</p>}
      {slots.isError && <p className="mt-1.5 text-destructive">{errMsg(slots.error)}</p>}
    </div>
  );
}
