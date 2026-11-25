import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Phone, PhoneCall, Plus, Sparkles, FileText } from "lucide-react";
import {
  useListCalls, useGetCall, getGetCallQueryKey, useUpdateCall, useGenerateCallScript, useSummarizeCall, useCreateCall, useListLeads,
} from "@workspace/api-client-react";
import type { CallStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Rows, ErrorBox, Empty, Pill, AiWorking, Initials, Panel, ago, label, useRefreshAll } from "@/components/bits";

const TABS = ["scheduled", "completed", "no_answer"];

export default function Calls() {
  const initial = Number(new URLSearchParams(useSearch()).get("id")) || null;
  const [tab, setTab] = useState("");
  const [sel, setSel] = useState<number | null>(initial);
  const [add, setAdd] = useState(false);
  const q = useListCalls({ status: (tab || undefined) as CallStatus | undefined });
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <h1 className="font-display mr-4 text-2xl font-bold">Call queue</h1>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {["", ...TABS].map((t) => <button key={t} onClick={() => setTab(t)} data-testid={`filter-call-${t || "all"}`}
            className={cn("rounded-md px-2.5 py-1 text-xs capitalize", tab === t ? "bg-foreground text-background" : "text-muted-foreground")}>{t ? label(t) : "All"}</button>)}
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setAdd(true)} data-testid="button-new-call"><Plus className="mr-1 h-4 w-4" />Schedule call</Button>
      </div>
      <div className="grid flex-1 lg:grid-cols-[360px_1fr]">
        <div className="border-r border-border">
          {q.isLoading ? <Rows n={6} h={56} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <div className="p-4"><Empty icon={PhoneCall} title="Queue is empty" body="Call steps in a sequence drop leads here, ready with an AI script." /></div>
          ) : q.data.map((c, i) => (
            <button key={c.id} onClick={() => setSel(c.id)} data-testid={`button-call-${c.id}`}
              className={cn("rise flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted/40", sel === c.id && "bg-card shadow-[inset_3px_0_0_hsl(var(--ch-call))]")} style={{ animationDelay: `${i * 25}ms` }}>
              <Initials name={c.leadName} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.leadName}<span className="ml-1.5 text-xs text-muted-foreground">{c.leadCompany}</span></div>
                <div className="truncate text-xs text-muted-foreground">{c.objective ?? "Call"}</div></div>
              <div className="text-right"><Pill value={c.status} /><div className="mt-1 font-mono text-[10px] text-muted-foreground">{c.scheduledAt ? ago(c.scheduledAt) : ""}</div></div>
            </button>
          ))}
        </div>
        <div className="min-w-0">{sel ? <CallDetail id={sel} /> : <div className="grid h-full place-items-center p-6"><Empty icon={Phone} title="Select a call" body="Script, notes, outcome and AI summary live here." /></div>}</div>
      </div>
      {add && <NewCall onClose={() => setAdd(false)} onCreated={setSel} />}
    </div>
  );
}

