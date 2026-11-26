import { Link } from "wouter";
import { useGetCampaign } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Rows, CH, chColor, type Ch } from "@/components/bits";

const wait = (d: number, h: number) => [d && `${d} day${d === 1 ? "" : "s"}`, h && `${h} hour${h === 1 ? "" : "s"}`].filter(Boolean).join(" ") || "no wait";

/** Shows every message of one channel (email, LinkedIn or call) in a campaign. */
export function ChannelMessagesDialog({ campaignId, campaignName, channel, onClose }: { campaignId: number; campaignName: string; channel: Ch; onClose: () => void }) {
  const q = useGetCampaign(campaignId);
  const all = [...(q.data?.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
  const steps = all.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.channel === channel);
  const I = CH[channel].icon;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <span className="grid h-7 w-7 place-items-center rounded-md text-white" style={{ background: chColor(channel) }}><I className="h-4 w-4" /></span>
            {CH[channel].label} messages · {campaignName}
          </DialogTitle>
        </DialogHeader>
        {q.isLoading ? <Rows n={3} h={70} /> : !steps.length ? <p className="text-sm text-muted-foreground">No {CH[channel].label.toLowerCase()} messages in this campaign.</p> : (
          <div className="space-y-3">
            {steps.map(({ s, n }) => (
              <div key={s.id} className="rounded-lg border border-border bg-background/60 p-3" data-testid={`channel-step-${s.id}`}>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold" style={{ color: chColor(channel) }}>Message {n} of {all.length}</span>
                  <span>{n === 1 ? "sent right away" : `after ${wait(s.delayDays, s.delayHours)}`}</span>
                </div>
                {s.subject && <div className="text-sm font-medium">{s.subject}</div>}
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.template}</p>
              </div>
            ))}
          </div>
        )}
        <Link href={`/campaigns/${campaignId}`} className="text-sm font-medium text-primary hover:underline" data-testid="link-edit-channel-messages">Edit messages</Link>
      </DialogContent>
    </Dialog>
  );
}
