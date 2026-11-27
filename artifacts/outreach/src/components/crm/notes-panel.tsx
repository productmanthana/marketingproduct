import { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { useCreateNote, useDeleteNote } from "@workspace/api-client-react";
import type { Note } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Panel, Empty, ago, errMsg, useRefreshAll } from "@/components/bits";

export function NotesPanel({ notes, accountId, dealId, delay }: { notes: Note[]; accountId?: number; dealId?: number; delay?: number }) {
  const [body, setBody] = useState("");
  const create = useCreateNote();
  const del = useDeleteNote();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const save = () =>
    create.mutate({ data: { body, accountId, dealId } }, {
      onSuccess: () => { setBody(""); refresh(); },
      onError: (e) => toast({ title: "Could not save note", description: errMsg(e), variant: "destructive" }),
    });
  return (
    <Panel title={`Notes · ${notes.length}`} delay={delay}>
      <div className="space-y-2 border-b border-border p-3">
        <Textarea rows={3} placeholder="Log a call, meeting outcome or anything worth remembering..." value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) save(); }} data-testid="input-note" />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-muted-foreground">Ctrl + Enter to save</span>
          <Button size="sm" disabled={!body.trim() || create.isPending} onClick={save} data-testid="button-add-note">{create.isPending ? "Saving..." : "Add note"}</Button>
        </div>
      </div>
      {!notes.length ? <div className="p-4"><Empty icon={StickyNote} title="No notes yet" /></div> : (
        <div className="divide-y divide-border">
          {notes.map((n) => (
            <div key={n.id} className="group flex gap-3 px-4 py-3" data-testid={`row-note-${n.id}`}>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{ago(n.createdAt)}</div>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive md:opacity-0 md:group-hover:opacity-100" disabled={del.isPending}
                onClick={() => del.mutate({ id: n.id }, { onSuccess: refresh })} data-testid={`button-delete-note-${n.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