function CallDetail({ id }: { id: number }) {
  const q = useGetCall(id, { query: { enabled: !!id, queryKey: getGetCallQueryKey(id) } });
  const upd = useUpdateCall();
  const script = useGenerateCallScript();
  const sum = useSummarizeCall();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [dur, setDur] = useState("");
  const c = q.data;
  useEffect(() => { if (c) { setNotes(c.notes ?? ""); setOutcome(c.outcome ?? ""); setDur(c.durationSeconds ? String(Math.round(c.durationSeconds / 60)) : ""); } }, [c?.id]); // eslint-disable-line
  if (q.isLoading) return <Rows n={4} h={90} />;
  if (q.isError || !c) return <ErrorBox onRetry={() => q.refetch()} />;

  const save = (status?: CallStatus) => upd.mutate({ id, data: { notes, outcome: outcome || undefined, durationSeconds: dur ? Number(dur) * 60 : undefined, status } },
    { onSuccess: () => { refresh(); toast({ title: status ? `Logged as ${label(status)}` : "Call saved" }); } });

  return (
    <div className="space-y-4 p-5 md:p-6">
      <div className="rise flex flex-wrap items-center gap-4">
        <div className="flex-1">
          <Link href={`/leads/${c.leadId}`} className="font-display text-2xl font-bold hover:text-primary" data-testid="link-call-lead">{c.leadName}</Link>
          <div className="text-sm text-muted-foreground">{c.leadCompany} · {c.objective}</div>
        </div>
        {c.leadPhone ? (
          <a href={`tel:${c.leadPhone}`} className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-mono text-sm font-medium text-white" style={{ background: "hsl(var(--ch-call))" }} data-testid="link-tel"><Phone className="h-4 w-4" />{c.leadPhone}</a>
        ) : <span className="text-xs text-muted-foreground">No phone on file</span>}
        <Pill value={c.status} />
      </div>

      <Panel title="AI call script" action={<Button size="sm" variant="outline" disabled={script.isPending} data-testid="button-generate-script"
        onClick={() => script.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: "Script ready" }); } })}><Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />{script.isPending ? "Writing..." : c.script ? "Regenerate" : "Generate script"}</Button>}>
        <div className="p-4">
          {script.isPending ? <AiWorking text="Writing an opener, discovery questions and objection handling" /> : c.script ?
            <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-script">{c.script}</p> :
            <Empty icon={FileText} title="No script yet" body="Generate one from the lead profile and campaign pitch." />}
        </div>
      </Panel>

      <Panel title="Log the call" delay={60}>
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div><Label className="text-xs">Outcome</Label><Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Booked demo for Thursday" data-testid="input-outcome" /></div>
            <div><Label className="text-xs">Minutes</Label><Input type="number" min={0} value={dur} onChange={(e) => setDur(e.target.value)} data-testid="input-duration" /></div>
          </div>
          <div><Label className="text-xs">Notes</Label><Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did they say? Pain points, timing, who else is involved..." data-testid="input-call-notes" /></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={upd.isPending} onClick={() => save()} data-testid="button-save-call">Save</Button>
            <Button variant="outline" disabled={upd.isPending} onClick={() => save("no_answer")} data-testid="button-no-answer">No answer</Button>
            <Button disabled={upd.isPending} onClick={() => save("completed")} data-testid="button-complete-call">Mark completed</Button>
            <Button variant="secondary" className="ml-auto" disabled={sum.isPending || !notes.trim()} data-testid="button-summarize"
              onClick={() => upd.mutate({ id, data: { notes } }, { onSuccess: () => sum.mutate({ id }, { onSuccess: () => { refresh(); toast({ title: "Summary ready" }); } }) })}>
              <Sparkles className="mr-1 h-3.5 w-3.5 text-primary" />{sum.isPending ? "Summarizing..." : "Summarize with AI"}
            </Button>
          </div>
          {sum.isPending && <AiWorking text="Reading your notes and extracting the next step" />}
          {c.summary && !sum.isPending && (
            <div className="pop grid gap-3 rounded-lg bg-foreground p-4 text-background md:grid-cols-[1fr_240px]" data-testid="panel-summary">
              <div><div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">Summary</div><p className="mt-1 whitespace-pre-wrap text-sm">{c.summary}</p></div>
              {c.nextStep && <div className="rounded-md bg-primary p-3 text-primary-foreground"><div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-80">Next step</div><p className="mt-1 text-sm font-medium">{c.nextStep}</p></div>}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function NewCall({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const leads = useListLeads();
  const create = useCreateCall();
  const refresh = useRefreshAll();
  const [leadId, setLeadId] = useState("");
  const [objective, setObjective] = useState("Qualify interest and book a demo");
  const [when, setWhen] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-xl">Schedule a call</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Lead</Label>
            <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={leadId} onChange={(e) => setLeadId(e.target.value)} data-testid="select-call-lead">
              <option value="">Choose a lead</option>{leads.data?.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}{l.company ? ` (${l.company})` : ""}</option>)}
            </select></div>
          <div><Label className="text-xs">Objective</Label><Input value={objective} onChange={(e) => setObjective(e.target.value)} data-testid="input-call-objective" /></div>
          <div><Label className="text-xs">When</Label><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="input-call-when" /></div>
        </div>
        <DialogFooter><Button disabled={!leadId || create.isPending} data-testid="button-create-call"
          onClick={() => {
            const lead = leads.data?.find((l) => l.id === Number(leadId));
            create.mutate({ data: { leadId: Number(leadId), campaignId: lead?.campaignId ?? undefined, objective, scheduledAt: when ? new Date(when).toISOString() : undefined } },
              { onSuccess: (c) => { refresh(); onCreated(c.id); onClose(); } });
          }}>{create.isPending ? "Scheduling..." : "Schedule"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
