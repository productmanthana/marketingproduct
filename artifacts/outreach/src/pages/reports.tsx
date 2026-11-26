import { Link } from "wouter";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useGetCrmReport } from "@workspace/api-client-react";
import { PageHeader, Panel, Rows, ErrorBox, Empty, pct } from "@/components/bits";
import { STAGES, stageMeta, useMoney } from "@/components/crm/format";

const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const legendText = (v: string) => <span style={{ color: "hsl(var(--foreground))" }}>{v}</span>;
const TIP = { contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };

export default function Reports() {
  const q = useGetCrmReport();
  const { money, compact } = useMoney();
  const r = q.data;
  if (q.isLoading) return <div className="p-8"><Rows n={4} h={120} /></div>;
  if (q.isError || !r) return <ErrorBox onRetry={() => q.refetch()} />;
  const hasDeals = r.byStage.some((s) => s.count > 0);
  const kpis: [string, string, string][] = [
    ["Open pipeline", money(r.openPipeline), `${r.openDeals} open deals`],
    ["Weighted forecast", money(r.weightedPipeline), "amount x probability"],
    ["Won this quarter", money(r.wonThisQuarter), `${money(r.wonThisMonth)} this month`],
    ["Win rate", pct(r.winRate), "won / closed"],
    ["Avg deal size", money(r.avgDealSize), "won deals"],
    ["Sales cycle", `${r.avgCycleDays} days`, "created to won"],
  ];

  return (
    <div>
      <PageHeader eyebrow="CRM · Analytics" title="Reports" />
      <div className="space-y-5 p-6 md:p-8">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
          {kpis.map(([k, v, sub]) => (
            <div key={k} className="bg-card px-4 py-3" data-testid={`report-kpi-${k.toLowerCase().replace(/ /g, "-")}`}>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
              <div className="font-display text-xl font-bold">{v}</div>
              <div className="text-[11px] text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>

        {!hasDeals ? (
          <Empty icon={BarChart3} title="No deals to report on yet" body="Reports fill in as you add deals to the pipeline."><Link href="/pipeline" className="text-sm text-primary hover:underline">Open the pipeline</Link></Empty>
        ) : (<>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Pipeline by stage">
              <div className="h-72 p-3" data-testid="chart-by-stage">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.byStage.map((s) => ({ ...s, label: stageMeta(s.stage).label }))} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={AXIS} tickFormatter={compact} />
                    <YAxis type="category" dataKey="label" tick={AXIS} width={92} />
                    <Tooltip {...TIP} formatter={(v: number, _n, p) => [`${money(v)} · ${p.payload.count} deals`, "Amount"]} />
                    <Bar dataKey="amount" radius={[0, 4, 4, 0]}>{r.byStage.map((s) => <Cell key={s.stage} fill={stageMeta(s.stage).color} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Forecast by close month" delay={40}>
              <div className="h-72 p-3" data-testid="chart-forecast">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.forecast.map((m) => ({ ...m, label: monthLabel(m.month), upside: Math.max(0, m.open - m.weighted) }))}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={AXIS} />
                    <YAxis tick={AXIS} tickFormatter={compact} width={60} />
                    <Tooltip {...TIP} formatter={(v: number, n: string) => [money(v), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                    <Bar dataKey="won" name="Won" stackId="a" fill="hsl(var(--ch-linkedin))" />
                    <Bar dataKey="weighted" name="Weighted" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="upside" name="Best case upside" stackId="a" fill="hsl(var(--primary) / .3)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Won vs lost · last 6 months" delay={80}>
              <div className="h-64 p-3" data-testid="chart-trend">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.trend.map((m) => ({ ...m, label: monthLabel(m.month) }))}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={AXIS} />
                    <YAxis tick={AXIS} allowDecimals={false} width={30} />
                    <Tooltip {...TIP} formatter={(v: number, n: string, p) => [n === "Won" ? `${v} (${money(p.payload.wonAmount)})` : v, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                    <Bar dataKey="wonCount" name="Won" fill="hsl(var(--ch-linkedin))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="lostCount" name="Lost" fill="hsl(var(--destructive) / .7)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Top accounts" delay={120}>
              {!r.topAccounts.length ? <p className="p-4 text-sm text-muted-foreground">Link deals to accounts to rank them here.</p> : (
                <table className="w-full text-sm" data-testid="table-top-accounts">
                  <thead className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-4 py-2 font-medium">Account</th><th className="px-4 py-2 text-right font-medium">Won</th><th className="px-4 py-2 text-right font-medium">Pipeline</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">{r.topAccounts.map((a) => (
                    <tr key={a.id}><td className="px-4 py-2.5"><Link href={`/accounts/${a.id}`} className="font-medium hover:text-primary">{a.name}</Link></td>
                      <td className="px-4 py-2.5 text-right font-mono">{money(a.wonValue)}</td><td className="px-4 py-2.5 text-right font-mono">{money(a.pipelineValue)}</td></tr>))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
          <Panel title="Stage summary" delay={160}>
            <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-6">
              {STAGES.map((s) => {
                const row = r.byStage.find((x) => x.stage === s.id)!;
                return <div key={s.id} className="bg-card px-4 py-3" style={{ boxShadow: `inset 0 3px 0 ${s.color}` }}>
                  <div className="text-xs font-semibold">{s.label}</div><div className="font-display text-lg font-bold">{row.count}</div><div className="font-mono text-[11px] text-muted-foreground">{money(row.amount)}</div></div>;
              })}
            </div>
          </Panel>
        </>)}
      </div>
    </div>
  );
}
