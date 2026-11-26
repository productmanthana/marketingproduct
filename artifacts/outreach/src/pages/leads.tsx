import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { Plus, Search, Sparkles, Upload, Users } from "lucide-react";
import { useListLeads, useListCampaigns, useCreateLead, useImportLeads, useQualifyLeads } from "@workspace/api-client-react";
import type { LeadInput, LeadStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Rows, ErrorBox, Empty, Pill, Initials, AiWorking, ago, label, errMsg, useRefreshAll } from "@/components/bits";
import { FitBadge } from "@/components/fit-badge";

const STATUSES = ["new", "contacted", "replied", "interested", "meeting_booked", "not_interested", "unsubscribed"];
const sel = "h-9 rounded-md border border-input bg-card px-2 text-sm capitalize";

export default function Leads() {
  const params = new URLSearchParams(useSearch());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [campaignId, setCampaignId] = useState("");
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);
  const q = useListLeads({ search: search || undefined, status: (status || undefined) as LeadStatus | undefined, campaignId: campaignId ? Number(campaignId) : undefined });
  const camps = useListCampaigns();
  const qualify = useQualifyLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const unscored = q.data?.filter((l) => l.fitScore == null).length ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Database" title="Leads">
        <Button variant="outline" disabled={qualify.isPending || !q.data?.length} data-testid="button-qualify-leads"
          onClick={() => qualify.mutate({ data: unscored ? {} : { leadIds: q.data!.map((l) => l.id) } }, {
            onSuccess: (r) => { refresh(); toast({ title: `Scored ${r.qualified} leads` }); },
            onError: (e) => toast({ title: "Could not score leads", description: errMsg(e), variant: "destructive" }),
          })}>
          <Sparkles className="mr-1 h-4 w-4 text-primary" />{qualify.isPending ? "Scoring..." : unscored ? `Score ${unscored} with AI` : "Rescore all"}
        </Button>
        <Button variant="outline" onClick={() => setImp(true)} data-testid="button-import-leads"><Upload className="mr-1 h-4 w-4" />Import CSV</Button>
        <Button onClick={() => setAdd(true)} data-testid="button-add-lead"><Plus className="mr-1 h-4 w-4" />Add lead</Button>
      </PageHeader>
      <div className="space-y-4 p-6 md:p-8">
        {qualify.isPending && <AiWorking text="Scoring each lead against your ideal customer profile" />}
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, company, email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-lead-search" /></div>
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-lead-status">
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select className={sel} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid="select-lead-campaign">
            <option value="">All campaigns</option>{camps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          {q.isLoading ? <Rows n={8} h={40} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <Empty icon={Users} title={search || status || campaignId ? "No matches" : "No leads yet"} body="Add a lead by hand or paste a CSV to import hundreds at once.">
              <Button size="sm" onClick={() => setImp(true)} data-testid="button-empty-import">Import CSV</Button>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2 font-normal">Lead</th><th className="px-3 font-normal">Company</th><th className="px-3 font-normal">Fit</th><th className="px-3 font-normal">Campaign</th><th className="px-3 font-normal">Step</th><th className="px-3 font-normal">Last touch</th><th className="px-4 text-right font-normal">Status</th>
                </tr></thead>
                <tbody>
                  {q.data.map((l, i) => (
                    <tr key={l.id} className="rise border-b border-border last:border-0 hover:bg-muted/40" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }} data-testid={`row-lead-${l.id}`}>
                      <td className="px-4 py-2"><Link href={`/leads/${l.id}`} className="flex items-center gap-2.5" data-testid={`link-lead-${l.id}`}><Initials name={`${l.firstName} ${l.lastName}`} className="h-7 w-7 text-[10px]" />
                        <span><span className="block font-medium hover:text-primary">{l.firstName} {l.lastName}</span><span className="block text-xs text-muted-foreground">{l.email ?? l.title}</span></span></Link></td>
                      <td className="px-3"><div>{l.company ?? "-"}</div><div className="text-xs text-muted-foreground">{l.title}</div></td>
                      <td className="px-3"><FitBadge score={l.fitScore} reason={l.fitReason} /></td>
                      <td className="px-3 text-xs">{l.campaignId ? <Link href={`/campaigns/${l.campaignId}`} className="hover:text-primary">{l.campaignName}</Link> : <span className="text-muted-foreground">unassigned</span>}</td>
                      <td className="px-3 font-mono text-xs">{l.currentStep ?? 0}</td>
                      <td className="px-3 font-mono text-xs text-muted-foreground">{ago(l.lastContactedAt)}</td>
                      <td className="px-4 text-right"><Pill value={l.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {add && <AddLead onClose={() => setAdd(false)} campaigns={camps.data ?? []} />}
      {imp && <ImportLeads onClose={() => setImp(false)} campaigns={camps.data ?? []} />}
    </div>
  );
}

type C = { id: number; name: string };
const FIELDS = ["firstName", "lastName", "email", "phone", "linkedinUrl", "company", "title", "industry", "website"] as const;

function AddLead({ onClose, campaigns }: { onClose: () => void; campaigns: C[] }) {
  const create = useCreateLead();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const submit = () => {
    const data: LeadInput = { firstName: f.firstName ?? "", lastName: f.lastName ?? "" };
    FIELDS.slice(2).forEach((k) => { if (f[k]) (data as unknown as Record<string, unknown>)[k] = f[k]; });
    if (f.notes) data.notes = f.notes;
    if (f.campaignId) data.campaignId = Number(f.campaignId);
    create.mutate({ data }, { onSuccess: () => { refresh(); toast({ title: "Lead added" }); onClose(); }, onError: () => toast({ title: "Could not add lead", variant: "destructive" }) });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">Add lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2.5">
          {FIELDS.map((k) => <div key={k} className={k === "linkedinUrl" ? "col-span-2" : ""}><Label className="text-xs capitalize">{k.replace(/([A-Z])/g, " $1")}</Label><Input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-lead-${k}`} /></div>)}
          <div className="col-span-2"><Label className="text-xs">Campaign</Label>
            <select className={`${sel} w-full`} value={f.campaignId ?? ""} onChange={(e) => setF({ ...f, campaignId: e.target.value })} data-testid="select-new-lead-campaign">
              <option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="input-lead-notes" /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={!f.firstName?.trim() || create.isPending} data-testid="button-save-lead">{create.isPending ? "Adding..." : "Add lead"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseCsv(text: string): LeadInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
  let header: string[] = [...FIELDS];
  const first = split(lines[0]).map((h) => h.toLowerCase());
  let rows = lines;
  if (first.includes("firstname") || first.includes("email")) {
    header = first.map((h) => FIELDS.find((f) => f.toLowerCase() === h) ?? h);
    rows = lines.slice(1);
  }
  return rows.map((l) => {
    const cells = split(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => { if (cells[i] && (FIELDS as readonly string[]).includes(h)) o[h] = cells[i]; });
    return { ...o, firstName: o.firstName ?? "", lastName: o.lastName ?? "" } as LeadInput;
  }).filter((l) => l.firstName);
}

function ImportLeads({ onClose, campaigns }: { onClose: () => void; campaigns: C[] }) {
  const [text, setText] = useState("");
  const [cid, setCid] = useState("");
  const imp = useImportLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const parsed = useMemo(() => parseCsv(text), [text]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">Import leads from CSV</DialogTitle></DialogHeader>
        <p className="font-mono text-[11px] text-muted-foreground">firstName,lastName,email,phone,linkedinUrl,company,title,industry,website</p>
        <Textarea rows={8} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"firstName,lastName,email,phone,linkedinUrl,company,title,industry\nMarta,Okafor,marta@lumenfreight.io,+14155550142,,Lumen Freight,VP Ops,Logistics"} data-testid="input-csv" />
        {!!parsed.length && (
          <div className="max-h-40 overflow-auto rounded-lg border border-border text-xs">
            {parsed.slice(0, 8).map((l, i) => <div key={i} className="grid grid-cols-3 gap-2 border-b border-border px-3 py-1.5 last:border-0"><b>{l.firstName} {l.lastName}</b><span>{l.email}</span><span className="text-muted-foreground">{l.company}</span></div>)}
            {parsed.length > 8 && <div className="px-3 py-1.5 text-muted-foreground">+ {parsed.length - 8} more</div>}
          </div>
        )}
        <div className="flex items-center gap-2"><Label className="text-xs">Enroll into</Label>
          <select className={sel} value={cid} onChange={(e) => setCid(e.target.value)} data-testid="select-import-campaign">
            <option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <DialogFooter>
          <Button disabled={!parsed.length || imp.isPending} data-testid="button-confirm-import"
            onClick={() => imp.mutate({ data: { leads: parsed, campaignId: cid ? Number(cid) : undefined } }, {
              onSuccess: (r) => { refresh(); toast({ title: `Imported ${r.imported} leads`, description: r.skipped ? `${r.skipped} skipped as duplicates or invalid` : undefined }); onClose(); },
              onError: () => toast({ title: "Import failed", variant: "destructive" }),
            })}>
            {imp.isPending ? "Importing..." : `Import ${parsed.length} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
