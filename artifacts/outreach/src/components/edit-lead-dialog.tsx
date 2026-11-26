import { useState } from "react";
import { useListCampaigns, useUpdateLead } from "@workspace/api-client-react";
import type { Lead, LeadStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errMsg, label, useRefreshAll } from "@/components/bits";

const FIELDS = [
  ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"],
  ["company", "Company"], ["title", "Title"], ["linkedinUrl", "LinkedIn URL"], ["website", "Website"], ["industry", "Industry"],
] as const;
type Key = (typeof FIELDS)[number][0];
const STATUSES: LeadStatus[] = ["new", "contacted", "replied", "interested", "meeting_booked", "not_interested", "unsubscribed"];
const sel = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm capitalize";

export function EditLeadDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const upd = useUpdateLead();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, (lead[k] as string | null | undefined) ?? ""])) as Record<Key, string>);
  const camps = useListCampaigns();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [campaignId, setCampaignId] = useState(lead.campaignId ? String(lead.campaignId) : "");
  const [notes, setNotes] = useState(lead.notes ?? "");
  const save = () => upd.mutate({ id: lead.id, data: { ...f, status, notes, campaignId: campaignId ? Number(campaignId) : null } }, {
    onSuccess: () => { refresh(); toast({ title: "Lead updated" }); onClose(); },
    onError: (e) => toast({ title: "Could not update lead", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">Edit lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([k, l]) => (
            <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label>
              <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-edit-${k}`} /></div>
          ))}
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} data-testid="select-edit-status">
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select></div>
          <div className="space-y-1"><Label className="text-xs">Campaign</Label>
            <select className={sel} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} data-testid="select-edit-campaign">
              <option value="">No campaign</option>{camps.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-edit-notes" /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.firstName.trim() || upd.isPending} data-testid="button-save-edit-lead">{upd.isPending ? "Saving..." : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
