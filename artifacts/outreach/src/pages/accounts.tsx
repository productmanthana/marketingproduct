import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Building2, Plus, Search, Wand2 } from "lucide-react";
import { useCreateAccount, useCreateAccountsFromLeads, useListAccounts } from "@workspace/api-client-react";
import type { AccountType } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PageHeader, Rows, ErrorBox, Empty, Pill, Initials, errMsg, useRefreshAll } from "@/components/bits";
import { ACCOUNT_TYPES, useMoney } from "@/components/crm/format";

export default function Accounts() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<AccountType | "">("");
  const [creating, setCreating] = useState(false);
  const q = useListAccounts({ ...(search ? { search } : {}), ...(type ? { type } : {}) });
  const fromLeads = useCreateAccountsFromLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const { money } = useMoney();
  const autoCreate = () =>
    fromLeads.mutate(undefined, {
      onSuccess: (r) => { refresh(); toast({ title: r.linked ? `Linked ${r.linked} leads` : "Every lead with a company is already linked", description: r.created ? `${r.created} new accounts created from company names` : undefined }); },
      onError: (e) => toast({ title: "Could not create accounts", description: errMsg(e), variant: "destructive" }),
    });

  return (
    <div>
      <PageHeader eyebrow="CRM · Companies" title="Accounts">
        <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-accounts" /></div>
        <Button variant="outline" disabled={fromLeads.isPending} onClick={autoCreate} data-testid="button-accounts-from-leads"><Wand2 className="mr-1 h-4 w-4" />{fromLeads.isPending ? "Linking..." : "Create from leads"}</Button>
        <Button onClick={() => setCreating(true)} data-testid="button-new-account"><Plus className="mr-1 h-4 w-4" />New account</Button>
      </PageHeader>
      <div className="p-6 md:p-8">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(["", ...ACCOUNT_TYPES] as const).map((t) => (
            <button key={t || "all"} onClick={() => setType(t)} data-testid={`filter-account-${t || "all"}`}
              className={cn("rounded-full border px-3 py-1 text-xs capitalize", type === t ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground")}>{t || "All"}</button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          {q.isLoading ? <Rows n={5} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <div className="p-4"><Empty icon={Building2} title={search || type ? "No matching accounts" : "No accounts yet"} body="Add companies by hand, or create them from the company names on your leads.">
              {!search && !type && <Button variant="outline" onClick={autoCreate} disabled={fromLeads.isPending}><Wand2 className="mr-1 h-4 w-4" />Create from leads</Button>}</Empty></div>
          ) : (
            <table className="w-full text-sm" data-testid="table-accounts">
              <thead className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>{["Account", "Type", "Industry", "Location", "Contacts", "Open deals", "Pipeline", "Won"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/40" data-testid={`row-account-${a.id}`}>
                    <td className="px-4 py-2.5"><Link href={`/accounts/${a.id}`} className="flex items-center gap-2.5 font-medium hover:text-primary"><Initials name={a.name} className="h-7 w-7 rounded-md text-[10px]" />{a.name}</Link></td>
                    <td className="px-4 py-2.5"><Pill value={a.type} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.industry ?? "-"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.location ?? "-"}</td>
                    <td className="px-4 py-2.5 font-mono">{a.contactCount}</td>
                    <td className="px-4 py-2.5 font-mono">{a.openDealCount}</td>
                    <td className="px-4 py-2.5 font-mono">{money(a.pipelineValue)}</td>
                    <td className="px-4 py-2.5 font-mono">{money(a.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {creating && <AccountDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateAccount();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const [f, setF] = useState({ name: "", website: "", industry: "", location: "", phone: "", type: "prospect" as AccountType });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = () =>
    create.mutate({ data: Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as typeof f }, {
      onSuccess: (a) => { refresh(); onClose(); nav(`/accounts/${a.id}`); },
      onError: (e) => toast({ title: "Could not create account", description: errMsg(e), variant: "destructive" }),
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">New account</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-xs">Company name</Label><Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="input-account-name" /></div>
          <div><Label className="text-xs">Website</Label><Input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="acme.com" data-testid="input-account-website" /></div>
          <div><Label className="text-xs">Industry</Label><Input value={f.industry} onChange={(e) => set("industry", e.target.value)} data-testid="input-account-industry" /></div>
          <div><Label className="text-xs">Location</Label><Input value={f.location} onChange={(e) => set("location", e.target.value)} data-testid="input-account-location" /></div>
          <div><Label className="text-xs">Phone</Label><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-account-phone" /></div>
          <div className="col-span-2"><Label className="text-xs">Type</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">{ACCOUNT_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => set("type", t)} className={cn("rounded-full border px-3 py-1 text-xs capitalize", f.type === t ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{t}</button>))}</div></div>
        </div>
        <DialogFooter><Button disabled={!f.name.trim() || create.isPending} onClick={submit} data-testid="button-save-account">{create.isPending ? "Creating..." : "Create account"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
