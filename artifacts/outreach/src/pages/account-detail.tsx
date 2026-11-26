import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ChevronLeft, Globe, KanbanSquare, Linkedin, Phone, Plus, Trash2, Users, X } from "lucide-react";
import { useDeleteAccount, useGetAccount, useListLeads, useUpdateAccount, useUpdateLead } from "@workspace/api-client-react";
import type { AccountType, AccountUpdate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ErrorBox, Empty, Pill, Initials, errMsg, useRefreshAll } from "@/components/bits";
import { Timeline } from "@/components/timeline";
import { NotesPanel } from "@/components/crm/notes-panel";
import { DealDialog } from "@/components/crm/deal-dialog";
import { ACCOUNT_TYPES, isClosedStage, shortDate, useMoney } from "@/components/crm/format";
import { StageBadge } from "@/pages/pipeline";

const FIELDS = [["website", "Website"], ["industry", "Industry"], ["size", "Employees"], ["location", "Location"], ["phone", "Phone"], ["linkedinUrl", "LinkedIn"], ["ownerName", "Owner"]] as const;
type Key = (typeof FIELDS)[number][0] | "name" | "description" | "annualRevenue";

const href = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

export default function AccountDetail() {
  const id = Number(useParams().id);
  const q = useGetAccount(id);
  const upd = useUpdateAccount();
  const del = useDeleteAccount();
  const updLead = useUpdateLead();
  const leads = useListLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const { currency, money } = useMoney();
  const [f, setF] = useState<Record<Key, string> | null>(null);
  const [newDeal, setNewDeal] = useState(false);
  const [addContact, setAddContact] = useState("");
  const [confirm, setConfirm] = useState(false);
  const a = q.data;

  useEffect(() => {
    if (!a) return;
    setF({ name: a.name, description: a.description ?? "", annualRevenue: a.annualRevenue != null ? String(a.annualRevenue) : "",
      ...(Object.fromEntries(FIELDS.map(([k]) => [k, a[k] ?? ""])) as Record<(typeof FIELDS)[number][0], string>) });
  }, [a]);

  if (q.isLoading || (a && !f)) return <div className="p-8"><Rows n={5} h={80} /></div>;
  if (q.isError || !a || !f) return <ErrorBox onRetry={() => q.refetch()} />;

  const save = (data: AccountUpdate, msg = "Account saved") =>
    upd.mutate({ id, data }, { onSuccess: () => { refresh(); toast({ title: msg }); }, onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }) });
  const dirty = f.name !== a.name || f.description !== (a.description ?? "") || f.annualRevenue !== (a.annualRevenue != null ? String(a.annualRevenue) : "") || FIELDS.some(([k]) => f[k] !== (a[k] ?? ""));
  const saveForm = () =>
    save({
      name: f.name.trim() || a.name,
      description: f.description || null,
      annualRevenue: f.annualRevenue ? Math.round(Number(f.annualRevenue)) : null,
      ...Object.fromEntries(FIELDS.map(([k]) => [k, f[k] || null])),
    });
  const link = (leadId: number, accountId: number | null) =>
    updLead.mutate({ id: leadId, data: { accountId } }, { onSuccess: () => { setAddContact(""); refresh(); } });
  const unlinked = (leads.data ?? []).filter((l) => l.accountId !== id);
  const openDeals = a.deals.filter((d) => !isClosedStage(d.stage));

  return (
    <div className="p-6 md:p-8">
      <Link href="/accounts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-accounts"><ChevronLeft className="h-3 w-3" />Accounts</Link>
      <div className="rise mt-3 flex flex-wrap items-center gap-4 border-b border-border pb-5">
        <Initials name={a.name} className="h-14 w-14 rounded-xl text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold" data-testid="text-account-name">{a.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {a.website && <a href={href(a.website)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><Globe className="h-3.5 w-3.5" />{a.website}</a>}
            {a.phone && <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="h-3.5 w-3.5" />{a.phone}</a>}
            {a.linkedinUrl && <a href={href(a.linkedinUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><Linkedin className="h-3.5 w-3.5" />LinkedIn</a>}
            {[a.industry, a.location].filter(Boolean).join(" · ")}
          </div>
        </div>
        <select className="h-9 rounded-md border border-input bg-card px-2 text-sm capitalize" value={a.type} data-testid="select-account-type"
          onChange={(e) => save({ type: e.target.value as AccountType }, `Marked ${e.target.value}`)}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button onClick={() => setNewDeal(true)} data-testid="button-account-new-deal"><Plus className="mr-1 h-4 w-4" />New deal</Button>
        <Button variant="outline" size="icon" onClick={() => setConfirm(true)} data-testid="button-delete-account"><Trash2 className="h-4 w-4" /></Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[["Open pipeline", money(a.pipelineValue)], ["Won revenue", money(a.wonValue)], ["Open deals", String(a.openDealCount)], ["Contacts", String(a.contactCount)]].map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{k}</div><div className="font-display text-xl font-bold">{v}</div></div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel title="Details">
          <div className="grid gap-3 p-4">
            <div><Label className="text-xs">Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-edit-account-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(([k, l]) => (
                <div key={k} className={k === "linkedinUrl" || k === "website" ? "col-span-2" : ""}><Label className="text-xs">{l}</Label>
                  <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-edit-account-${k}`} /></div>
              ))}
              <div className="col-span-2"><Label className="text-xs">Annual revenue ({currency})</Label>
                <Input type="number" min={0} value={f.annualRevenue} onChange={(e) => setF({ ...f, annualRevenue: e.target.value })} data-testid="input-edit-account-revenue" /></div>
            </div>
            <div><Label className="text-xs">Description</Label><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="input-edit-account-description" /></div>
            <Button disabled={!dirty || upd.isPending} onClick={saveForm} data-testid="button-save-account-details">{upd.isPending ? "Saving..." : "Save changes"}</Button>
          </div>
        </Panel>
        <div className="min-w-0 space-y-5">
          <Panel title={`Deals · ${openDeals.length} open`} delay={40} action={<button className="text-xs text-primary hover:underline" onClick={() => setNewDeal(true)}>+ Deal</button>}>
            {!a.deals.length ? <div className="p-4"><Empty icon={KanbanSquare} title="No deals" body="Open a deal to track revenue from this account." /></div> : (
              <div className="divide-y divide-border">{a.deals.map((d) => (
                <Link key={d.id} href={`/deals/${d.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40" data-testid={`link-account-deal-${d.id}`}>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                  <StageBadge stage={d.stage} /><span className="w-28 text-right font-mono text-sm">{money(d.amount)}</span>
                  <span className="w-28 text-right text-xs text-muted-foreground">{shortDate(d.closeDate)}</span>
                </Link>))}</div>
            )}
          </Panel>
          <Panel title={`Contacts · ${a.contacts.length}`} delay={80}>
            <div className="flex gap-2 border-b border-border p-3">
              <select className="h-9 flex-1 rounded-md border border-input bg-card px-2 text-sm" value={addContact} onChange={(e) => setAddContact(e.target.value)} data-testid="select-add-contact">
                <option value="">Add an existing lead as a contact...</option>
                {unlinked.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}{l.company ? ` (${l.company})` : ""}</option>)}
              </select>
              <Button disabled={!addContact || updLead.isPending} onClick={() => link(Number(addContact), id)} data-testid="button-add-contact">Add</Button>
            </div>
            {!a.contacts.length ? <div className="p-4"><Empty icon={Users} title="No contacts" body="Link the people you talk to at this company." /></div> : (
              <div className="divide-y divide-border">{a.contacts.map((l) => (
                <div key={l.id} className="group flex items-center gap-3 px-4 py-2.5" data-testid={`row-contact-${l.id}`}>
                  <Initials name={`${l.firstName} ${l.lastName}`} className="h-7 w-7 rounded-md text-[10px]" />
                  <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 hover:text-primary"><div className="truncate text-sm font-medium">{l.firstName} {l.lastName}</div><div className="truncate text-xs text-muted-foreground">{l.title ?? l.email ?? ""}</div></Link>
                  <Pill value={l.status} />
                  <Button size="icon" variant="ghost" className="h-7 w-7 md:opacity-0 md:group-hover:opacity-100" title="Remove from account" onClick={() => link(l.id, null)} data-testid={`button-unlink-contact-${l.id}`}><X className="h-3.5 w-3.5" /></Button>
                </div>))}</div>
            )}
          </Panel>
          <NotesPanel notes={a.notes} accountId={id} delay={120} />
          <Panel title="Activity" delay={160}><Timeline activity={a.activity} showLead /></Panel>
        </div>
      </div>

      {newDeal && <DealDialog open onClose={() => setNewDeal(false)} accountId={id} />}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {a.name}?</AlertDialogTitle><AlertDialogDescription>Removes the account and its notes. Its contacts and deals stay, just without an account.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-account" onClick={() => del.mutate({ id }, { onSuccess: () => { refresh(); nav("/accounts"); toast({ title: "Account deleted" }); } })}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
