import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, Lock, Pause, Play, Eye, Pencil, Plus, Rocket, RotateCcw, Sparkles, Trash2, UserPlus, Users, Workflow } from "lucide-react";
import {
  useGetCampaign, useUpdateCampaign, useDeleteCampaign, useAddSequenceStep, useUpdateSequenceStep, useDeleteSequenceStep,
  useEnrollLeads, useGenerateCampaignSequence, useRunCampaign, useListLeads, usePreviewSequenceStep, useWriteCampaignPitch,
} from "@workspace/api-client-react";
import type { Lead, RunResult, SequenceStep, StepPreview } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { WaitPicker } from "@/components/wait-picker";
import { PageHeader, Panel, Rows, ErrorBox, Empty, ChannelTag, Pill, AiWorking, Initials, useRefreshAll, CH, chColor, TONE_OPTIONS, ago, errMsg, type Ch } from "@/components/bits";

const STATE_LABEL: Record<string, string> = { draft: "Not started", active: "Sending", paused: "Paused", completed: "Finished" };

function WizardNav({ onBack, onNext, nextLabel = "Next", nextDisabled, hint }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; hint?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 p-4" data-testid="wizard-nav">
      {onBack && <Button variant="outline" size="lg" onClick={onBack} data-testid="button-wizard-back"><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>}
      {hint && <span className="text-sm text-muted-foreground" data-testid="text-wizard-hint">{hint}</span>}
      {onNext && <Button size="lg" className="ml-auto" disabled={nextDisabled} onClick={onNext} data-testid="button-wizard-next">{nextLabel}<ArrowRight className="ml-1.5 h-4 w-4" /></Button>}
    </div>
  );
}

