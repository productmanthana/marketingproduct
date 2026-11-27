import { useState } from "react";
import { useLocation } from "wouter";
import { useConvertLead } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errMsg, useRefreshAll } from "@/components/bits";
import { fromDateInput, useMoney } from "./format";

/** Opens a deal for a lead; the server links or creates the account from the lead's company. */
export function ConvertLeadDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const convert = useConvertLead();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const { currency } = useMoney();
  const [name, setName] = useState(`${lead.company || `${lead.firstName} ${lead.lastName}`.trim()} - new deal`);
  const [amount, setAmount] = useState("");
  const [close, setClose] = useState(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const submit = () =>
    convert.mutate({ id: lead.id, data: { dealName: name, amount: amount ? Math.round(Number(amount)) : undefined, closeDate: fromDateInput(close) ?? undefined } }, {
      onSuccess: (d) => { refresh(); toast({ title: "Deal created", description: d.accountName ? `Linked to account ${d.accountName}` : undefined }); onClose(); nav(`/deals/${d.id}`); },
      onError: (e) => toast({ title: "Could not convert", description: errMsg(e), variant: "destructive" }),
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display text-xl">Convert to deal</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {lead.accountId ? `The deal goes under ${lead.accountName}.` : lead.company ? `An account for ${lead.company} is linked or created automatically.` : "This lead has no company, so the deal has no account yet."}
        </p>
        <div className="grid gap-3">
          <div><Label className="text-xs">Deal name</Label><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-convert-name" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Amount ({currency})</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" data-testid="input-convert-amount" /></div>
            <div><Label className="text-xs">Close date</Label><Input type="date" value={close} onChange={(e) => setClose(e.target.value)} data-testid="input-convert-close" /></div>
          </div>
        </div>
        <DialogFooter><Button disabled={!name.trim() || convert.isPending} onClick={submit} data-testid="button-confirm-convert">{convert.isPending ? "Converting..." : "Create deal"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
