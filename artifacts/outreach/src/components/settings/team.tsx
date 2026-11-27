import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListTeamQueryKey,
  useCreateTeamMember,
  useDeleteTeamMember,
  useListTeam,
  useUpdateTeamMember,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Initials, Panel, Rows, errMsg, useRefreshAll } from "@/components/bits";

const SELECT = "h-8 rounded-md border border-input bg-card px-2 text-xs";

/** Team members. Leads are assigned to an owner; "Viewing as" in the sidebar shows one person's leads and inbox. */
export function TeamPanel({ delay }: { delay?: number }) {
  const q = useListTeam();
  const qc = useQueryClient();
  const refreshAll = useRefreshAll();
  const { toast } = useToast();
  const create = useCreateTeamMember();
  const update = useUpdateTeamMember();
  const del = useDeleteTeamMember();
  const [f, setF] = useState({ name: "", email: "", role: "member" as "admin" | "member" });
  const refresh = () => qc.invalidateQueries({ queryKey: getListTeamQueryKey() });

  return (
    <Panel title="Team" delay={delay}>
      <p className="p-4 pb-2 text-sm text-muted-foreground">Add the people who work leads. Assign leads to an owner from the Leads page, then pick a person under “Viewing as” in the sidebar to see just their leads and inbox.</p>
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        <Input className="h-8 w-36 flex-1 text-sm" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-team-name" />
        <Input className="h-8 w-44 flex-1 text-sm" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="input-team-email" />
        <select className={SELECT} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "member" })} data-testid="select-team-role">
          <option value="member">Member</option><option value="admin">Admin</option>
        </select>
        <Button size="sm" disabled={!f.name.trim() || !/.+@.+\..+/.test(f.email) || create.isPending} data-testid="button-add-team-member"
          onClick={() => create.mutate({ data: f }, {
            onSuccess: () => { refresh(); setF({ name: "", email: "", role: "member" }); toast({ title: "Team member added" }); },
            onError: (e) => toast({ title: "Could not add", description: errMsg(e), variant: "destructive" }),
          })}><UserPlus className="mr-1 h-3.5 w-3.5" />Add</Button>
      </div>
      {q.isLoading ? <Rows n={2} h={40} /> : !!q.data?.length && (
        <div className="divide-y divide-border border-t border-border">{q.data.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid={`row-team-${m.id}`}>
            <Initials name={m.name} className="h-7 w-7" />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.name}</div><div className="truncate text-xs text-muted-foreground">{m.email} · {m.leadCount} leads</div></div>
            <select className={SELECT} value={m.role} onChange={(e) => update.mutate({ id: m.id, data: { role: e.target.value as "admin" | "member" } }, { onSuccess: refresh })} data-testid={`select-role-${m.id}`}>
              <option value="member">Member</option><option value="admin">Admin</option>
            </select>
            <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" aria-label={`Remove ${m.name}`} data-testid={`button-delete-team-${m.id}`}
              onClick={() => del.mutate({ id: m.id }, { onSuccess: () => { refreshAll(); toast({ title: `${m.name} removed`, description: "Their leads are now unassigned." }); } })}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}</div>
      )}
    </Panel>
  );
}
