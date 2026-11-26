import { useState } from "react";
import { MessageSquareWarning, Pencil, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Objection,
  getListObjectionsQueryKey,
  useCreateObjection,
  useDeleteObjection,
  useListObjections,
  useUpdateObjection,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, errMsg } from "@/components/bits";

const EXAMPLES = [
  { objection: "It's too expensive", answer: "Most customers cover the cost within the first two months through the time they save. Happy to walk through the numbers for your team on a short call." },
  { objection: "We already use another tool", answer: "Many of our customers switched from a similar tool; the main difference they notice is ... Worth a 15 minute comparison?" },
  { objection: "Not the right time", answer: "Totally understand. When would be a better time to reconnect? I can send a short summary now so it's ready when you are." },
];

/** Approved answers to common pushback. The AI bases its replies on them and may send them without review. */
export function ObjectionsPanel({ delay }: { delay?: number }) {
  const q = useListObjections();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateObjection();
  const update = useUpdateObjection();
  const del = useDeleteObjection();
  const [draft, setDraft] = useState<{ id?: number; objection: string; answer: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: getListObjectionsQueryKey() });

  const save = () => {
    if (!draft) return;
    const data = { objection: draft.objection.trim(), answer: draft.answer.trim() };
    const done = { onSuccess: () => { refresh(); setDraft(null); toast({ title: "Answer saved" }); }, onError: (e: unknown) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }) };
    if (draft.id) update.mutate({ id: draft.id, data }, done);
    else create.mutate({ data }, done);
  };

  return (
    <Panel title="Objection library" delay={delay}
      action={<Button size="sm" onClick={() => setDraft({ objection: "", answer: "" })} data-testid="button-add-objection"><Plus className="mr-1 h-3.5 w-3.5" />Answer</Button>}>
      <div className="flex items-start gap-3 p-4 pb-2 text-sm text-muted-foreground">
        <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>Approved answers to common pushback. When a prospect raises one, the AI replies based on your answer, and can send it on its own even when "Escalate negative replies" is on.</p>
      </div>
      {draft && (
        <div className="space-y-2 border-y border-border bg-muted/30 p-4" data-testid="form-objection">
          <Input placeholder="Objection, e.g. It's too expensive" value={draft.objection} onChange={(e) => setDraft({ ...draft, objection: e.target.value })} data-testid="input-objection" />
          <Textarea rows={3} placeholder="Your approved answer" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} data-testid="input-objection-answer" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" disabled={!draft.objection.trim() || !draft.answer.trim() || create.isPending || update.isPending} onClick={save} data-testid="button-save-objection">Save</Button>
          </div>
        </div>
      )}
      {q.isLoading ? <Rows n={2} h={40} /> : !q.data?.length ? (
        <div className="space-y-1.5 p-4 pt-2 text-sm">
          <p className="text-xs text-muted-foreground">No answers yet. Start from an example:</p>
          <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => (
            <button key={e.objection} onClick={() => setDraft(e)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-foreground" data-testid="button-objection-example">{e.objection}</button>
          ))}</div>
        </div>
      ) : (
        <div className="divide-y divide-border">{q.data.map((o: Objection) => (
          <div key={o.id} className="flex items-start gap-3 p-4" data-testid={`row-objection-${o.id}`}>
            <div className="min-w-0 flex-1 text-sm"><b>“{o.objection}”</b><p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{o.answer}</p></div>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDraft(o)} aria-label="Edit answer"><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" aria-label="Delete answer" data-testid={`button-delete-objection-${o.id}`}
              onClick={() => del.mutate({ id: o.id }, { onSuccess: refresh })}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}</div>
      )}
    </Panel>
  );
}
