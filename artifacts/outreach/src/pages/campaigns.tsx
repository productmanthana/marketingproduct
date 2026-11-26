import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Send } from "lucide-react";
import { useListCampaigns, useCreateCampaign, useGetSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Rows, ErrorBox, Empty, ChannelTag, Pill, useRefreshAll, TONE_OPTIONS, type Ch } from "@/components/bits";

export default function Campaigns() {
  const q = useListCampaigns();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader eyebrow="Outreach" title="Campaigns">
        <Button onClick={() => setOpen(true)} data-testid="button-new-campaign"><Plus className="mr-1 h-4 w-4" />New campaign</Button>
      </PageHeader>
      <div className="p-6 md:p-8">
        {q.isLoading ? <Rows n={4} h={92} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty icon={Send} title="No campaigns yet" body="A campaign is a series of messages (email, LinkedIn, calls) sent to a group of people. You set it up in 4 simple steps.">
            <Button onClick={() => setOpen(true)} data-testid="button-empty-new-campaign">Create the first one</Button>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-card-border bg-card">
            <div className="hidden grid-cols-[1fr_140px_repeat(4,72px)_90px] gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid">
              <span>Campaign</span><span>Sends by</span><span className="text-right">People</span><span className="text-right">Sent</span><span className="text-right">Replies</span><span className="text-right">Meetings</span><span className="text-right">Status</span>
            </div>
            {q.data.map((c, i) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="rise grid grid-cols-2 items-center gap-3 border-b border-border px-5 py-4 last:border-0 hover:bg-muted/40 md:grid-cols-[1fr_140px_repeat(4,72px)_90px]" style={{ animationDelay: `${i * 40}ms` }} data-testid={`link-campaign-${c.id}`}>
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <div className="font-display text-[17px] font-bold">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.goal} · {c.stepCount} message{c.stepCount === 1 ? "" : "s"}{c.autoReply && <span className="ml-2 text-primary">AI answers replies</span>}</div>
                </div>
                <div className="flex gap-1">{c.channels.map((x) => <ChannelTag key={x} channel={x as Ch} compact />)}</div>
                {[c.leadCount, c.sentCount, c.replyCount, c.meetingCount].map((n, j) => <span key={j} className="hidden text-right font-mono text-sm tnum md:block">{n}</span>)}
                <div className="text-right text-xs font-medium">{({ draft: "Not started", active: "Sending", paused: "Paused", completed: "Finished" } as Record<string, string>)[c.status] ?? c.status}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <NewCampaign open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewCampaign({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: settings } = useGetSettings();
  const create = useCreateCampaign();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [f, setF] = useState({ name: "", description: "", goal: "Book a 20 minute intro call", productPitch: "", replyTone: "", meetingLink: "", autoReply: true });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const submit = () => {
    if (!f.name.trim()) return;
    create.mutate({ data: { ...f, replyTone: f.replyTone || settings?.defaultTone || "friendly" } }, {
      onSuccess: (c) => { refresh(); toast({ title: "Campaign created", description: "Next: add your messages." }); onOpenChange(false); nav(`/campaigns/${c.id}`); },
      onError: () => toast({ title: "Could not create campaign", variant: "destructive" }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">New campaign</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Give it a name and say what you're offering. You'll write the messages and pick the people on the next screen.</p>
        <div className="grid gap-3">
          <div><Label>Campaign name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Example: Clinics in Bangalore" data-testid="input-campaign-name" /></div>
          <div><Label>What do you want people to do?</Label><Input value={f.goal} onChange={(e) => set("goal", e.target.value)} data-testid="input-campaign-goal" /></div>
          <div><Label>What do you sell, and who is it for?</Label><Textarea rows={4} value={f.productPitch} onChange={(e) => set("productPitch", e.target.value)} placeholder="2–3 sentences. The AI uses this to write your messages and replies." data-testid="input-campaign-pitch" /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={!f.name.trim() || create.isPending} data-testid="button-create-campaign">{create.isPending ? "Creating..." : "Next: write messages"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
