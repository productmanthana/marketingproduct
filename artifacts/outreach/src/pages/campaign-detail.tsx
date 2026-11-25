import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowDown, ArrowUp, ChevronLeft, Pencil, Plus, Rocket, Sparkles, Trash2, UserPlus, Users, Workflow } from "lucide-react";
import {
  useGetCampaign, useUpdateCampaign, useDeleteCampaign, useAddSequenceStep, useUpdateSequenceStep, useDeleteSequenceStep,
  useEnrollLeads, useGenerateCampaignSequence, useRunCampaign, useListLeads,
} from "@workspace/api-client-react";
import type { RunResult, SequenceStep } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Panel, Rows, ErrorBox, Empty, ChannelTag, Pill, AiWorking, Initials, useRefreshAll, CH, chColor, TONE_OPTIONS, ago, type Ch } from "@/components/bits";

const STATUSES = ["draft", "active", "paused", "completed"] as const;

export default function CampaignDetail() {
  const id = Number(useParams().id);
  const q = useGetCampaign(id);
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const update = useUpdateCampaign();
  const del = useDeleteCampaign();
  const gen = useGenerateCampaignSequence();
  const run = useRunCampaign();
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [stepEdit, setStepEdit] = useState<SequenceStep | "new" | null>(null);
  const [enroll, setEnroll] = useState(false);
  const c = q.data;

  if (q.isLoading) return <div className="p-8"><Rows n={6} h={70} /></div>;
  if (q.isError || !c) return <ErrorBox onRetry={() => q.refetch()} />;

  const patch = (data: Parameters<typeof update.mutate>[0]["data"], msg = "Saved") =>
    update.mutate({ id, data }, { onSuccess: () => { refresh(); toast({ title: msg }); } });

  const steps = [...c.steps].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div>
      <div className="px-6 pt-5 md:px-8"><Link href="/campaigns" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-campaigns"><ChevronLeft className="h-3 w-3" />Campaigns</Link></div>
      <PageHeader eyebrow={`Campaign #${c.id} · created ${ago(c.createdAt)}`} title={<span className="flex items-center gap-3">{c.name}<Pill value={c.status} /></span>}>
        <select className="h-9 rounded-md border border-input bg-card px-2 text-sm capitalize" value={c.status} onChange={(e) => patch({ status: e.target.value as typeof STATUSES[number] }, "Status updated")} data-testid="select-campaign-status">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" size="icon" onClick={() => setConfirmDel(true)} data-testid="button-delete-campaign"><Trash2 className="h-4 w-4" /></Button>
        <Button disabled={run.isPending || !steps.length || !c.leadCount} data-testid="button-run-campaign"
          onClick={() => run.mutate({ id }, { onSuccess: (r) => { setResult(r); refresh(); toast({ title: "Campaign run complete", description: `${r.messagesSent} messages, ${r.callsScheduled} calls` }); }, onError: () => toast({ title: "Run failed", variant: "destructive" }) })}>
          <Rocket className={`mr-1.5 h-4 w-4 ${run.isPending ? "animate-bounce" : ""}`} />{run.isPending ? "Running..." : "Run campaign"}
        </Button>
      </PageHeader>

      <div className="space-y-5 p-6 md:p-8">
        {run.isPending && <AiWorking text="Personalizing and sending the next step for every enrolled lead" />}
        {result && !run.isPending && (
          <div className="pop grid grid-cols-3 overflow-hidden rounded-xl bg-foreground text-background" data-testid="panel-run-result">
            {([["Leads processed", result.leadsProcessed], ["Messages sent", result.messagesSent], ["Calls scheduled", result.callsScheduled]] as const).map(([k, v], i) => (
              <div key={k} className="border-r border-background/10 p-4 last:border-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">{k}</div>
                <div className={`font-display mt-1 text-3xl font-bold tnum ${i === 1 ? "text-primary" : ""}`}>{v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-card-border bg-border md:grid-cols-4">
          {([["Leads", c.leadCount], ["Sent", c.sentCount], ["Replies", c.replyCount], ["Meetings", c.meetingCount]] as const).map(([k, v]) => (
            <div key={k} className="bg-card p-4"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</div><div className="font-display text-2xl font-bold tnum">{v}</div></div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <Panel title="Settings"><SettingsForm c={c} onSave={(d) => patch(d)} saving={update.isPending} /></Panel>

          <Panel title={`Sequence · ${steps.length} steps`} delay={80} action={
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={gen.isPending} data-testid="button-generate-sequence"
                onClick={() => gen.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: "Sequence generated" }); }, onError: () => toast({ title: "Generation failed", variant: "destructive" }) })}>
                <Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />{gen.isPending ? "Writing..." : "Generate with AI"}
              </Button>
              <Button size="sm" onClick={() => setStepEdit("new")} data-testid="button-add-step"><Plus className="mr-1 h-3.5 w-3.5" />Step</Button>
            </div>}>
            {gen.isPending && <div className="p-4"><AiWorking text="Drafting a multichannel sequence from your goal and pitch" /></div>}
            {!steps.length && !gen.isPending ? (
              <Empty icon={Workflow} title="No steps yet" body="Let the AI draft a sequence from your pitch, or add steps by hand." />
            ) : (
              <ol className="relative p-4">
                {steps.map((s, i) => <StepRow key={s.id} s={s} i={i} last={i === steps.length - 1} campaignId={id} prev={steps[i - 1]} next={steps[i + 1]} onEdit={() => setStepEdit(s)} />)}
              </ol>
            )}
          </Panel>
        </div>

        <Panel title={`Enrolled leads · ${c.leads.length}`} delay={140} action={<Button size="sm" variant="outline" onClick={() => setEnroll(true)} data-testid="button-enroll-leads"><UserPlus className="mr-1 h-3.5 w-3.5" />Enroll leads</Button>}>
          {!c.leads.length ? <Empty icon={Users} title="Nobody enrolled" body="Enroll leads, then hit Run. Each lead moves through the sequence step by step." /> : (
            <div className="divide-y divide-border">
              {c.leads.map((l, i) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="rise flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40" style={{ animationDelay: `${i * 20}ms` }} data-testid={`link-enrolled-${l.id}`}>
                  <Initials name={`${l.firstName} ${l.lastName}`} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{l.firstName} {l.lastName}</div><div className="truncate text-xs text-muted-foreground">{l.title} {l.company && `at ${l.company}`}</div></div>
                  <span className="font-mono text-[11px] text-muted-foreground">step {l.currentStep ?? 0}/{steps.length}</span>
                  <Pill value={l.status} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {stepEdit && <StepDialog campaignId={id} step={stepEdit === "new" ? null : stepEdit} onClose={() => setStepEdit(null)} />}
      {enroll && <EnrollDialog campaignId={id} enrolled={c.leads.map((l) => l.id)} onClose={() => setEnroll(false)} />}
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {c.name}?</AlertDialogTitle><AlertDialogDescription>The sequence is removed. Leads stay in your database.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-campaign" onClick={() => del.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: "Campaign deleted" }); nav("/campaigns"); } })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type CampaignLike = { id: number; name: string; description?: string | null; goal: string; productPitch?: string | null; replyTone: string; meetingLink?: string | null; autoReply: boolean };
function SettingsForm({ c, onSave, saving }: { c: CampaignLike; onSave: (d: { name: string; description: string; goal: string; productPitch: string; replyTone: string; meetingLink: string; autoReply: boolean }) => void; saving: boolean }) {
  const init = () => ({ name: c.name, description: c.description ?? "", goal: c.goal, productPitch: c.productPitch ?? "", replyTone: c.replyTone, meetingLink: c.meetingLink ?? "", autoReply: c.autoReply });
  const [f, setF] = useState(init);
  const forId = useRef(c.id);
  useEffect(() => { if (forId.current !== c.id) { forId.current = c.id; setF(init()); } }, [c.id]); // eslint-disable-line
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="grid gap-3 p-4">
      <div><Label className="text-xs">Name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="input-edit-name" /></div>
      <div><Label className="text-xs">Description</Label><Input value={f.description} onChange={(e) => set("description", e.target.value)} data-testid="input-edit-description" /></div>
      <div><Label className="text-xs">Goal</Label><Input value={f.goal} onChange={(e) => set("goal", e.target.value)} data-testid="input-edit-goal" /></div>
      <div><Label className="text-xs">Product pitch</Label><Textarea rows={4} value={f.productPitch} onChange={(e) => set("productPitch", e.target.value)} data-testid="input-edit-pitch" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label className="text-xs">Tone</Label>
          <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.replyTone} onChange={(e) => set("replyTone", e.target.value)} data-testid="select-edit-tone">
            {Array.from(new Set([...TONE_OPTIONS, f.replyTone])).map((t) => <option key={t}>{t}</option>)}
          </select></div>
        <div><Label className="text-xs">Meeting link</Label><Input value={f.meetingLink} onChange={(e) => set("meetingLink", e.target.value)} data-testid="input-edit-meeting" /></div>
      </div>
      <label className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
        <span><b>AI auto-reply</b><span className="block text-xs text-muted-foreground">Answers inbound in context</span></span>
        <Switch checked={f.autoReply} onCheckedChange={(v) => set("autoReply", v)} data-testid="switch-edit-autoreply" />
      </label>
      <Button onClick={() => onSave(f)} disabled={saving} data-testid="button-save-campaign">{saving ? "Saving..." : "Save settings"}</Button>
    </div>
  );
}

function StepRow({ s, i, last, campaignId, prev, next, onEdit }: { s: SequenceStep; i: number; last: boolean; campaignId: number; prev?: SequenceStep; next?: SequenceStep; onEdit: () => void }) {
  const upd = useUpdateSequenceStep();
  const del = useDeleteSequenceStep();
  const refresh = useRefreshAll();
  const ch = s.channel as Ch;
  const I = CH[ch].icon;
  const swap = async (o?: SequenceStep) => {
    if (!o) return;
    await upd.mutateAsync({ id: campaignId, stepId: s.id, data: { stepOrder: o.stepOrder } });
    await upd.mutateAsync({ id: campaignId, stepId: o.id, data: { stepOrder: s.stepOrder } });
    refresh();
  };
  return (
    <li className="rise relative flex gap-4 pb-4" style={{ animationDelay: `${i * 50}ms` }} data-testid={`row-step-${s.id}`}>
      {!last && <span className="absolute left-[17px] top-10 bottom-0 w-px bg-border" />}
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: chColor(ch) }}><I className="h-4 w-4" /></div>
      <div className="group min-w-0 flex-1 rounded-lg border border-border bg-background/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">STEP {i + 1}</span>
          <ChannelTag channel={ch} />
          <span className="font-mono text-[11px] text-muted-foreground">{s.delayDays === 0 ? "immediately" : `+${s.delayDays}d`}</span>
          <div className="ml-auto flex gap-0.5 opacity-60 group-hover:opacity-100">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!prev || upd.isPending} onClick={() => swap(prev)} data-testid={`button-step-up-${s.id}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!next || upd.isPending} onClick={() => swap(next)} data-testid={`button-step-down-${s.id}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} data-testid={`button-step-edit-${s.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" disabled={del.isPending} onClick={() => del.mutate({ id: campaignId, stepId: s.id }, { onSuccess: refresh })} data-testid={`button-step-delete-${s.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        {s.subject && <div className="mt-1.5 text-sm font-semibold">{s.subject}</div>}
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{s.template}</p>
      </div>
    </li>
  );
}

function StepDialog({ campaignId, step, onClose }: { campaignId: number; step: SequenceStep | null; onClose: () => void }) {
  const add = useAddSequenceStep();
  const upd = useUpdateSequenceStep();
  const refresh = useRefreshAll();
  const [f, setF] = useState({ channel: (step?.channel ?? "email") as Ch, delayDays: String(step?.delayDays ?? 2), subject: step?.subject ?? "", template: step?.template ?? "" });
  const pending = add.isPending || upd.isPending;
  const save = () => {
    const data = { channel: f.channel, delayDays: Number(f.delayDays) || 0, subject: f.channel === "email" ? f.subject : undefined, template: f.template };
    const done = { onSuccess: () => { refresh(); onClose(); } };
    if (step) upd.mutate({ id: campaignId, stepId: step.id, data }, done); else add.mutate({ id: campaignId, data }, done);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">{step ? "Edit step" : "Add step"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CH) as Ch[]).map((k) => {
              const I = CH[k].icon; const on = f.channel === k;
              return <button key={k} type="button" onClick={() => setF({ ...f, channel: k })} data-testid={`button-step-channel-${k}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition-all"
                style={on ? { borderColor: chColor(k), background: chColor(k, 0.1), color: chColor(k) } : {}}><I className="h-4 w-4" />{CH[k].label}</button>;
            })}
          </div>
          <div><Label className="text-xs">Wait (days after previous step)</Label><Input type="number" min={0} value={f.delayDays} onChange={(e) => setF({ ...f, delayDays: e.target.value })} data-testid="input-step-delay" /></div>
          {f.channel === "email" && <div><Label className="text-xs">Subject</Label><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="input-step-subject" /></div>}
          <div><Label className="text-xs">{f.channel === "call" ? "Call objective" : "Message template"}</Label>
            <Textarea rows={7} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} placeholder="Hi {{firstName}}, noticed {{company}}..." data-testid="input-step-template" />
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{"{{firstName}} {{company}} {{title}}"}</p></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.template.trim() || pending} data-testid="button-save-step">{pending ? "Saving..." : "Save step"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnrollDialog({ campaignId, enrolled, onClose }: { campaignId: number; enrolled: number[]; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const q = useListLeads({ search: search || undefined });
  const enroll = useEnrollLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [sel, setSel] = useState<number[]>([]);
  const avail = (q.data ?? []).filter((l) => !enrolled.includes(l.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">Enroll leads</DialogTitle></DialogHeader>
        <Input placeholder="Search leads" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-enroll-search" />
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {q.isLoading ? <Rows n={4} h={36} /> : !avail.length ? <p className="p-6 text-center text-sm text-muted-foreground">No available leads.</p> : avail.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40" data-testid={`row-enroll-${l.id}`}>
              <Checkbox checked={sel.includes(l.id)} onCheckedChange={(v) => setSel((s) => v ? [...s, l.id] : s.filter((x) => x !== l.id))} />
              <span className="flex-1 text-sm">{l.firstName} {l.lastName}<span className="ml-2 text-xs text-muted-foreground">{l.company}</span></span>
              {l.campaignName && <span className="text-[10px] text-muted-foreground">in {l.campaignName}</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSel(avail.map((l) => l.id))} data-testid="button-select-all">Select all</Button>
          <Button disabled={!sel.length || enroll.isPending} data-testid="button-confirm-enroll"
            onClick={() => enroll.mutate({ id: campaignId, data: { leadIds: sel } }, { onSuccess: () => { refresh(); toast({ title: `${sel.length} leads enrolled` }); onClose(); } })}>
            {enroll.isPending ? "Enrolling..." : `Enroll ${sel.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
