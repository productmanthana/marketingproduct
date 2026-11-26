import { useState } from "react";
import { Check, ExternalLink, Search } from "lucide-react";
import { useEnrollLeads, useGetProspectStatus, useImportProspects, useSearchProspects } from "@workspace/api-client-react";
import type { Prospect, ProspectSearchInput, ProspectSearchResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Rows, errMsg, useRefreshAll } from "@/components/bits";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Search Apollo from inside a campaign. People added before are flagged with where they are now.
export function ApolloToCampaign({ campaignId, onDone }: { campaignId: number; onDone: () => void }) {
  const status = useGetProspectStatus();
  const search = useSearchProspects();
  const imp = useImportProspects();
  const enroll = useEnrollLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState({ titles: "", industries: "", locations: "", keywords: "" });
  const [result, setResult] = useState<ProspectSearchResult | null>(null);
  const [query, setQuery] = useState<ProspectSearchInput | null>(null);
  const [error, setError] = useState<{ msg: string; plan: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const run = (q: ProspectSearchInput) => {
    setError(null);
    search.mutate({ data: q }, {
      onSuccess: (r) => { setResult(r); setQuery(q); setPicked(new Set()); },
      onError: (e) => { setError({ msg: errMsg(e), plan: !!(e as { data?: { planRestricted?: boolean } })?.data?.planRestricted }); setResult(null); },
    });
  };
  const inThis = (p: Prospect) => p.campaignId === campaignId;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const add = async () => {
    const chosen = result!.people.filter((p) => picked.has(p.apolloId));
    const fresh = chosen.filter((p) => !p.leadId).map((p) => p.apolloId);
    const known = chosen.flatMap((p) => (p.leadId ? [p.leadId] : []));
    try {
      const r = fresh.length ? await imp.mutateAsync({ data: { apolloIds: fresh, campaignId } }) : { imported: 0 };
      if (known.length) await enroll.mutateAsync({ id: campaignId, data: { leadIds: known } });
      refresh();
      toast({ title: `${r.imported + known.length} added to this campaign`, description: fresh.length > r.imported ? `${fresh.length - r.imported} skipped (no details from Apollo)` : undefined });
      onDone();
    } catch (e) {
      toast({ title: "Couldn't add them", description: errMsg(e), variant: "destructive" });
    }
  };

  if (status.data && !status.data.configured) {
    return <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Apollo isn't connected yet. Add your Apollo API key in secrets to search here.</p>;
  }

  const field = (k: keyof typeof f, placeholder: string) => (
    <Input className="h-8 text-sm" placeholder={placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-apollo-${k}`} />
  );
  const busy = imp.isPending || enroll.isPending;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <form className="grid grid-cols-2 gap-2" onSubmit={(e) => {
        e.preventDefault();
        run({ titles: list(f.titles), industries: list(f.industries), locations: list(f.locations), keywords: f.keywords || undefined, page: 1 });
      }}>
        {field("titles", "Job titles: Founder, VP Sales")}
        {field("industries", "Industry: saas, fintech")}
        {field("locations", "Location: Mumbai, India")}
        {field("keywords", "Keywords")}
        <Button type="submit" size="sm" className="col-span-2" disabled={search.isPending} data-testid="button-apollo-search">
          <Search className="mr-1 h-4 w-4" />{search.isPending ? "Searching..." : "Search Apollo"}
        </Button>
      </form>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" data-testid="apollo-search-error">
          {error.msg}
          {error.plan && <a href="https://www.apollo.io/pricing" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 underline">See Apollo plans <ExternalLink className="h-3 w-3" /></a>}
        </div>
      )}

      {search.isPending && !result ? <Rows n={3} h={36} /> : result && (
        <>
          <div className="text-xs text-muted-foreground">{result.total.toLocaleString()} people found</div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {!result.people.length ? <p className="p-4 text-center text-sm text-muted-foreground">No one matches. Try fewer filters.</p> : result.people.map((p) => (
              <label key={p.apolloId} className={`flex items-center gap-3 border-b border-border px-3 py-2 last:border-0 ${inThis(p) ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`} data-testid={`row-apollo-${p.apolloId}`}>
                {inThis(p) ? <Check className="h-4 w-4 text-muted-foreground" /> : <Checkbox checked={picked.has(p.apolloId)} onCheckedChange={() => toggle(p.apolloId)} />}
                <span className="min-w-0 flex-1 text-sm">
                  <span>{p.firstName} {p.lastName}<span className="ml-2 text-xs text-muted-foreground">{p.company}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.title, p.location].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-right text-[10px] text-muted-foreground" data-testid={`status-apollo-${p.apolloId}`}>
                  {inThis(p) ? <span className="font-medium text-amber-700">Already in this campaign</span>
                    : p.leadId ? <span className="text-amber-700">Added before{p.campaignName ? ` · moves from ${p.campaignName}` : ""}</span>
                    : p.hasEmail ? "email available" : "no email"}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            {result.totalPages > 1 && query ? (
              <span className="flex items-center gap-1 font-mono text-xs">
                <Button size="sm" variant="ghost" disabled={result.page <= 1 || search.isPending} onClick={() => run({ ...query, page: result.page - 1 })}>Prev</Button>
                {result.page}/{result.totalPages}
                <Button size="sm" variant="ghost" disabled={result.page >= result.totalPages || search.isPending} onClick={() => run({ ...query, page: result.page + 1 })}>Next</Button>
              </span>
            ) : <span />}
            <Button size="sm" disabled={!picked.size || busy} onClick={add} data-testid="button-apollo-add">
              {busy ? "Adding..." : `Add ${picked.size || ""} to this campaign`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
