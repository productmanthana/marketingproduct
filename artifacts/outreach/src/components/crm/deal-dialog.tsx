import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateDeal, useListAccounts, useListLeads } from "@workspace/api-client-react";
import type { DealStage } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errMsg, useRefreshAll } from "@/components/bits";
import { STAGES, fromDateInput, useMoney } from "./format";

const SELECT = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

export function DealDialog({ open, onClose, accountId, leadId, stage }: { open: boolean; onClose: () => void; accountId?: number; leadId?: number; stage?: DealStage }) {
  const { currency } = useMoney();
  const accounts = useListAccounts();
  const leads = useListLeads();
  const create = useCreateDeal();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ name: "", accountId: accountId ? String(accountId) : "", leadId: leadId ? String(leadId) : "", amount: "", stage: stage ?? ("prospecting" as DealStage), closeDate: in30, nextStep: "" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const contacts = (leads.data ?? []).filter((l) => !f.accountId || l.accountId === Number(f.accountId));
  const submit = () =>
    create.mutate(
      {
        data: {
          name: f.name,
          accountId: f.accountId ? Number(f.accountId) : undefined,
          leadId: f.leadId ? Number(f.leadId) : undefined,
          amount: f.amount ? Math.round(Number(f.amount)) : 0,
          stage: f.stage,
          closeDate: fromDateInput(f.closeDate) ?? undefined,
          nextStep: f.nextStep || undefined,
        },
      },
      {
        onSuccess: (d) => { refresh(); toast({ title: "Deal created" }); onClose(); nav(`/deals/${d.id}`); },
        onError: (e) => toast({ title: "Could not create deal", description: errMsg(e), variant: "destructive" }),
      },
    );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">New deal</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label className="text-xs">Deal name</Label>
            <Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme - annual plan" data-testid="input-deal-name" /></div>
          <div><Label className="text-xs">Account</Label>
            <select className={SELECT} value={f.accountId} onChange={(e) => setF((p) => ({ ...p, accountId: e.target.value, leadId: "" }))} data-testid="select-deal-account">
              <option value="">No account</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div><Label className="text-xs">Primary contact</Label>
            <select className={SELECT} value={f.leadId} onChange={(e) => set("leadId", e.target.value)} data-testid="select-deal-contact">
              <option value="">No contact</option>{contacts.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}{l.company ? ` (${l.company})` : ""}</option>)}
            </select></div>
          <div><Label className="text-xs">Amount ({currency})</Label>
            <Input type="number" min={0} value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" data-testid="input-deal-amount" /></div>
          <div><Label className="text-xs">Close date</Label>
            <Input type="date" value={f.closeDate} onChange={(e) => set("closeDate", e.target.value)} data-testid="input-deal-close" /></div>
          <div><Label className="text-xs">Stage</Label>
            <select className={SELECT} value={f.stage} onChange={(e) => set("stage", e.target.value)} data-testid="select-deal-stage">
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.prob}%)</option>)}
            </select></div>
          <div><Label className="text-xs">Next step</Label>
            <Input value={f.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="Send proposal" data-testid="input-deal-next" /></div>
        </div>
        <DialogFooter><Button disabled={!f.name.trim() || create.isPending} onClick={submit} data-testid="button-save-deal">{create.isPending ? "Creating..." : "Create deal"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
