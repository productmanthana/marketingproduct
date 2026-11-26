import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { useGetCampaign, getGetCampaignQueryKey, useUpdateCampaign, useGetCalendar } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/** Lets you add the campaign's booking link right from the Inbox, then drafts the reply with it. */
export function MeetingLinkPrompt({ campaignId, onSaved }: { campaignId: number; onSaved: () => void }) {
  const q = useGetCampaign(campaignId, { query: { queryKey: getGetCampaignQueryKey(campaignId) } });
  const cal = useGetCalendar();
  const update = useUpdateCampaign();
  const { toast } = useToast();
  const [link, setLink] = useState("");
  // With Google Calendar connected the AI books meetings itself, so no link is needed.
  if (!q.data || q.data.meetingLink || cal.data?.connected) return null;

  const valid = /^https?:\/\/\S+\.\S+/.test(link.trim());
  const save = () =>
    update.mutate({ id: campaignId, data: { meetingLink: link.trim() } }, {
      onSuccess: () => { q.refetch(); toast({ title: "Meeting link saved", description: `The AI will use it for every reply in "${q.data?.name}".` }); onSaved(); },
      onError: () => toast({ title: "Could not save link", variant: "destructive" }),
    });

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="prompt-meeting-link">
      <div className="mb-2 flex items-center gap-1.5 font-semibold"><CalendarPlus className="h-3.5 w-3.5" />Add your meeting link</div>
      <p className="mb-2 text-amber-800">Paste your booking link (Google Calendar, Calendly, Zoho Bookings...). It is saved to this campaign and the AI writes the reply with it.</p>
      <div className="flex gap-2">
        <Input className="h-8 bg-card text-xs" placeholder="https://calendly.com/your-name/20min" value={link} onChange={(e) => setLink(e.target.value)} data-testid="input-meeting-link" />
        <Button size="sm" disabled={!valid || update.isPending} onClick={save} data-testid="button-save-meeting-link">
          {update.isPending ? "Saving..." : "Save & draft reply"}
        </Button>
      </div>
      <a className="mt-2 inline-block text-amber-700 underline" href="/settings">Or connect Google Calendar in Settings so the AI books meetings itself</a>
    </div>
  );
}
