import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { MailCheck, Pencil, Plus, Radar, Search, Sparkles, Upload, Users } from "lucide-react";
import { useListLeads, useListCampaigns, useCreateLead, useQualifyLeads, useVerifyLeadEmails, useScanLeadSignals, useListTeam, useUpdateLead } from "@workspace/api-client-react";
import { useViewingAs } from "@/components/viewing-as";
import type { Lead, LeadInput, LeadStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Rows, ErrorBox, Empty, Pill, Initials, AiWorking, ago, label, errMsg, useRefreshAll } from "@/components/bits";
import { FitBadge } from "@/components/fit-badge";
import { EditLeadDialog } from "@/components/edit-lead-dialog";
import { SpreadsheetPicker, useImportInBatches } from "@/components/spreadsheet-upload";

const STATUSES = ["new", "contacted", "replied", "interested", "meeting_booked", "nurture", "not_interested", "unsubscribed", "bounced"];
const sel = "h-9 rounded-md border border-input bg-card px-2 text-sm capitalize";

export default function Leads() {
  const params = new URLSearchParams(useSearch());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [campaignId, setCampaignId] = useState("");
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [signalsOnly, setSignalsOnly] = useState(false);
  const ownerId = useViewingAs();
  const q = useListLeads({ search: search || undefined, status: (status || undefined) as LeadStatus | undefined, campaignId: campaignId ? Number(campaignId) : undefined, ownerId, hasSignals: signalsOnly || undefined });
  const camps = useListCampaigns();
  const team = useListTeam();
  const qualify = useQualifyLeads();
  const verify = useVerifyLeadEmails();
  const scan = useScanLeadSignals();
  const updateLead = useUpdateLead();
  const [assigning, setAssigning] = useState(false);
  const ids = q.data?.map((l) => l.id) ?? [];
  const assignAll = async (owner: number | null) => {
    setAssigning(true);
    try {
      for (const id of ids) await updateLead.mutateAsync({ id, data: { ownerId: owner } });
      toast({ title: owner ? `${ids.length} leads assigned` : `${ids.length} leads unassigned` });
    } catch (e) {
      toast({ title: "Could not assign every lead", description: errMsg(e), variant: "destructive" });
    } finally {
      setAssigning(false);
      refresh();
    }
  };
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
        <Button variant="outline" disabled={verify.isPending || !q.data?.length} data-testid="button-verify-emails" title="Checks each address can receive mail (format, mail server, throwaway and role addresses)"
          onClick={() => verify.mutate({ data: { leadIds: ids } }, {
            onSuccess: (r) => { refresh(); toast({ title: `Checked ${r.checked} emails`, description: `${r.valid} valid · ${r.risky} risky · ${r.invalid} invalid${r.invalid ? " (email steps are skipped for these)" : ""}` }); },
            onError: (e) => toast({ title: "Could not check emails", description: errMsg(e), variant: "destructive" }),
          })}><MailCheck className="mr-1 h-4 w-4" />{verify.isPending ? "Checking..." : "Check emails"}</Button>
        <Button variant="outline" disabled={scan.isPending || !q.data?.length} data-testid="button-scan-signals" title="Reads each company's website (home, careers, news) for hiring, funding, launches and expansion"
          onClick={() => scan.mutate({ data: { leadIds: ids.slice(0, 50) } }, {
            onSuccess: (r) => { refresh(); toast({ title: `${r.withSignals} of ${r.scanned} companies show buying signals`, description: [ids.length > 50 ? "Scanned the first 50 shown." : "", r.skipped ? `${r.skipped} skipped (no website).` : ""].filter(Boolean).join(" ") || undefined }); },
            onError: (e) => toast({ title: "Could not scan", description: errMsg(e), variant: "destructive" }),
          })}><Radar className="mr-1 h-4 w-4 text-primary" />{scan.isPending ? "Scanning..." : "Find buying signals"}</Button>
        <Button variant="outline" onClick={() => setImp(true)} data-testid="button-import-leads"><Upload className="mr-1 h-4 w-4" />Import spreadsheet</Button>
        <Button onClick={() => setAdd(true)} data-testid="button-add-lead"><Plus className="mr-1 h-4 w-4" />Add lead</Button>
      </PageHeader>
      <div className="space-y-4 p-6 md:p-8">
        {qualify.isPending && <AiWorking text="Scoring each lead against your ideal customer profile" />}
        {scan.isPending && <AiWorking text="Reading company websites for hiring, funding, launches and expansion" />}
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, company, email" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-lead-search" /></div>
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-lead-status">
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select className={sel} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid="select-lead-campaign">
            <option value="">All campaigns</option>{camps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm"><input type="checkbox" checked={signalsOnly} onChange={(e) => setSignalsOnly(e.target.checked)} data-testid="checkbox-signals-only" />With buying signals</label>
          {!!team.data?.length && !!ids.length && (
            <select className={`${sel} normal-case`} value="" disabled={assigning} onChange={(e) => e.target.value && assignAll(e.target.value === "none" ? null : Number(e.target.value))} data-testid="select-assign-owner">
              <option value="">{assigning ? "Assigning..." : `Assign these ${ids.length} to...`}</option>
              {team.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}<option value="none">Nobody (unassign)</option>
            </select>
          )}
        </div>
        {!!q.data?.length && <div className="text-xs text-muted-foreground" data-testid="text-lead-count">Showing all {q.data.length} leads</div>}
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          {q.isLoading ? <Rows n={8} h={40} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <Empty icon={Users} title={search || status || campaignId ? "No matches" : "No leads yet"} body="Add a lead by hand or upload an Excel/CSV file to import hundreds at once.">
              <Button size="sm" onClick={() => setImp(true)} data-testid="button-empty-import">Import spreadsheet</Button>
            </Empty>
          ) : (
            <div className="max-h-[60vh] overflow-auto" data-testid="leads-table-scroll">
              <table className="w-full min-w-[1500px] whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2 font-normal">Lead</th><th className="px-3 font-normal">Company</th><th className="px-3 font-normal">Email</th><th className="px-3 font-normal">Phone</th><th className="px-3 font-normal">LinkedIn</th><th className="px-3 font-normal">Industry</th><th className="px-3 font-normal">Website</th><th className="px-3 font-normal">Fit</th><th className="px-3 font-normal">Signals</th><th className="px-3 font-normal">Owner</th><th className="px-3 font-normal">Campaign</th><th className="px-3 font-normal">Step</th><th className="px-3 font-normal">Last touch</th><th className="px-4 text-right font-normal">Status</th><th className="w-10" />
                </tr></thead>
                <tbody>
                  {q.data.map((l, i) => (
                    <tr key={l.id} className="rise border-b border-border last:border-0 hover:bg-muted/40" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }} data-testid={`row-lead-${l.id}`}>
                      <td className="px-4 py-2"><Link href={`/leads/${l.id}`} className="flex items-center gap-2.5" data-testid={`link-lead-${l.id}`}><Initials name={`${l.firstName} ${l.lastName}`} className="h-7 w-7 text-[10px]" />
                        <span><span className="block font-medium hover:text-primary">{l.firstName} {l.lastName}</span><span className="block text-xs text-muted-foreground">{l.email ?? l.title}</span></span></Link></td>
                      <td className="px-3"><div>{l.company ?? "-"}</div><div className="text-xs text-muted-foreground">{l.title}</div></td>
                      <td className="px-3 text-xs">{l.email ? <span className="inline-flex items-center gap-1.5"><a href={`mailto:${l.email}`} className="hover:text-primary">{l.email}</a>{l.emailStatus && l.emailStatus !== "valid" && <Pill value={l.emailStatus} />}</span> : <Dash />}</td>
                      <td className="px-3 font-mono text-xs">{l.phone || <Dash />}</td>
                      <td className="px-3 text-xs">{l.linkedinUrl ? <a href={l.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Profile</a> : <Dash />}</td>
                      <td className="px-3 text-xs">{l.industry || <Dash />}</td>
                      <td className="max-w-[180px] truncate px-3 text-xs">{l.website ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer" className="hover:text-primary">{l.website.replace(/^https?:\/\//, "")}</a> : <Dash />}</td>
                      <td className="px-3"><FitBadge score={l.fitScore} reason={l.fitReason} /></td>
                      <td className="max-w-[220px] truncate px-3 text-xs" title={l.signals ?? undefined} data-testid={`text-signals-${l.id}`}>{l.signals ? <span className="inline-flex items-center gap-1"><Radar className="h-3 w-3 shrink-0 text-primary" />{l.signals.split("\n")[0]}</span> : <Dash />}</td>
                      <td className="px-3 text-xs">{l.ownerName ?? <Dash />}</td>
                      <td className="px-3 text-xs">{l.campaignId ? <Link href={`/campaigns/${l.campaignId}`} className="hover:text-primary">{l.campaignName}</Link> : <span className="text-muted-foreground">unassigned</span>}</td>
                      <td className="px-3 font-mono text-xs">{l.currentStep ?? 0}</td>
                      <td className="px-3 font-mono text-xs text-muted-foreground">{ago(l.lastContactedAt)}</td>
                      <td className="px-4 text-right"><Pill value={l.status} /></td>
                      <td className="pr-3"><Button size="icon" variant="ghost" className="h-7 w-7" title="Edit lead" onClick={() => setEditing(l)} data-testid={`button-edit-lead-${l.id}`}><Pencil className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {add && <AddLead onClose={() => setAdd(false)} campaigns={camps.data ?? []} />}
      {editing && <EditLeadDialog lead={editing} onClose={() => setEditing(null)} />}
      {imp && <ImportLeads onClose={() => setImp(false)} campaigns={camps.data ?? []} />}
    </div>
  );
}

const Dash = () => <span className="text-muted-foreground">-</span>;

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
  const imp = useImportInBatches();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [fileLeads, setFileLeads] = useState<LeadInput[]>([]);
  const pasted = useMemo(() => parseCsv(text), [text]);
  const parsed = fileLeads.length ? fileLeads : pasted;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">Import leads</DialogTitle></DialogHeader>
        <SpreadsheetPicker onParsed={setFileLeads} />
        {!fileLeads.length && <>
        <div className="text-xs font-medium text-muted-foreground">Or paste CSV text</div>
        <p className="font-mono text-[11px] text-muted-foreground">firstName,lastName,email,phone,linkedinUrl,company,title,industry,website</p>
        <Textarea rows={8} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"firstName,lastName,email,phone,linkedinUrl,company,title,industry\nMarta,Okafor,marta@lumenfreight.io,+14155550142,,Lumen Freight,VP Ops,Logistics"} data-testid="input-csv" />
        {!!pasted.length && (
          <div className="max-h-40 overflow-auto rounded-lg border border-border text-xs">
            {pasted.slice(0, 8).map((l, i) => <div key={i} className="grid grid-cols-3 gap-2 border-b border-border px-3 py-1.5 last:border-0"><b>{l.firstName} {l.lastName}</b><span>{l.email}</span><span className="text-muted-foreground">{l.company}</span></div>)}
            {pasted.length > 8 && <div className="px-3 py-1.5 text-muted-foreground">+ {pasted.length - 8} more</div>}
          </div>
        )}
        </>}
        <div className="flex items-center gap-2"><Label className="text-xs">Enroll into</Label>
          <select className={sel} value={cid} onChange={(e) => setCid(e.target.value)} data-testid="select-import-campaign">
            <option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <DialogFooter>
          <Button disabled={!parsed.length || imp.isPending} data-testid="button-confirm-import"
            onClick={() => imp.run(parsed, cid ? Number(cid) : undefined).then(
              (r) => { refresh(); toast({ title: `Imported ${r.imported} leads`, description: r.skipped ? `${r.skipped} skipped as duplicates or invalid` : undefined }); onClose(); },
              (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
            )}>
            {imp.isPending ? "Importing..." : `Import ${parsed.length} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
