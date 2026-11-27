import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type CalendarStatus,
  getGetCalendarQueryKey,
  getListCalcomEventTypesQueryKey,
  useDisconnectCalcom,
  useListCalcomEventTypes,
  useUpdateCalendar,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/components/bits";

const SELECT = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

/** Cal.com connection: one API key, then pick which meeting type the AI books. */
export function CalcomSection({ c }: { c: CalendarStatus }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const update = useUpdateCalendar();
  const disconnect = useDisconnectCalcom();
  const types = useListCalcomEventTypes({ query: { queryKey: getListCalcomEventTypesQueryKey(), enabled: !!c.calcomConnected, retry: false } });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    qc.invalidateQueries({ queryKey: getListCalcomEventTypesQueryKey() });
  };

  const save = (data: { calcomApiKey?: string; calcomEventTypeId?: number; calcomEventLength?: number }, done: string) =>
    update.mutate({ data }, {
      onSuccess: () => { refresh(); setKey(""); toast({ title: done }); },
      onError: (e) => toast({ title: "Cal.com not connected", description: errMsg(e), variant: "destructive" }),
    });

  if (!c.calcomConnected) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3" data-testid="calcom-setup">
        <div className="flex items-center justify-between"><b>Cal.com</b><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Easiest</span></div>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Sign up free at <a className="underline" href="https://cal.com/signup" target="_blank" rel="noreferrer">cal.com</a> and connect your Google or Outlook calendar there.</li>
          <li>Open <a className="underline" href="https://app.cal.com/settings/developer/api-keys" target="_blank" rel="noreferrer">Settings → Developer → API Keys</a>, create a key and paste it here.</li>
        </ol>
        <div className="flex gap-2">
          <Input type="password" placeholder="cal_live_..." value={key} onChange={(e) => setKey(e.target.value)} data-testid="input-calcom-key" />
          <Button disabled={!key.trim() || update.isPending} onClick={() => save({ calcomApiKey: key.trim() }, "Cal.com connected")} data-testid="button-connect-calcom">
            {update.isPending ? "Checking..." : "Connect"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="calcom-connected">
      <div className="flex items-center justify-between">
        <span>Booking on <b>Cal.com</b></span>
        <Button size="sm" variant="outline" disabled={disconnect.isPending} data-testid="button-disconnect-calcom"
          onClick={() => disconnect.mutate(undefined, { onSuccess: () => { refresh(); toast({ title: "Cal.com disconnected" }); } })}>Disconnect</Button>
      </div>
      <div>
        <Label className="text-xs">Meeting type the AI books</Label>
        <select className={SELECT} value={c.calcomEventTypeId ?? ""} disabled={!types.data?.length || update.isPending} data-testid="select-calcom-event-type"
          onChange={(e) => {
            const t = types.data?.find((x) => x.id === Number(e.target.value));
            if (t) save({ calcomEventTypeId: t.id, calcomEventLength: t.length }, `AI now books "${t.title}"`);
          }}>
          {!types.data?.length && <option value="">{types.isLoading ? "Loading..." : types.isError ? "Could not load meeting types" : "No meeting types yet"}</option>}
          {types.data?.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.length} min)</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Free times and the video link come from your Cal.com availability for this meeting type.</p>
      </div>
    </div>
  );
}
