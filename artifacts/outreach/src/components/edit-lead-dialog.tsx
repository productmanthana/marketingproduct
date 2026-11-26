import { useState } from "react";
import { useUpdateLead } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errMsg, useRefreshAll } from "@/components/bits";

const FIELDS = [
  ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"],
  ["company", "Company"], ["title", "Title"], ["linkedinUrl", "LinkedIn URL"], ["website", "Website"], ["industry", "Industry"],
] as const;
type Key = (typeof FIELDS)[number][0];

export function EditLeadDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const upd = useUpdateLead();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState<Record<Key, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, (lead[k] as string | null | undefined) ?? ""])) as Record<Key, string>);
  const save = () => upd.mutate({ id: lead.id, data: f }, {
    onSuccess: () => { refresh(); toast({ title: "Lead updated" }); onClose(); },
    onError: (e) => toast({ title: "Could not update lead", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display text-xl">Edit lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(([k, l]) => (
            <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label>
              <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`input-edit-${k}`} /></div>
          ))}
        </div>
        <DialogFooter><Button onClick={save} disabled={!f.firstName.trim() || upd.isPending} data-testid="button-save-edit-lead">{upd.isPending ? "Saving..." : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
