import { useState } from "react";
import { Ban, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListSuppressionsQueryKey, useAddSuppressions, useDeleteSuppression, useListSuppressions } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ago, errMsg, useRefreshAll } from "@/components/bits";

const display = (v: string) => v.replace(/^(tel|li):/, "");
const KIND: Record<string, string> = { email: "Email", domain: "Domain", phone: "Phone", linkedin: "LinkedIn" };

/** One list across email, LinkedIn and calls. Unsubscribes and "stop" replies are added automatically. */
export function DoNotContactPanel({ delay }: { delay?: number }) {
  const q = useListSuppressions();
  const qc = useQueryClient();
  const refreshAll = useRefreshAll();
  const { toast } = useToast();
  const add = useAddSuppressions();
  const del = useDeleteSuppression();
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const rows = q.data ?? [];

  return (
    <Panel title="Do-not-contact list" delay={delay} action={<span className="font-mono text-[11px] text-muted-foreground" data-testid="text-dnc-count">{rows.length} entries</span>}>
      <div className="space-y-2 p-4">
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>Nobody on this list gets emails, LinkedIn messages or calls, in any campaign. People who unsubscribe or ask to stop are added automatically. Add emails, whole domains (@company.com), phone numbers or LinkedIn URLs, one per line.</p>
        </div>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"jane@acme.com\n@competitor.com\n+1 555 010 2000"} data-testid="input-dnc" />
        <div className="flex justify-end">
          <Button size="sm" disabled={!text.trim() || add.isPending} data-testid="button-add-dnc"
            onClick={() => add.mutate({ data: { values: text.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean), reason: "manual" } }, {
              onSuccess: (r) => { setText(""); refreshAll(); qc.invalidateQueries({ queryKey: getListSuppressionsQueryKey() }); toast({ title: `${r.added} added`, description: [r.skipped ? `${r.skipped} skipped (already listed or not recognised)` : "", r.leadsStopped ? `${r.leadsStopped} leads stopped` : ""].filter(Boolean).join(" · ") || undefined }); },
              onError: (e) => toast({ title: "Could not add", description: errMsg(e), variant: "destructive" }),
            })}>Add to list</Button>
        </div>
      </div>
      {q.isLoading ? <Rows n={2} h={36} /> : !!rows.length && (
        <div className="divide-y divide-border border-t border-border">
          {(showAll ? rows : rows.slice(0, 8)).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm" data-testid={`row-dnc-${r.id}`}>
              <span className="w-16 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{KIND[r.kind] ?? r.kind}</span>
              <span className="min-w-0 flex-1 truncate">{display(r.value)}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{r.reason} · {ago(r.createdAt)}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" aria-label={`Remove ${display(r.value)}`} data-testid={`button-delete-dnc-${r.id}`}
                onClick={() => del.mutate({ id: r.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListSuppressionsQueryKey() }) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          {rows.length > 8 && <button className="w-full px-4 py-2 text-left text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show all ${rows.length}`}</button>}
        </div>
      )}
    </Panel>
  );
}
