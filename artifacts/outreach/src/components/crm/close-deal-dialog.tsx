import { useState } from "react";
import { Trophy, XCircle } from "lucide-react";
import { useUpdateDeal } from "@workspace/api-client-react";
import type { Deal } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errMsg, useRefreshAll } from "@/components/bits";
import { useMoney } from "./format";

const LOST_REASONS = ["Price", "Lost to competitor", "No budget", "Bad timing", "Went silent", "Not a fit"];

/** Confirms closing a deal: won keeps (or corrects) the final amount, lost asks for a reason. */
export function CloseDealDialog({ deal, outcome, onClose }: { deal: Deal | null; outcome: "closed_won" | "closed_lost"; onClose: () => void }) {
  const upd = useUpdateDeal();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const { currency, money } = useMoney();
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  if (!deal) return null;
  const won = outcome === "closed_won";
  const submit = () =>
    upd.mutate(
      { id: deal.id, data: won ? { stage: outcome, amount: amount !== null ? Math.round(Number(amount)) : undefined } : { stage: outcome, lostReason: reason || null } },
      {
        onSuccess: (d) => { refresh(); toast({ title: won ? `Won ${money(d.amount)}` : "Deal marked lost" }); setReason(""); setAmount(null); onClose(); },
        onError: (e) => toast({ title: "Could not update deal", description: errMsg(e), variant: "destructive" }),
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            {won ? <Trophy className="h-5 w-5 text-[hsl(var(--ch-linkedin))]" /> : <XCircle className="h-5 w-5 text-destructive" />}
            {won ? "Close as won" : "Close as lost"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{deal.name}{deal.accountName ? ` · ${deal.accountName}` : ""}</p>
        {won ? (
          <div><Label className="text-xs">Final amount ({currency})</Label>
            <Input type="number" min={0} value={amount ?? String(deal.amount)} onChange={(e) => setAmount(e.target.value)} data-testid="input-won-amount" /></div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">Why was it lost?</Label>
            <div className="flex flex-wrap gap-1.5">
              {LOST_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} data-testid={`button-lost-${r.split(" ")[0]!.toLowerCase()}`}
                  className={`rounded-full border px-3 py-1 text-xs ${reason === r ? "border-destructive bg-destructive text-destructive-foreground" : "border-border hover:border-foreground"}`}>{r}</button>
              ))}
            </div>
            <Input placeholder="Or type a reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-lost-reason" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={won ? "default" : "destructive"} disabled={upd.isPending} onClick={submit} data-testid="button-confirm-close">{upd.isPending ? "Saving..." : won ? "Mark won" : "Mark lost"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
