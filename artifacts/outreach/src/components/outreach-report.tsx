import { useState } from "react";
import { Link } from "wouter";
import { useGetOutreachReport, useUpdateCampaign, getGetOutreachReportQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Panel, Pill, Rows, label } from "@/components/bits";
import { useMoney } from "@/components/crm/format";

const rate = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const TH = "px-3 py-2 text-right font-normal";
const TD = "px-3 py-2 text-right font-mono text-xs";

/** Spend on a campaign, edited in place; drives cost per meeting. */
function CostCell({ campaignId, cost }: { campaignId: number; cost: number }) {
  const [v, setV] = useState<string | null>(null);
  const upd = useUpdateCampaign();
  const qc = useQueryClient();
  const save = () => {
    if (v === null) return;
    const n = Math.max(0, Math.round(Number(v) || 0));
    upd.mutate({ id: campaignId, data: { cost: n } }, { onSuccess: () => { setV(null); qc.invalidateQueries({ queryKey: getGetOutreachReportQueryKey() }); } });
  };
  return (
    <Input className="ml-auto h-7 w-24 text-right font-mono text-xs" type="number" min={0} value={v ?? String(cost)} onChange={(e) => setV(e.target.value)}
      onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="Campaign spend" data-testid={`input-campaign-cost-${campaignId}`} />
  );
}

/** Reply, open and click rates by campaign, channel and step, plus what each meeting cost. */
export function OutreachReport() {
  const q = useGetOutreachReport();
  const { money } = useMoney();
  const r = q.data;
  if (q.isLoading) return <Rows n={3} h={80} />;
  if (!r) return null;
  const t = r.totals;
  const kpis: [string, string, string][] = [
    ["Messages sent", String(t.sent), "email + LinkedIn"],
    ["Open rate", rate(t.opened, t.sent), `${t.opened} opened`],
    ["Click rate", rate(t.clicked, t.sent), `${t.clicked} clicked`],
    ["Reply rate", rate(t.replied, t.sent), `${t.replied} replied`],
    ["Bounce rate", rate(t.bounced, t.sent), `${t.bounced} bounced`],
    ["Meetings", String(t.meetings), "booked"],
  ];
  const head = (first: string, extra: string[] = []) => (
    <thead><tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      <th className="px-4 py-2 font-normal">{first}</th>{["Sent", "Opens", "Clicks", "Replies", "Bounces", ...extra].map((h) => <th key={h} className={TH}>{h}</th>)}
    </tr></thead>
  );
  const metrics = (x: { sent: number; opened: number; clicked: number; replied: number; bounced: number }) => (<>
    <td className={TD}>{x.sent}</td><td className={TD}>{rate(x.opened, x.sent)}</td><td className={TD}>{rate(x.clicked, x.sent)}</td>
    <td className={`${TD} font-semibold`}>{rate(x.replied, x.sent)}</td><td className={TD}>{rate(x.bounced, x.sent)}</td>
  </>);

  return (
    <div className="space-y-5" data-testid="outreach-report">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([k, v, sub]) => (
          <div key={k} className="bg-card px-4 py-3" data-testid={`outreach-kpi-${k.toLowerCase().replace(/ /g, "-")}`}>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div>
            <div className="font-display text-xl font-bold">{v}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>
      <Panel title="Campaigns: what works and what each meeting cost">
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] whitespace-nowrap text-sm" data-testid="table-campaign-performance">
          {head("Campaign", ["Meetings", "Spend", "Cost / meeting"])}
          <tbody>{r.campaigns.map((c) => (
            <tr key={c.campaignId} className="border-b border-border last:border-0">
              <td className="px-4 py-2"><Link href={`/campaigns/${c.campaignId}`} className="font-medium hover:text-primary">{c.name}</Link> <Pill value={c.status} /></td>
              {metrics(c)}
              <td className={TD}>{c.meetings}</td>
              <td className="px-3 py-1"><CostCell campaignId={c.campaignId} cost={c.cost} /></td>
              <td className={`${TD} font-semibold`} data-testid={`text-cost-per-meeting-${c.campaignId}`}>{c.costPerMeeting != null ? money(c.costPerMeeting) : "-"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By channel">
          <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm" data-testid="table-channel-performance">
            {head("Channel", ["Meetings"])}
            <tbody>{r.channels.map((c) => (
              <tr key={c.channel} className="border-b border-border last:border-0"><td className="px-4 py-2 capitalize">{label(c.channel)}</td>{metrics(c)}<td className={TD}>{c.meetings}</td></tr>
            ))}{!r.channels.length && <tr><td className="px-4 py-3 text-muted-foreground" colSpan={7}>Nothing sent yet.</td></tr>}</tbody>
          </table></div>
        </Panel>
        <Panel title="By sequence step and A/B version">
          <div className="max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-sm" data-testid="table-step-performance">
            {head("Step")}
            <tbody>{r.steps.map((s) => (
              <tr key={`${s.campaignId}-${s.stepOrder}-${s.variant}-${s.channel}`} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-xs"><span className="font-medium">{s.campaignName}</span> · step {s.stepOrder} <span className="capitalize text-muted-foreground">{s.channel}</span>{s.variant !== "-" && <b className="ml-1 text-primary">{s.variant.toUpperCase()}</b>}</td>
                {metrics(s)}
              </tr>
            ))}{!r.steps.length && <tr><td className="px-4 py-3 text-muted-foreground" colSpan={6}>Step results appear once sequences send.</td></tr>}</tbody>
          </table></div>
        </Panel>
      </div>
    </div>
  );
}
