import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { AlertTriangle, Building2, CheckSquare, ChevronLeft, Lightbulb, RotateCcw, Sparkles, Trash2, Trophy, User, XCircle } from "lucide-react";
import { useDeleteDeal, useGetDeal, useGetDealInsight, useListAccounts, useListLeads, useUpdateDeal } from "@workspace/api-client-react";
import type { DealInsight, DealStage, DealUpdate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ErrorBox, Empty, AiWorking, ago, errMsg, useRefreshAll } from "@/components/bits";
import { Timeline } from "@/components/timeline";
import { NotesPanel } from "@/components/crm/notes-panel";
import { StagePath } from "@/components/crm/stage-path";
import { CloseDealDialog } from "@/components/crm/close-deal-dialog";
import { fromDateInput, isClosedStage, shortDate, toDateInput, useMoney } from "@/components/crm/format";
import { StageBadge } from "@/pages/pipeline";
import { AddTask, TaskRow } from "@/pages/tasks";
import { QuotesPanel } from "@/components/crm/quotes-panel";
import { MeetingsPanel } from "@/components/meetings";

const SELECT = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

type Form = { name: string; amount: string; probability: string; closeDate: string; nextStep: string; ownerName: string; description: string; accountId: string; leadId: string };

export default function DealDetail() {
  const id = Number(useParams().id);
  const q = useGetDeal(id);
  const upd = useUpdateDeal();
  const del = useDeleteDeal();
  const insight = useGetDealInsight();
  const accounts = useListAccounts();
  const leads = useListLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const { currency, money } = useMoney();
  const [f, setF] = useState<Form | null>(null);
  const [closing, setClosing] = useState<"closed_won" | "closed_lost" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [ai, setAi] = useState<DealInsight | null>(null);
  const d = q.data;

  useEffect(() => {
    if (!d) return;
    setF({ name: d.name, amount: String(d.amount), probability: String(d.probability), closeDate: toDateInput(d.closeDate), nextStep: d.nextStep ?? "", ownerName: d.ownerName ?? "", description: d.description ?? "", accountId: d.accountId ? String(d.accountId) : "", leadId: d.leadId ? String(d.leadId) : "" });
  }, [d]);

  if (q.isLoading || (d && !f)) return <div className="p-8"><Rows n={5} h={80} /></div>;
  if (q.isError || !d || !f) return <ErrorBox onRetry={() => q.refetch()} />;

  const save = (data: DealUpdate, msg = "Deal saved") =>
    upd.mutate({ id, data }, { onSuccess: () => { refresh(); toast({ title: msg }); }, onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }) });
  const setStage = (s: DealStage) => (isClosedStage(s) ? setClosing(s as "closed_won" | "closed_lost") : s !== d.stage && save({ stage: s }, "Stage updated"));
  const set = (k: keyof Form, v: string) => setF((p) => (p ? { ...p, [k]: v } : p));
  const dirty =
    f.name !== d.name || f.amount !== String(d.amount) || f.probability !== String(d.probability) || f.closeDate !== toDateInput(d.closeDate) ||
    f.nextStep !== (d.nextStep ?? "") || f.ownerName !== (d.ownerName ?? "") || f.description !== (d.description ?? "") ||
    f.accountId !== (d.accountId ? String(d.accountId) : "") || f.leadId !== (d.leadId ? String(d.leadId) : "");
  const saveForm = () =>
    save({
      name: f.name.trim() || d.name,
      amount: Math.max(0, Math.round(Number(f.amount) || 0)),
      probability: Math.max(0, Math.min(100, Math.round(Number(f.probability) || 0))),
      closeDate: fromDateInput(f.closeDate),
      nextStep: f.nextStep || null,
      ownerName: f.ownerName || null,
      description: f.description || null,
      accountId: f.accountId ? Number(f.accountId) : null,
      leadId: f.leadId ? Number(f.leadId) : null,
    });
  const runInsight = () => insight.mutate({ id }, { onSuccess: setAi, onError: (e) => toast({ title: "AI review failed", description: errMsg(e), variant: "destructive" }) });
  const closed = isClosedStage(d.stage);
  const overdue = !closed && d.closeDate && new Date(d.closeDate) < new Date();
  const contacts = (leads.data ?? []).filter((l) => !f.accountId || l.accountId === Number(f.accountId) || l.id === d.leadId);

  return (
    <div className="p-6 md:p-8">
      <Link href="/pipeline" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-pipeline"><ChevronLeft className="h-3 w-3" />Pipeline</Link>
      <div className="rise mt-3 flex flex-wrap items-start gap-4 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><StageBadge stage={d.stage} />{d.source !== "manual" && <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">from {d.source.replace("_", " ")}</span>}</div>
          <h1 className="mt-1 font-display text-3xl font-bold" data-testid="text-deal-name">{d.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {d.accountId && <Link href={`/accounts/${d.accountId}`} className="inline-flex items-center gap-1 hover:text-primary"><Building2 className="h-3.5 w-3.5" />{d.accountName}</Link>}
            {d.leadId && <Link href={`/leads/${d.leadId}`} className="inline-flex items-center gap-1 hover:text-primary"><User className="h-3.5 w-3.5" />{d.leadName}</Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={insight.isPending} onClick={runInsight} data-testid="button-deal-insight"><Sparkles className="mr-1 h-4 w-4 text-primary" />{insight.isPending ? "Reviewing..." : "AI review"}</Button>
          {closed ? (
            <Button variant="outline" onClick={() => save({ stage: "negotiation" }, "Deal reopened")} data-testid="button-reopen-deal"><RotateCcw className="mr-1 h-4 w-4" />Reopen</Button>
          ) : (<>
            <Button onClick={() => setClosing("closed_won")} className="border-[hsl(var(--ch-linkedin))] bg-[hsl(var(--ch-linkedin))] text-white hover:bg-[hsl(var(--ch-linkedin)/.9)]" data-testid="button-mark-won"><Trophy className="mr-1 h-4 w-4" />Mark won</Button>
            <Button variant="outline" onClick={() => setClosing("closed_lost")} data-testid="button-mark-lost"><XCircle className="mr-1 h-4 w-4" />Mark lost</Button>
          </>)}
          <Button variant="outline" size="icon" onClick={() => setConfirm(true)} data-testid="button-delete-deal"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[["Amount", money(d.amount)], ["Probability", `${d.probability}%`], ["Expected", money(Math.round((d.amount * d.probability) / 100))], ["Close date", shortDate(d.closeDate)]].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
            <div className={`font-display text-xl font-bold ${k === "Close date" && overdue ? "text-destructive" : ""}`} data-testid={`stat-${k.toLowerCase().replace(" ", "-")}`}>{v}</div></div>
        ))}
      </div>

      <div className="mt-4"><StagePath stage={d.stage} onSelect={setStage} disabled={upd.isPending} /></div>
      {d.stage === "closed_lost" && d.lostReason && <p className="mt-2 text-sm text-destructive" data-testid="text-lost-reason">Lost: {d.lostReason}</p>}
      {d.closedAt && <p className="mt-1 text-xs text-muted-foreground">Closed {ago(d.closedAt)}</p>}

      {insight.isPending && <div className="mt-4"><AiWorking text="Reading the deal, its notes and recent activity" /></div>}
      {ai && !insight.isPending && (
        <Panel title={`AI review · ${ai.winLikelihood}% likely to win`} className="mt-4" action={<button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setAi(null)}>Dismiss</button>}>
          <div className="grid gap-4 p-4 md:grid-cols-[1.2fr_1fr_1fr]" data-testid="panel-deal-insight">
            <p className="text-sm">{ai.summary}</p>
            <div><div className="mb-1 flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />Risks</div>
              {ai.risks.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{ai.risks.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-muted-foreground">None spotted.</p>}</div>
            <div><div className="mb-1 flex items-center gap-1 text-xs font-semibold text-primary"><Lightbulb className="h-3.5 w-3.5" />Next actions</div>
              <ul className="list-disc space-y-1 pl-4 text-sm">{ai.nextActions.map((r) => <li key={r}>{r}</li>)}</ul></div>
          </div>
        </Panel>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel title="Details">
          <div className="grid gap-3 p-4">
            <div><Label className="text-xs">Deal name</Label><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="input-edit-deal-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Amount ({currency})</Label><Input type="number" min={0} value={f.amount} onChange={(e) => set("amount", e.target.value)} data-testid="input-edit-deal-amount" /></div>
              <div><Label className="text-xs">Probability %</Label><Input type="number" min={0} max={100} value={f.probability} onChange={(e) => set("probability", e.target.value)} data-testid="input-edit-deal-probability" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Close date</Label><Input type="date" value={f.closeDate} onChange={(e) => set("closeDate", e.target.value)} data-testid="input-edit-deal-close" /></div>
              <div><Label className="text-xs">Owner</Label><Input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} data-testid="input-edit-deal-owner" /></div>
            </div>
            <div><Label className="text-xs">Account</Label>
              <select className={SELECT} value={f.accountId} onChange={(e) => set("accountId", e.target.value)} data-testid="select-edit-deal-account">
                <option value="">No account</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
            <div><Label className="text-xs">Primary contact</Label>
              <select className={SELECT} value={f.leadId} onChange={(e) => set("leadId", e.target.value)} data-testid="select-edit-deal-contact">
                <option value="">No contact</option>{contacts.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>)}
              </select></div>
            <div><Label className="text-xs">Next step</Label><Input value={f.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="What has to happen next?" data-testid="input-edit-deal-next" /></div>
            <div><Label className="text-xs">Description</Label><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} data-testid="input-edit-deal-description" /></div>
            <Button disabled={!dirty || upd.isPending} onClick={saveForm} data-testid="button-save-deal-details">{upd.isPending ? "Saving..." : "Save changes"}</Button>
            <p className="font-mono text-[10px] text-muted-foreground">Created {ago(d.createdAt)} · in stage since {ago(d.stageChangedAt)}</p>
          </div>
        </Panel>
        <div className="min-w-0 space-y-5">
          <Panel title={`Tasks · ${d.tasks.filter((t) => !t.done).length} open`} delay={40}>
            <AddTask dealId={id} leadId={d.leadId ?? undefined} />
            {!d.tasks.length ? <div className="p-4"><Empty icon={CheckSquare} title="No tasks" body="Add the follow-ups that move this deal forward." /></div> :
              <div className="divide-y divide-border">{d.tasks.map((t) => <TaskRow key={t.id} t={t} showDeal={false} />)}</div>}
          </Panel>
          <QuotesPanel dealId={id} dealName={d.name} delay={60} />
          <MeetingsPanel dealId={id} delay={70} />
          <NotesPanel notes={d.notes} dealId={id} delay={80} />
          <Panel title="Activity" delay={120}><Timeline activity={d.activity} /></Panel>
        </div>
      </div>

      {closing && <CloseDealDialog deal={d} outcome={closing} onClose={() => setClosing(null)} />}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {d.name}?</AlertDialogTitle><AlertDialogDescription>Removes the deal with its notes and tasks. The account and contact stay.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-deal" onClick={() => del.mutate({ id }, { onSuccess: () => { refresh(); nav("/pipeline"); toast({ title: "Deal deleted" }); } })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
