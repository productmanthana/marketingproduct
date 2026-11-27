import { useMemo, useState, type DragEvent } from "react";
import { Link } from "wouter";
import { ArrowDownUp, CalendarClock, Columns3, KanbanSquare, List, Plus, Search } from "lucide-react";
import { useGetCrmReport, useListDeals, useUpdateDeal } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PageHeader, Rows, ErrorBox, Empty, Initials, errMsg, pct, useRefreshAll } from "@/components/bits";
import { DealDialog } from "@/components/crm/deal-dialog";
import { CloseDealDialog } from "@/components/crm/close-deal-dialog";
import { OPEN_STAGES, STAGES, isClosedStage, shortDate, stageMeta, useMoney } from "@/components/crm/format";

type Period = "all" | "month" | "quarter";
type SortKey = "name" | "accountName" | "stage" | "amount" | "closeDate" | "probability";

function inPeriod(d: Deal, p: Period) {
  if (p === "all") return true;
  const now = new Date();
  const end = p === "month" ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 1);
  // Overdue and undated open deals still belong to the current period.
  return !d.closeDate || new Date(d.closeDate) < end;
}

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));

export default function Pipeline() {
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [showClosed, setShowClosed] = useState(true);
  const [creating, setCreating] = useState<DealStage | null>(null);
  const [closing, setClosing] = useState<{ deal: Deal; outcome: "closed_won" | "closed_lost" } | null>(null);
  const [moved, setMoved] = useState<Record<number, DealStage>>({});
  const [over, setOver] = useState<DealStage | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "closeDate", dir: 1 });
  const q = useListDeals(search ? { search } : undefined);
  const report = useGetCrmReport();
  const upd = useUpdateDeal();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const { money, compact } = useMoney();

  const deals = useMemo(
    () => (q.data ?? []).map((d) => (moved[d.id] ? { ...d, stage: moved[d.id]! } : d)).filter((d) => inPeriod(d, period) && (showClosed || !isClosedStage(d.stage))),
    [q.data, moved, period, showClosed],
  );

  const move = (deal: Deal, stage: DealStage) => {
    if (deal.stage === stage) return;
    if (isClosedStage(stage)) { setClosing({ deal, outcome: stage as "closed_won" | "closed_lost" }); return; }
    setMoved((m) => ({ ...m, [deal.id]: stage }));
    upd.mutate({ id: deal.id, data: { stage } }, {
      onSuccess: () => { refresh(); toast({ title: `Moved to ${stageMeta(stage).label}` }); },
      onError: (e) => toast({ title: "Could not move deal", description: errMsg(e), variant: "destructive" }),
      onSettled: () => setMoved((m) => { const { [deal.id]: _, ...rest } = m; return rest; }),
    });
  };
  const onDrop = (e: DragEvent, stage: DealStage) => {
    e.preventDefault();
    setOver(null);
    const deal = deals.find((d) => d.id === Number(e.dataTransfer.getData("text/deal-id")));
    if (deal) move(deal, stage);
  };

  const columns = showClosed ? STAGES : OPEN_STAGES;
  const sorted = [...deals].sort((a, b) => {
    const k = sort.key;
    const av = k === "stage" ? STAGES.findIndex((s) => s.id === a.stage) : (a[k] ?? "");
    const bv = k === "stage" ? STAGES.findIndex((s) => s.id === b.stage) : (b[k] ?? "");
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const r = report.data;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <PageHeader eyebrow="CRM · Opportunities" title="Pipeline">
        <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search deals or accounts" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-deals" /></div>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {([["board", KanbanSquare, "Board"], ["list", List, "List"]] as const).map(([v, I, l]) => (
            <button key={v} onClick={() => setView(v)} data-testid={`view-${v}`} className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs", view === v ? "bg-foreground text-background" : "text-muted-foreground")}><I className="h-3.5 w-3.5" />{l}</button>
          ))}
        </div>
        <Button onClick={() => setCreating("prospecting")} data-testid="button-new-deal"><Plus className="mr-1 h-4 w-4" />New deal</Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
        {[
          ["Open pipeline", r ? money(r.openPipeline) : "-", r ? `${r.openDeals} open deals` : ""],
          ["Weighted forecast", r ? money(r.weightedPipeline) : "-", "amount x probability"],
          ["Won this month", r ? money(r.wonThisMonth) : "-", r ? `${money(r.wonThisQuarter)} this quarter` : ""],
          ["Win rate", r ? pct(r.winRate) : "-", r ? `avg deal ${compact(r.avgDealSize)}` : ""],
        ].map(([k, v, sub]) => (
          <div key={k} className="bg-background px-6 py-3 md:px-8" data-testid={`kpi-${k.toLowerCase().replace(/ /g, "-")}`}>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
            <div className="font-display text-xl font-bold">{v}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3 md:px-8">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {([["all", "All dates"], ["month", "Closing this month"], ["quarter", "This quarter"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setPeriod(v)} data-testid={`period-${v}`} className={cn("rounded-md px-2.5 py-1 text-xs", period === v ? "bg-foreground text-background" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        <button onClick={() => setShowClosed((s) => !s)} data-testid="toggle-closed"
          className={cn("flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs", showClosed ? "border-foreground" : "border-border text-muted-foreground")}>
          <Columns3 className="h-3.5 w-3.5" />{showClosed ? "Showing closed" : "Open only"}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">Drag cards between stages to update them</span>
      </div>

      {q.isLoading ? <div className="px-6 md:px-8"><Rows n={4} h={90} /></div> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length && !search ? (
        <div className="px-6 md:px-8"><Empty icon={KanbanSquare} title="No deals yet" body="Create a deal, convert a lead from its page, or let a booked meeting open one automatically.">
          <Button onClick={() => setCreating("prospecting")} data-testid="button-empty-new-deal"><Plus className="mr-1 h-4 w-4" />New deal</Button></Empty></div>
      ) : view === "board" ? (
        <div className="flex flex-1 gap-3 overflow-x-auto px-6 pb-6 md:px-8" data-testid="pipeline-board">
          {columns.map((s) => {
            const items = deals.filter((d) => d.stage === s.id);
            const total = items.reduce((t, d) => t + d.amount, 0);
            const weighted = items.reduce((t, d) => t + (d.amount * d.probability) / 100, 0);
            return (
              <section key={s.id} data-testid={`column-${s.id}`}
                onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver((o) => (o === s.id ? null : o))} onDrop={(e) => onDrop(e, s.id)}
                className={cn("flex min-w-[220px] flex-1 shrink-0 basis-0 flex-col rounded-xl border bg-muted/40 transition-colors", over === s.id ? "border-primary bg-accent/50" : "border-border")}>
                <header className="border-b border-border px-3 pb-2 pt-3" style={{ boxShadow: `inset 0 3px 0 ${s.color}` }}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{s.label}</h2>
                    <span className="rounded-full bg-card px-2 font-mono text-[10px]">{items.length}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{money(total)}{!isClosedStage(s.id) && ` · ${compact(weighted)} wtd`}</div>
                </header>
                <div className="flex-1 space-y-2 p-2">
                  {items.map((d) => <DealCard key={d.id} d={d} money={money} />)}
                  {!isClosedStage(s.id) && (
                    <button onClick={() => setCreating(s.id)} data-testid={`button-add-in-${s.id}`}
                      className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-foreground hover:text-foreground"><Plus className="h-3 w-3" />Add deal</button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="px-6 pb-8 md:px-8">
          <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
            <table className="w-full text-sm" data-testid="table-deals">
              <thead className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>{([["name", "Deal"], ["accountName", "Account"], ["stage", "Stage"], ["amount", "Amount"], ["probability", "Prob."], ["closeDate", "Close date"]] as const).map(([k, l]) => (
                  <th key={k} className="px-4 py-2.5 font-medium">
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : 1 }))} data-testid={`sort-${k}`}>
                      {l}<ArrowDownUp className={cn("h-3 w-3", sort.key === k ? "text-foreground" : "opacity-40")} /></button></th>))}
                  <th className="px-4 py-2.5 font-medium">Next step</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((d) => {
                  const overdue = !isClosedStage(d.stage) && d.closeDate && new Date(d.closeDate) < new Date();
                  return (
                    <tr key={d.id} className="hover:bg-muted/40" data-testid={`row-deal-${d.id}`}>
                      <td className="px-4 py-2.5 font-medium"><Link href={`/deals/${d.id}`} className="hover:text-primary">{d.name}</Link></td>
                      <td className="px-4 py-2.5">{d.accountId ? <Link href={`/accounts/${d.accountId}`} className="hover:text-primary">{d.accountName}</Link> : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-4 py-2.5"><StageBadge stage={d.stage} /></td>
                      <td className="px-4 py-2.5 font-mono">{money(d.amount)}</td>
                      <td className="px-4 py-2.5 font-mono">{d.probability}%</td>
                      <td className={cn("px-4 py-2.5", overdue && "text-destructive")}>{shortDate(d.closeDate)}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground">{d.nextStep ?? "-"}</td>
                    </tr>
                  );
                })}
                {!sorted.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No deals match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating && <DealDialog open onClose={() => setCreating(null)} stage={creating} />}
      {closing && <CloseDealDialog deal={closing.deal} outcome={closing.outcome} onClose={() => setClosing(null)} />}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const m = stageMeta(stage);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 12%, transparent)` }} data-testid={`stage-${stage}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />{m.label}
    </span>
  );
}

function DealCard({ d, money }: { d: Deal; money: (n: number) => string }) {
  const closed = isClosedStage(d.stage);
  const overdue = !closed && d.closeDate && new Date(d.closeDate) < new Date();
  const stale = !closed && daysSince(d.stageChangedAt) > 21;
  return (
    <Link href={`/deals/${d.id}`} draggable onDragStart={(e: DragEvent) => { e.dataTransfer.setData("text/deal-id", String(d.id)); e.dataTransfer.effectAllowed = "move"; }}
      className="rise block cursor-grab rounded-lg border border-card-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing" data-testid={`card-deal-${d.id}`}>
      <div className="text-sm font-semibold leading-snug">{d.name}</div>
      {d.accountName && <div className="truncate text-xs text-muted-foreground">{d.accountName}</div>}
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-sm font-medium">{money(d.amount)}</span>
        {d.leadName && <Initials name={d.leadName} className="h-6 w-6 rounded-md text-[9px]" />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-muted-foreground">
        <span className={overdue ? "text-destructive" : ""}>{overdue ? "overdue · " : ""}{shortDate(d.closeDate)}</span>
        {!closed && <span>{d.probability}%</span>}
        {stale && <span className="text-[hsl(36_80%_32%)]">{daysSince(d.stageChangedAt)}d in stage</span>}
      </div>
    </Link>
  );
}
