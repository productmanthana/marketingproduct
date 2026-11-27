import { useState } from "react";
import { useCreateLead, useEnrollLeads } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRefreshAll, errMsg } from "@/components/bits";

const FIELDS = [
  ["firstName", "First name *"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["company", "Company"],
  ["title", "Job title"],
  ["phone", "Phone (for calls)"],
  ["linkedinUrl", "LinkedIn profile URL"],
] as const;

type Form = Record<(typeof FIELDS)[number][0], string>;
const EMPTY = Object.fromEntries(FIELDS.map(([k]) => [k, ""])) as Form;

/** Type in a new person: saves them to your leads and adds them to this campaign in one go. */
export function QuickAddPerson({ campaignId, onDone }: { campaignId: number; onDone: () => void }) {
  const [f, setF] = useState<Form>(EMPTY);
  const create = useCreateLead();
  const enroll = useEnrollLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const busy = create.isPending || enroll.isPending;
  const fail = (e: unknown) => toast({ title: "Couldn't add this person", description: errMsg(e), variant: "destructive" });

  const save = () => {
    const data = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v || k === "lastName")) as Form;
    create.mutate({ data }, {
      onError: fail,
      onSuccess: (lead) => enroll.mutate({ id: campaignId, data: { leadIds: [lead.id] } }, {
        onError: fail,
        onSuccess: () => { refresh(); toast({ title: `${data.firstName} added to this campaign` }); setF(EMPTY); onDone(); },
      }),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3" data-testid="form-quick-add">
      <p className="text-xs text-muted-foreground">Add an email for emails, a LinkedIn URL for LinkedIn messages and a phone number for calls. Without an email or LinkedIn URL, those messages are skipped for this person.</p>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map(([k, label]) => (
          <Input key={k} placeholder={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
            className={k === "linkedinUrl" ? "col-span-2" : ""} data-testid={`input-quick-${k}`} />
        ))}
      </div>
      <div className="flex justify-end">
        <Button disabled={!f.firstName.trim() || busy} onClick={save} data-testid="button-quick-add">{busy ? "Adding..." : "Add to campaign"}</Button>
      </div>
    </div>
  );
}