function FlowSection({ n, title, hint, done, action, children }: { n: number; title: string; hint: string; done: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`step-${n}`} className="rise scroll-mt-4 rounded-xl border border-card-border bg-card shadow-[0_8px_24px_-16px_hsl(228_40%_12%/.25)]" data-testid={`section-step-${n}`}>
      <div className="flex flex-wrap items-start gap-3 border-b border-border p-4">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-sm font-bold ${done ? "bg-[hsl(var(--ch-linkedin))] text-white" : "bg-primary text-primary-foreground"}`}>{done ? <Check className="h-4 w-4" /> : n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

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
  const restart = useEnrollLeads();
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [stepEdit, setStepEdit] = useState<SequenceStep | "new" | null>(null);
  const [enroll, setEnroll] = useState(false);
  const [preview, setPreview] = useState<SequenceStep | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const c = q.data;

  if (q.isLoading) return <div className="p-8"><Rows n={6} h={70} /></div>;
  if (q.isError || !c) return <ErrorBox onRetry={() => q.refetch()} />;

  const patch = (data: Parameters<typeof update.mutate>[0]["data"], msg = "Saved", onDone?: () => void, description?: string) =>
    update.mutate({ id, data }, { onSuccess: () => { refresh(); toast({ title: msg, description }); onDone?.(); } });

  const steps = [...c.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const offerDone = (c.productPitch ?? "").trim().length >= 20;
  const started = c.status !== "draft" || c.sentCount > 0;
  const flow = [
    { n: 1, label: "Your offer", done: offerDone },
    { n: 2, label: "Your messages", done: steps.length > 0 },
    { n: 3, label: "Who gets them", done: c.leads.length > 0 },
    { n: 4, label: "Start sending", done: started },
  ];
  const missing = !offerDone ? "Finish step 1: describe what you're offering." : !steps.length ? "Finish step 2: add at least one message." : !c.leads.length ? "Finish step 3: add the people who should receive it." : null;
  const cur = active ?? (flow.find((f) => !f.done)?.n ?? 4);
  const go = (n: number) => { setActive(n); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const locked = (n: number) => flow.slice(0, n - 1).some((f) => !f.done);
  const writeMessages = (title: string) => gen.mutate({ id }, { onSuccess: () => { refresh(); toast({ title }); }, onError: () => toast({ title: "AI could not write the messages", variant: "destructive" }) });
  const firstCh = steps[0]?.channel as Ch | undefined;
  const runIt = () => run.mutate({ id }, {
    onSuccess: (r) => { setResult(r); refresh(); toast({ title: r.messagesSent || r.callsScheduled ? "Sent!" : "Nothing new to send right now", description: `${r.messagesSent} messages sent, ${r.callsScheduled} calls added to your call list` }); },
    onError: (e) => toast({ title: "Could not send", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <div>
      <div className="px-6 pt-5 md:px-8"><Link href="/campaigns" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-campaigns"><ChevronLeft className="h-3 w-3" />All campaigns</Link></div>
      <PageHeader eyebrow="Campaign" title={<span className="flex items-center gap-3">{c.name}<span className="rounded-full border border-border px-2.5 py-0.5 font-sans text-xs font-medium text-muted-foreground" data-testid="text-campaign-state">{STATE_LABEL[c.status] ?? c.status}</span></span>}>
        {c.status === "active" && <Button variant="outline" onClick={() => patch({ status: "paused" }, "Campaign paused. Nothing more will be sent until you resume.")} data-testid="button-pause-campaign"><Pause className="mr-1 h-4 w-4" />Pause</Button>}
        {c.status === "paused" && <Button variant="outline" onClick={() => patch({ status: "active" }, "Campaign resumed")} data-testid="button-resume-campaign"><Play className="mr-1 h-4 w-4" />Resume</Button>}
        <Button variant="outline" size="icon" title="Delete campaign" onClick={() => setConfirmDel(true)} data-testid="button-delete-campaign"><Trash2 className="h-4 w-4" /></Button>
      </PageHeader>

      <div className="mx-auto max-w-4xl space-y-5 p-6 md:p-8">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground" data-testid="text-step-of">Step {cur} of 4</p>
          <ol className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="flow-progress">
            {flow.map((f) => {
              const on = f.n === cur;
              const lock = locked(f.n);
              return (
                <li key={f.n}>
                  <button type="button" disabled={lock} onClick={() => go(f.n)} title={lock ? `Finish step ${f.n - 1} first` : undefined} aria-current={on ? "step" : undefined} data-testid={`button-goto-step-${f.n}`}
                    className={`flex w-full items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-primary bg-primary/5" : f.done ? "border-[hsl(var(--ch-linkedin)/.4)] bg-[hsl(var(--ch-linkedin)/.08)] hover:border-[hsl(var(--ch-linkedin))]" : "border-border bg-card hover:border-primary/40"}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${on ? "bg-primary text-primary-foreground" : f.done ? "bg-[hsl(var(--ch-linkedin))] text-white" : "bg-muted text-muted-foreground"}`}>{f.done && !on ? <Check className="h-4 w-4" /> : lock ? <Lock className="h-3.5 w-3.5" /> : f.n}</span>
                    <span className={on || f.done ? "font-semibold" : "text-muted-foreground"}>{f.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {started && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-card-border bg-border md:grid-cols-4">
            {([["People", c.leadCount], ["Messages sent", c.sentCount], ["Replies", c.replyCount], ["Meetings booked", c.meetingCount]] as const).map(([k, v]) => (
              <div key={k} className="bg-card p-4"><div className="text-xs text-muted-foreground">{k}</div><div className="font-display text-2xl font-bold tnum">{v}</div></div>
            ))}
          </div>
        )}

        {cur === 1 && <FlowSection n={1} title="What are you offering?" hint="Tell the AI what you sell and what you want people to do. It uses this to write every message and every reply." done={offerDone}>
          <SettingsForm c={c} saving={update.isPending} onSave={(d) => d.productPitch.trim().length >= 20
            ? patch(d, "Saved", () => { go(2); if (!steps.length) writeMessages("Your messages are ready. Read them, change anything you like, then press Next."); })
            : patch(d, "Saved. One more thing before step 2", undefined, "Fill in \"What do you sell, and who is it for?\" (or press Write it with AI) so the AI can write your messages.")} />
        </FlowSection>}

        {cur === 2 && <FlowSection n={2} title="Your messages" hint="The messages each person receives, in order. The AI personalises every one for the person it goes to. Follow-ups stop automatically as soon as someone replies." done={steps.length > 0}
          action={steps.length > 0 && <div className="flex gap-1.5">
            <Button size="sm" variant="outline" disabled={gen.isPending} data-testid="button-generate-sequence"
              onClick={() => writeMessages("Messages rewritten by AI")}>
              <Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />{gen.isPending ? "Writing..." : "Rewrite all with AI"}
            </Button>
            <Button size="sm" onClick={() => setStepEdit("new")} data-testid="button-add-step"><Plus className="mr-1 h-3.5 w-3.5" />Add message</Button>
          </div>}>
          {gen.isPending && <div className="p-4"><AiWorking text="Writing your messages from your offer" /></div>}
          {!steps.length && !gen.isPending ? (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <Workflow className="h-8 w-8 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">Let the AI write a series of emails, LinkedIn messages and call reminders for you, or write your own.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button data-testid="button-generate-sequence-empty"
                  onClick={() => writeMessages("Your messages are ready")}>
                  <Sparkles className="mr-1 h-4 w-4" />Write them for me with AI</Button>
                <Button variant="outline" onClick={() => setStepEdit("new")} data-testid="button-add-step-empty"><Pencil className="mr-1 h-4 w-4" />I'll write my own</Button>
              </div>
            </div>
          ) : (
            <ol className="relative p-4">
              {steps.length > 1 && <li className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="text-followup-explainer">
                Each person gets message 1 first. <b className="text-foreground">If they don't reply</b>, the next one goes out after the wait you choose on each message (from 1 hour to 2 weeks), sometimes on a different channel so they have more chances to see it. As soon as they reply, the rest stop.
              </li>}
              {steps.map((s, i) => <StepRow key={s.id} s={s} i={i} last={i === steps.length - 1} campaignId={id} prev={steps[i - 1]} next={steps[i + 1]} onEdit={() => setStepEdit(s)} onPreview={() => setPreview(s)} />)}
            </ol>
          )}
          <WizardNav onBack={() => go(1)} onNext={() => go(3)} nextDisabled={!steps.length} hint={!steps.length ? "Add at least one message to continue." : null} />
        </FlowSection>}

        {cur === 3 && <FlowSection n={3} title="Who should receive them?" hint="Pick people from your lead list. Need more people? Find them on the Find leads page or add them on the Leads page." done={c.leads.length > 0}
          action={<Button size="sm" variant={c.leads.length ? "outline" : "default"} onClick={() => setEnroll(true)} data-testid="button-enroll-leads"><UserPlus className="mr-1 h-3.5 w-3.5" />Add people</Button>}>
          {!c.leads.length ? (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No one added yet.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setEnroll(true)} data-testid="button-enroll-empty"><UserPlus className="mr-1 h-4 w-4" />Add people from my leads</Button>
                <Link href="/find-leads" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-muted" data-testid="link-find-leads">Find new people</Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {c.leads.map((l, i) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="rise flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40" style={{ animationDelay: `${i * 20}ms` }} data-testid={`link-enrolled-${l.id}`}>
                  <Initials name={`${l.firstName} ${l.lastName}`} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{l.firstName} {l.lastName}</div><div className="truncate text-xs text-muted-foreground">{[l.email, l.company].filter(Boolean).join(" · ")}</div></div>
                  <span className="text-xs text-muted-foreground">{(l.currentStep ?? 0) === 0 ? "nothing sent yet" : `got ${Math.min(l.currentStep ?? 0, steps.length)} of ${steps.length} messages`}</span>
                  <Pill value={l.status} />
                  {steps.length > 0 && (l.currentStep ?? 0) >= steps.length && (
                    <Button size="sm" variant="outline" className="h-7" disabled={restart.isPending} data-testid={`button-restart-${l.id}`}
                      title="Start this person again from message 1"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); restart.mutate({ id, data: { leadIds: [l.id] } }, { onSuccess: () => { refresh(); toast({ title: `${l.firstName} will get message 1 again`, description: "Press \"Send anything due now\" below to send it." }); } }); }}>
                      <RotateCcw className="mr-1 h-3 w-3" />Send again
                    </Button>
                  )}
                </Link>
              ))}
            </div>
          )}
          <WizardNav onBack={() => go(2)} onNext={() => go(4)} nextDisabled={!c.leads.length} hint={!c.leads.length ? "Add at least one person to continue." : null} />
        </FlowSection>}

        {cur === 4 && <FlowSection n={4} title={started ? "Sending" : "Start sending"} hint={started ? "This campaign runs on its own: follow-ups go out on schedule and the AI answers replies. Check the Inbox to see conversations." : "Everything is checked. Nothing is sent until you press the button."} done={started}>
          <div className="space-y-4 p-4">
            {run.isPending && <AiWorking text="Personalising and sending messages" />}
            {result && !run.isPending && (
              <div className="pop rounded-lg bg-foreground p-4 text-sm text-background" data-testid="panel-run-result">
                <b>{result.messagesSent}</b> message{result.messagesSent === 1 ? "" : "s"} sent and <b>{result.callsScheduled}</b> call{result.callsScheduled === 1 ? "" : "s"} added to your call list.
                {!result.leadsProcessed && " Everyone has already received their latest message; the next follow-ups go out automatically on their scheduled day."}
              </div>
            )}
            {missing ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground" data-testid="text-launch-missing">{missing}</p>
            ) : !started && (
              <p className="text-sm" data-testid="text-launch-summary">
                When you press <b>Start sending</b>, <b>{c.leads.length} {c.leads.length === 1 ? "person" : "people"}</b> will get message 1{firstCh ? ` by ${CH[firstCh].label.toLowerCase()}` : ""} right away.
                {steps.length > 1 && ` The other ${steps.length - 1} follow-up${steps.length > 2 ? "s go" : " goes"} out automatically on schedule.`}
                {c.autoReply ? " When someone replies, the AI answers for you (anything negative waits for you in the Inbox)." : " Replies wait for you in the Inbox."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" disabled={run.isPending || !!missing} onClick={runIt} data-testid="button-run-campaign">
                <Rocket className={`mr-1.5 h-4 w-4 ${run.isPending ? "animate-bounce" : ""}`} />{run.isPending ? "Sending..." : started ? "Send anything due now" : "Start sending"}
              </Button>
              {started && <Link href="/inbox" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm hover:bg-muted" data-testid="link-open-inbox">Open Inbox</Link>}
            </div>
          </div>
          <WizardNav onBack={() => go(3)} />
        </FlowSection>}
      </div>

      {stepEdit && <StepDialog campaignId={id} step={stepEdit === "new" ? null : stepEdit} onClose={() => setStepEdit(null)} />}
      {preview && <PreviewDialog campaignId={id} step={preview} leads={c.leads} onClose={() => setPreview(null)} />}
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
  const write = useWriteCampaignPitch();
  const { toast } = useToast();
  const aiPitch = () => write.mutate({ id: c.id, data: { notes: f.productPitch, goal: f.goal } }, {
    onSuccess: (r) => { set("productPitch", r.pitch); toast({ title: "AI wrote your pitch", description: "Read it, change anything that's not right, then save." }); },
    onError: (e) => toast({ title: "AI could not write it", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div><Label>Campaign name <span className="font-normal text-muted-foreground">(only you see this)</span></Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="input-edit-name" /></div>
      <div><Label>What do you want people to do?</Label><Input value={f.goal} onChange={(e) => set("goal", e.target.value)} placeholder="Book a 20 minute intro call" data-testid="input-edit-goal" /></div>
      <div className="md:col-span-2"><Label>What do you sell, and who is it for?</Label>
        <Textarea rows={4} value={f.productPitch} disabled={write.isPending} onChange={(e) => set("productPitch", e.target.value)} placeholder="Example: We help clinics fill empty appointment slots with an automated WhatsApp reminder service. Clinics using it see 30% fewer no-shows. Setup takes one day." data-testid="input-edit-pitch" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={aiPitch} disabled={write.isPending} data-testid="button-ai-pitch">
            <Sparkles className={`mr-1.5 h-3.5 w-3.5 text-primary ${write.isPending ? "animate-spin" : ""}`} />{write.isPending ? "Writing..." : f.productPitch.trim() ? "Improve with AI" : "Write it with AI"}
          </Button>
          <p className={`text-xs ${f.productPitch.trim().length >= 20 ? "text-muted-foreground" : "text-amber-700"}`}>Not sure what to write? Type a few rough words (like "WhatsApp reminders for clinics") and let the AI turn them into 2–3 clear sentences.</p>
        </div></div>
      <div><Label>How should messages sound?</Label>
        <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={f.replyTone} onChange={(e) => set("replyTone", e.target.value)} data-testid="select-edit-tone">
          {Array.from(new Set([...TONE_OPTIONS, f.replyTone])).map((t) => <option key={t}>{t}</option>)}
        </select></div>
      <div><Label>Your booking link <span className="font-normal text-muted-foreground">(optional)</span></Label><Input value={f.meetingLink} onChange={(e) => set("meetingLink", e.target.value)} placeholder="calendly.com/you/20min" data-testid="input-edit-meeting" /></div>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm md:col-span-2">
        <span><b>Let AI answer replies for me</b><span className="block text-xs text-muted-foreground">When someone replies, the AI writes and sends the answer. Negative replies always wait for you.</span></span>
        <Switch checked={f.autoReply} onCheckedChange={(v) => set("autoReply", v)} data-testid="switch-edit-autoreply" />
      </label>
      <div className="-mx-4 -mb-4 flex border-t border-border bg-muted/30 p-4 md:col-span-2">
        <Button size="lg" className="ml-auto" onClick={() => onSave(f)} disabled={saving} data-testid="button-save-campaign">{saving ? "Saving..." : <>Save and continue<ArrowRight className="ml-1.5 h-4 w-4" /></>}</Button>
      </div>
    </div>
  );
}

const ROW_LABEL: Record<Ch, string> = { email: "Email", linkedin: "LinkedIn message", call: "Phone call" };

function StepRow({ s, i, last, campaignId, prev, next, onEdit, onPreview }: { s: SequenceStep; i: number; last: boolean; campaignId: number; prev?: SequenceStep; next?: SequenceStep; onEdit: () => void; onPreview: () => void }) {
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
          <span className="text-sm font-semibold" style={{ color: chColor(ch) }}>{i + 1}. {ROW_LABEL[ch]}</span>
          {i === 0 ? <span className="text-xs text-muted-foreground">sent right away when you start{ch === "call" && " · added to your call list"}</span> : (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Wait
              <WaitPicker value={s} disabled={upd.isPending} className="h-7 text-xs text-foreground" testId={`select-step-wait-${s.id}`}
                onChange={(w) => upd.mutate({ id: campaignId, stepId: s.id, data: w }, { onSuccess: refresh })} />
              after the previous message, only if they haven't replied{ch === "call" && " · added to your call list"}
            </span>
          )}
          <div className="ml-auto flex gap-0.5 opacity-60 group-hover:opacity-100">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!prev || upd.isPending} onClick={() => swap(prev)} data-testid={`button-step-up-${s.id}`}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!next || upd.isPending} onClick={() => swap(next)} data-testid={`button-step-down-${s.id}`}><ArrowDown className="h-3.5 w-3.5" /></Button>
            {s.channel !== "call" && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPreview} title="See how it looks for a real person" data-testid={`button-step-preview-${s.id}`}><Eye className="h-3.5 w-3.5" /></Button>}
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
  const [f, setF] = useState({ channel: (step?.channel ?? "email") as Ch, wait: { delayDays: step?.delayDays ?? 1, delayHours: step?.delayHours ?? 0 }, subject: step?.subject ?? "", template: step?.template ?? "" });
  const pending = add.isPending || upd.isPending;
  const save = () => {
    const data = { channel: f.channel, ...f.wait, subject: f.channel === "email" ? f.subject : undefined, template: f.template };
    const done = { onSuccess: () => { refresh(); onClose(); } };
    if (step) upd.mutate({ id: campaignId, stepId: step.id, data }, done); else add.mutate({ id: campaignId, data }, done);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">{step ? "Edit message" : "Add a message"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CH) as Ch[]).map((k) => {
              const I = CH[k].icon; const on = f.channel === k;
              return <button key={k} type="button" onClick={() => setF({ ...f, channel: k })} data-testid={`button-step-channel-${k}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition-all"
                style={on ? { borderColor: chColor(k), background: chColor(k, 0.1), color: chColor(k) } : {}}><I className="h-4 w-4" />{CH[k].label}</button>;
            })}
          </div>
          <div><Label className="text-xs">How long to wait after the previous message? (the first message always goes right away)</Label>
            <WaitPicker value={f.wait} onChange={(w) => setF({ ...f, wait: w })} className="h-9 w-full" testId="input-step-delay" /></div>
          {f.channel === "email" && <div><Label className="text-xs">Subject</Label><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="input-step-subject" /></div>}
          <div><Label className="text-xs">{f.channel === "call" ? "What should this call achieve?" : "Message"}</Label>
            <Textarea rows={7} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} placeholder="Hi {{firstName}}, noticed {{company}}..." data-testid="input-step-template" />
            <p className="mt-1 text-xs text-muted-foreground">{"Write it roughly; the AI polishes and personalises it for each person. Tip: {{firstName}} and {{company}} are replaced with their name and company."}</p></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.template.trim() || pending} data-testid="button-save-step">{pending ? "Saving..." : "Save message"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ campaignId, step, leads, onClose }: { campaignId: number; step: SequenceStep; leads: Lead[]; onClose: () => void }) {
  const others = useListLeads();
  const pool = leads.length ? leads : (others.data ?? []);
  const [leadId, setLeadId] = useState<string>("");
  const [out, setOut] = useState<StepPreview | null>(null);
  const run = usePreviewSequenceStep();
  const { toast } = useToast();
  const ready = leads.length > 0 || !others.isLoading;
  useEffect(() => { if (ready && !leadId) go(pool[0] ? String(pool[0].id) : "sample"); }, [ready]); // eslint-disable-line
  const go = (lid: string) => {
    setLeadId(lid);
    setOut(null);
    run.mutate({ id: campaignId, stepId: step.id, data: lid === "sample" ? {} : { leadId: Number(lid) } }, { onSuccess: setOut, onError: (e) => toast({ title: "Preview failed", description: errMsg(e), variant: "destructive" }) });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">See message {step.stepOrder} as a real person would</DialogTitle></DialogHeader>
        <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={leadId} onChange={(e) => go(e.target.value)} data-testid="select-preview-lead">
          <option value="sample">Sample person (Priya Sharma, Operations Manager at Sample Co)</option>
          {pool.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}{l.company ? ` (${l.company})` : ""}</option>)}
        </select>
        {run.isPending && <AiWorking text="Personalizing this step the way it will be sent" />}
        {out && !run.isPending && (
          <div className="pop rounded-lg border border-border bg-background p-4" data-testid="panel-step-preview">
            <ChannelTag channel={step.channel as Ch} />
            {out.subject && <div className="mt-2 text-sm font-semibold">{out.subject}</div>}
            <p className="mt-1 whitespace-pre-wrap text-sm">{out.body}</p>
          </div>
        )}
        {leadId === "sample" && <p className="text-xs text-muted-foreground" data-testid="text-sample-preview">This is a made-up person so you can see how it reads. Once you add people in step 3, you can pick a real one here.</p>}
        <DialogFooter><Button variant="outline" disabled={!leadId || run.isPending} onClick={() => go(leadId)} data-testid="button-regenerate-preview">Regenerate</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="font-display text-xl">Add people to this campaign</DialogTitle></DialogHeader>
        <Input placeholder="Search by name, company or email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-enroll-search" />
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {q.isLoading ? <Rows n={4} h={36} /> : !avail.length ? <p className="p-6 text-center text-sm text-muted-foreground">No one left to add. Find new people on the Find leads page.</p> : avail.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40" data-testid={`row-enroll-${l.id}`}>
              <Checkbox checked={sel.includes(l.id)} onCheckedChange={(v) => setSel((s) => v ? [...s, l.id] : s.filter((x) => x !== l.id))} />
              <span className="flex-1 text-sm">{l.firstName} {l.lastName}<span className="ml-2 text-xs text-muted-foreground">{l.company}</span></span>
              {l.campaignName && <span className="text-[10px] text-muted-foreground">moves from {l.campaignName}</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSel(avail.map((l) => l.id))} data-testid="button-select-all">Select all</Button>
          <Button disabled={!sel.length || enroll.isPending} data-testid="button-confirm-enroll"
            onClick={() => enroll.mutate({ id: campaignId, data: { leadIds: sel } }, { onSuccess: () => { refresh(); toast({ title: `${sel.length} ${sel.length === 1 ? "person" : "people"} added` }); onClose(); } })}>
            {enroll.isPending ? "Adding..." : `Add ${sel.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
