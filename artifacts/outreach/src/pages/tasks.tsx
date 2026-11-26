import { useState } from "react";
import { Link } from "wouter";
import { CheckSquare, Plus, Trash2 } from "lucide-react";
import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask, useListLeads } from "@workspace/api-client-react";
import type { Task } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PageHeader, Rows, ErrorBox, Empty, ago, label, useRefreshAll } from "@/components/bits";

const VIEWS = [["open", "Open"], ["done", "Done"], ["all", "All"]] as const;

export function TaskRow({ t, showLead = true, showDeal = true }: { t: Task; showLead?: boolean; showDeal?: boolean }) {
  const upd = useUpdateTask();
  const del = useDeleteTask();
  const refresh = useRefreshAll();
  const overdue = !t.done && t.dueAt && new Date(t.dueAt) < new Date();
  return (
    <div className="rise flex items-center gap-3 px-4 py-2.5" data-testid={`row-task-${t.id}`}>
      <Checkbox checked={t.done} onCheckedChange={(v) => upd.mutate({ id: t.id, data: { done: !!v } }, { onSuccess: refresh })} data-testid={`checkbox-task-${t.id}`} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", t.done && "text-muted-foreground line-through")}>{t.title}</div>
        <div className="flex gap-2 font-mono text-[10px] text-muted-foreground">
          {showLead && t.leadId && <Link href={`/leads/${t.leadId}`} className="hover:text-primary">{t.leadName}</Link>}
          {showDeal && t.dealId && <Link href={`/deals/${t.dealId}`} className="hover:text-primary">{t.dealName}</Link>}
          <span>{label(t.source)}</span>
          {t.dueAt && <span className={overdue ? "text-destructive" : ""}>due {ago(t.dueAt)}</span>}
        </div>
      </div>
      <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" disabled={del.isPending}
        onClick={() => del.mutate({ id: t.id }, { onSuccess: refresh })} data-testid={`button-delete-task-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

export function AddTask({ leadId, dealId }: { leadId?: number; dealId?: number }) {
  const create = useCreateTask();
  const leads = useListLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [lead, setLead] = useState("");
  const [due, setDue] = useState("");
  const submit = () => create.mutate({ data: { title, leadId: leadId ?? (lead ? Number(lead) : undefined), dealId, dueAt: due ? new Date(due).toISOString() : undefined } },
    { onSuccess: () => { setTitle(""); setDue(""); refresh(); toast({ title: "Task added" }); } });
  return (
    <div className="flex flex-wrap gap-2 border-b border-border p-3">
      <Input className="min-w-[200px] flex-1" placeholder="Add a task..." value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim() && submit()} data-testid="input-task-title" />
      {!leadId && !dealId && (
        <select className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={lead} onChange={(e) => setLead(e.target.value)} data-testid="select-task-lead">
          <option value="">No lead</option>{leads.data?.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>)}
        </select>
      )}
      <Input type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} data-testid="input-task-due" />
      <Button disabled={!title.trim() || create.isPending} onClick={submit} data-testid="button-add-task"><Plus className="mr-1 h-4 w-4" />Add</Button>
    </div>
  );
}

export default function Tasks() {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("open");
  const q = useListTasks(view === "all" ? {} : { done: view === "done" });
  return (
    <div>
      <PageHeader eyebrow="Follow-ups" title="Tasks">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {VIEWS.map(([v, l]) => <button key={v} onClick={() => setView(v)} data-testid={`filter-task-${v}`}
            className={cn("rounded-md px-2.5 py-1 text-xs", view === v ? "bg-foreground text-background" : "text-muted-foreground")}>{l}</button>)}
        </div>
      </PageHeader>
      <div className="p-6 md:p-8">
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <AddTask />
          {q.isLoading ? <Rows n={5} h={40} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <div className="p-4"><Empty icon={CheckSquare} title={view === "done" ? "Nothing done yet" : "All caught up"} body="Call summaries and replies that need a human create tasks here automatically." /></div>
          ) : <div className="divide-y divide-border">{q.data.map((t) => <TaskRow key={t.id} t={t} />)}</div>}
        </div>
      </div>
    </div>
  );
}
