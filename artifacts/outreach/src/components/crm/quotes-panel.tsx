import { useState } from "react";
import { ExternalLink, FileText, Plus, Send, Trash2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Quote,
  type QuoteItem,
  getListQuotesQueryKey,
  useCreateQuote,
  useDeleteQuote,
  useListQuotes,
  useSendQuote,
  useUpdateQuote,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Panel, Pill, ago, errMsg, useRefreshAll } from "@/components/bits";
import { fromDateInput, toDateInput, useMoney } from "./format";

type Draft = { id?: number; title: string; items: QuoteItem[]; discountPercent: number; taxPercent: number; notes: string; validUntil: string };
const blankItem = (): QuoteItem => ({ name: "", quantity: 1, unitPrice: 0 });

function totals(d: Draft) {
  const subtotal = d.items.reduce((n, i) => n + (i.quantity || 0) * (i.unitPrice || 0), 0);
  return { subtotal, total: subtotal * (1 - d.discountPercent / 100) * (1 + d.taxPercent / 100) };
}

/** Quotes on a deal: line items, discount and tax, emailed to the contact with a link to accept or decline. */
export function QuotesPanel({ dealId, dealName, delay }: { dealId: number; dealName: string; delay?: number }) {
  const q = useListQuotes({ dealId }, { query: { queryKey: getListQuotesQueryKey({ dealId }) } });
  const qc = useQueryClient();
  const refreshAll = useRefreshAll();
  const { toast } = useToast();
  const { money } = useMoney();
  const create = useCreateQuote();
  const update = useUpdateQuote();
  const del = useDeleteQuote();
  const send = useSendQuote();
  const [draft, setDraft] = useState<Draft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: getListQuotesQueryKey({ dealId }) });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: "destructive" });

  const open = (quote?: Quote) =>
    setDraft(quote
      ? { id: quote.id, title: quote.title, items: quote.items.length ? quote.items : [blankItem()], discountPercent: quote.discountPercent, taxPercent: quote.taxPercent, notes: quote.notes ?? "", validUntil: toDateInput(quote.validUntil) }
      : { title: dealName, items: [blankItem()], discountPercent: 0, taxPercent: 0, notes: "", validUntil: toDateInput(new Date(Date.now() + 30 * 86_400_000).toISOString()) });

  const save = () => {
    if (!draft) return;
    const data = { title: draft.title.trim(), items: draft.items.filter((i) => i.name.trim()), discountPercent: draft.discountPercent, taxPercent: draft.taxPercent, notes: draft.notes, validUntil: fromDateInput(draft.validUntil) };
    const done = { onSuccess: () => { refresh(); setDraft(null); toast({ title: "Quote saved" }); }, onError: fail("Could not save quote") };
    if (draft.id) update.mutate({ id: draft.id, data }, done);
    else create.mutate({ data: { ...data, dealId } }, done);
  };
  const setItem = (i: number, patch: Partial<QuoteItem>) => draft && setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  return (
    <Panel title={`Quotes · ${q.data?.length ?? 0}`} delay={delay}
      action={!draft && <button className="text-xs text-primary hover:underline" onClick={() => open()} data-testid="button-new-quote">+ Quote</button>}>
      {draft && (
        <div className="space-y-3 border-b border-border bg-muted/30 p-4" data-testid="form-quote">
          <div><Label className="text-xs">Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="input-quote-title" /></div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_70px_110px_28px] gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><span>Item</span><span>Qty</span><span>Unit price</span><span /></div>
            {draft.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_110px_28px] gap-2">
                <Input className="h-8" placeholder="e.g. Annual plan, 10 seats" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} data-testid={`input-quote-item-name-${i}`} />
                <Input className="h-8" type="number" min={0} value={it.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} data-testid={`input-quote-item-qty-${i}`} />
                <Input className="h-8" type="number" min={0} value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} data-testid={`input-quote-item-price-${i}`} />
                <button className="text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={draft.items.length === 1} aria-label="Remove line" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button className="text-xs text-primary hover:underline" onClick={() => setDraft({ ...draft, items: [...draft.items, blankItem()] })} data-testid="button-add-quote-item"><Plus className="mr-0.5 inline h-3 w-3" />Line</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-xs">Discount %</Label><Input type="number" min={0} max={100} value={draft.discountPercent} onChange={(e) => setDraft({ ...draft, discountPercent: Number(e.target.value) })} data-testid="input-quote-discount" /></div>
            <div><Label className="text-xs">Tax %</Label><Input type="number" min={0} max={100} value={draft.taxPercent} onChange={(e) => setDraft({ ...draft, taxPercent: Number(e.target.value) })} data-testid="input-quote-tax" /></div>
            <div><Label className="text-xs">Valid until</Label><Input type="date" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} data-testid="input-quote-valid" /></div>
          </div>
          <div><Label className="text-xs">Terms or notes (shown on the quote)</Label><Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} data-testid="input-quote-notes" /></div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Total <b data-testid="text-quote-draft-total">{money(totals(draft).total)}</b></span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" disabled={!draft.title.trim() || !draft.items.some((i) => i.name.trim()) || create.isPending || update.isPending} onClick={save} data-testid="button-save-quote">Save quote</Button>
            </div>
          </div>
        </div>
      )}
      {!q.data?.length && !draft ? (
        <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground"><FileText className="h-4 w-4" />No quotes yet. Build one and email it; the contact can accept it online.</div>
      ) : (
        <div className="divide-y divide-border">{q.data?.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`row-quote-${x.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><b>{x.number}</b><span className="truncate">{x.title}</span><Pill value={x.status} /></div>
              <div className="text-xs text-muted-foreground">{money(x.total)} · {x.items.length} line{x.items.length === 1 ? "" : "s"}{x.sentAt ? ` · sent ${ago(x.sentAt)}` : ""}{x.respondedAt ? ` · ${x.status} ${ago(x.respondedAt)}` : ""}</div>
            </div>
            <a href={x.publicUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open the quote page" data-testid={`link-quote-${x.id}`}><ExternalLink className="h-4 w-4" /></a>
            {(x.status === "draft" || x.status === "sent") && <Button size="sm" variant="ghost" onClick={() => open(x)} data-testid={`button-edit-quote-${x.id}`}>Edit</Button>}
            {x.status !== "accepted" && (
              <Button size="sm" variant="outline" disabled={send.isPending} data-testid={`button-send-quote-${x.id}`}
                onClick={() => send.mutate({ id: x.id }, { onSuccess: () => { refresh(); refreshAll(); toast({ title: `Quote ${x.number} emailed` }); }, onError: fail("Could not send quote") })}>
                <Send className="mr-1 h-3.5 w-3.5" />{x.status === "sent" ? "Resend" : "Send"}</Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" aria-label="Delete quote" data-testid={`button-delete-quote-${x.id}`}
              onClick={() => del.mutate({ id: x.id }, { onSuccess: refresh })}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}</div>
      )}
    </Panel>
  );
}
