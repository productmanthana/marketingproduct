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
      <PageHeader eyebrow="Sequences" title="Campaigns">
        <Button onClick={() => setOpen(true)} data-testid="button-new-campaign"><Plus className="mr-1 h-4 w-4" />New campaign</Button>
      </PageHeader>
      <div className="p-6 md:p-8">
        {q.isLoading ? <Rows n={4} h={92} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty icon={Send} title="No campaigns yet" body="A campaign is a goal, a pitch, and a multichannel sequence the machine runs for you.">
            <Button onClick={() => setOpen(true)} data-testid="button-empty-new-campaign">Create the first one</Button>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-card-border bg-card">
            <div className="hidden grid-cols-[1fr_140px_repeat(4,72px)_90px] gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid">
              <span>Campaign</span><span>Channels</span><span className="text-right">Leads</span><span className="text-right">Sent</span><span className="text-right">Replies</span><span className="text-right">Mtgs</span><span className="text-right">Status</span>
            </div>
            {q.data.map((c, i) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="rise grid grid-cols-2 items-center gap-3 border-b border-border px-5 py-4 last:border-0 hover:bg-muted/40 md:grid-cols-[1fr_140px_repeat(4,72px)_90px]" style={{ animationDelay: `${i * 40}ms` }} data-testid={`link-campaign-${c.id}`}>
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <div className="font-display text-[17px] font-bold">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.goal} · {c.stepCount} steps{c.autoReply && <span className="ml-2 text-primary">AI auto-reply</span>}</div>
                </div>
                <div className="flex gap-1">{c.channels.map((x) => <ChannelTag key={x} channel={x as Ch} compact />)}</div>
                {[c.leadCount, c.sentCount, c.replyCount, c.meetingCount].map((n, j) => <span key={j} className="hidden text-right font-mono text-sm tnum md:block">{n}</span>)}
                <div className="text-right"><Pill value={c.status} /></div>
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
      onSuccess: (c) => { refresh(); toast({ title: "Campaign created", description: "Now build the sequence." }); onOpenChange(false); nav(`/campaigns/${c.id}`); },
      onError: () => toast({ title: "Could not create campaign", variant: "destructive" }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">New campaign</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Q3 fintech CFOs" data-testid="input-campaign-name" /></div>
          <div><Label>Goal</Label><Input value={f.goal} onChange={(e) => set("goal", e.target.value)} data-testid="input-campaign-goal" /></div>
          <div><Label>Product pitch (the AI reads this)</Label><Textarea rows={3} value={f.productPitch} onChange={(e) => set("productPitch", e.target.value)} placeholder="What you sell, who it's for, why now." data-testid="input-campaign-pitch" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Reply tone</Label>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.replyTone || settings?.defaultTone || "friendly"} onChange={(e) => set("replyTone", e.target.value)} data-testid="select-campaign-tone">
                {TONE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div><Label>Meeting link</Label><Input value={f.meetingLink} onChange={(e) => set("meetingLink", e.target.value)} placeholder="cal.com/you/20min" data-testid="input-campaign-meeting" /></div>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
            <span><b>AI auto-reply</b><span className="block text-xs text-muted-foreground">Answer inbound replies in context automatically</span></span>
            <Switch checked={f.autoReply} onCheckedChange={(v) => set("autoReply", v)} data-testid="switch-campaign-autoreply" />
          </label>
        </div>
        <DialogFooter><Button onClick={submit} disabled={!f.name.trim() || create.isPending} data-testid="button-create-campaign">{create.isPending ? "Creating..." : "Create campaign"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
