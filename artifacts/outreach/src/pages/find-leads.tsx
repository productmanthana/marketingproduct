import { useState } from "react";
import { Link } from "wouter";
import { Check, ExternalLink, Lock, Search, Telescope, UserPlus } from "lucide-react";
import {
  useGetProspectStatus,
  useImportProspects,
  useListCampaigns,
  useSearchProspects,
} from "@workspace/api-client-react";
import type { ProspectSearchInput, ProspectSearchResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Panel, Empty, Rows, Initials, errMsg, useRefreshAll } from "@/components/bits";
import { cn } from "@/lib/utils";

const SIZES = [
  { v: "1,10", l: "1-10" },
  { v: "11,50", l: "11-50" },
  { v: "51,200", l: "51-200" },
  { v: "201,500", l: "201-500" },
  { v: "501,1000", l: "501-1k" },
  { v: "1001,5000", l: "1k-5k" },
  { v: "5001,100000", l: "5k+" },
];

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const sel = "h-9 rounded-md border border-input bg-card px-2 text-sm";

export default function FindLeads() {
  const status = useGetProspectStatus();
  const camps = useListCampaigns();
  const search = useSearchProspects();
  const imp = useImportProspects();
  const refresh = useRefreshAll();
  const { toast } = useToast();

  const [industries, setIndustries] = useState("");
  const [titles, setTitles] = useState("");
  const [locations, setLocations] = useState("");
  const [keywords, setKeywords] = useState("");
  const [sizes, setSizes] = useState<string[]>([]);
  const [result, setResult] = useState<ProspectSearchResult | null>(null);
  const [lastQuery, setLastQuery] = useState<ProspectSearchInput | null>(null);
  const [error, setError] = useState<{ msg: string; plan: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState("");

  const run = (q: ProspectSearchInput) => {
    setError(null);
    search.mutate({ data: q }, {
      onSuccess: (r) => { setResult(r); setLastQuery(q); setPicked(new Set()); },
      onError: (e) => {
        const plan = !!(e as { data?: { planRestricted?: boolean } })?.data?.planRestricted;
        setError({ msg: errMsg(e), plan });
        setResult(null);
      },
    });
  };

  const submit = () => run({
    industries: list(industries), titles: list(titles), locations: list(locations),
    employeeRanges: sizes, keywords: keywords || undefined, page: 1,
  });

  const selectable = result?.people.filter((p) => !p.alreadyImported) ?? [];
  const allPicked = selectable.length > 0 && selectable.every((p) => picked.has(p.apolloId));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const doImport = () => imp.mutate(
    { data: { apolloIds: [...picked], campaignId: campaignId ? Number(campaignId) : undefined } },
    {
      onSuccess: (r) => {
        toast({ title: `Added ${r.imported} leads`, description: r.skipped ? `${r.skipped} skipped (already added or no details)` : undefined });
        refresh();
        if (lastQuery) run(lastQuery);
      },
      onError: (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
    },
  );

  const notConnected = status.data && !status.data.configured;

  return (
    <div>
      <PageHeader eyebrow="Prospecting · Apollo" title="Find leads" />
      <div className="space-y-5 p-6 md:p-8">
        {notConnected && (
          <div className="rounded-xl border border-card-border bg-card p-4 text-sm" data-testid="banner-apollo-missing">
            Apollo isn't connected. Add your Apollo API key as the <span className="font-mono">Apollo_api_key</span> secret to search for leads.
          </div>
        )}

        <Panel title="Who are you looking for?">
          <form className="grid gap-4 p-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="space-y-1.5"><Label>Sector / industry</Label>
              <Input placeholder="saas, fintech, healthcare" value={industries} onChange={(e) => setIndustries(e.target.value)} data-testid="input-industries" /></div>
            <div className="space-y-1.5"><Label>Job titles</Label>
              <Input placeholder="VP Sales, Head of Marketing, Founder" value={titles} onChange={(e) => setTitles(e.target.value)} data-testid="input-titles" /></div>
            <div className="space-y-1.5"><Label>Locations</Label>
              <Input placeholder="India, Bangalore, United States" value={locations} onChange={(e) => setLocations(e.target.value)} data-testid="input-locations" /></div>
            <div className="space-y-1.5"><Label>Keywords (optional)</Label>
              <Input placeholder="e.g. hiring SDRs" value={keywords} onChange={(e) => setKeywords(e.target.value)} data-testid="input-keywords" /></div>
            <div className="space-y-1.5 md:col-span-2"><Label>Company size (employees)</Label>
              <div className="flex flex-wrap gap-1.5">
                {SIZES.map((s) => {
                  const on = sizes.includes(s.v);
                  return <button type="button" key={s.v} data-testid={`chip-size-${s.l}`}
                    onClick={() => setSizes((x) => on ? x.filter((y) => y !== s.v) : [...x, s.v])}
                    className={cn("rounded-full border px-3 py-1 font-mono text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50")}>{s.l}</button>;
                })}
              </div></div>
            <div className="flex items-center justify-between gap-3 md:col-span-2">
              <p className="text-xs text-muted-foreground">Separate multiple values with commas. Searching is free; adding leads uses Apollo credits to reveal emails.</p>
              <Button type="submit" disabled={search.isPending || !!notConnected} data-testid="button-search-prospects">
                <Search className="mr-1 h-4 w-4" />{search.isPending ? "Searching..." : "Search Apollo"}
              </Button>
            </div>
          </form>
        </Panel>

        {error && (
          <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm", error.plan ? "border-amber-300 bg-amber-50 text-amber-900" : "border-destructive/40 bg-destructive/5 text-destructive")} data-testid="banner-search-error">
            {error.plan && <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="space-y-1">
              <div>{error.msg}</div>
              {error.plan && <a href="https://www.apollo.io/pricing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">See Apollo plans <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>
        )}

        {search.isPending && !result ? (
          <div className="overflow-hidden rounded-xl border border-card-border bg-card"><Rows n={6} h={44} /></div>
        ) : result && (
          <Panel
            title={`${result.total.toLocaleString()} people found`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <select className={sel} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid="select-import-campaign">
                  <option value="">No campaign</option>
                  {camps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Button size="sm" disabled={!picked.size || imp.isPending} onClick={doImport} data-testid="button-import-prospects">
                  <UserPlus className="mr-1 h-4 w-4" />{imp.isPending ? "Adding..." : `Add ${picked.size || ""} to leads`}
                </Button>
              </div>
            }
          >
            {!result.people.length ? (
              <Empty icon={Telescope} title="No one matches" body="Try fewer filters or broader job titles." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="w-10 px-4 py-2"><input type="checkbox" checked={allPicked} disabled={!selectable.length} data-testid="checkbox-select-all"
                      onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.map((p) => p.apolloId)))} /></th>
                    <th className="px-3 font-normal">Person</th><th className="px-3 font-normal">Company</th><th className="px-3 font-normal">Location</th><th className="px-4 text-right font-normal">Email</th>
                  </tr></thead>
                  <tbody>
                    {result.people.map((p, i) => (
                      <tr key={p.apolloId} className={cn("rise border-b border-border last:border-0", p.alreadyImported ? "opacity-60" : "hover:bg-muted/40")} style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }} data-testid={`row-prospect-${p.apolloId}`}>
                        <td className="px-4 py-2">{p.alreadyImported ? <Check className="h-4 w-4 text-muted-foreground" /> :
                          <input type="checkbox" checked={picked.has(p.apolloId)} onChange={() => toggle(p.apolloId)} data-testid={`checkbox-prospect-${p.apolloId}`} />}</td>
                        <td className="px-3 py-2"><div className="flex items-center gap-2.5"><Initials name={`${p.firstName} ${p.lastName}`} className="h-7 w-7 text-[10px]" />
                          <span><span className="block font-medium">{p.firstName} {p.lastName}</span><span className="block text-xs text-muted-foreground">{p.title}</span></span></div></td>
                        <td className="px-3">{p.company ?? "-"}</td>
                        <td className="px-3 text-xs text-muted-foreground">{p.location ?? "-"}</td>
                        <td className="px-4 text-right font-mono text-xs">{p.alreadyImported ? <Link href="/leads" className="text-primary hover:underline">added</Link> : p.hasEmail ? "available" : <span className="text-muted-foreground">none</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.totalPages > 1 && lastQuery && (
              <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 font-mono text-xs">
                <Button size="sm" variant="outline" disabled={result.page <= 1 || search.isPending} onClick={() => run({ ...lastQuery, page: result.page - 1 })} data-testid="button-prev-page">Prev</Button>
                <span>page {result.page} / {result.totalPages}</span>
                <Button size="sm" variant="outline" disabled={result.page >= result.totalPages || search.isPending} onClick={() => run({ ...lastQuery, page: result.page + 1 })} data-testid="button-next-page">Next</Button>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
