import { useEffect, useState } from "react";
import { CalendarCheck, Copy } from "lucide-react";
import {
  useGetCalendar, getGetCalendarQueryKey, useUpdateCalendar, useConnectCalendar, useDisconnectCalendar,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Panel, errMsg } from "@/components/bits";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const SELECT = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

/** Google Calendar connection used by the AI to find free times and book meetings on its own. */
export function CalendarPanel({ delay }: { delay?: number }) {
  const q = useGetCalendar({ query: { queryKey: getGetCalendarQueryKey(), refetchOnWindowFocus: true } });
  const update = useUpdateCalendar();
  const connect = useConnectCalendar();
  const disconnect = useDisconnectCalendar();
  const { toast } = useToast();
  const [hours, setHours] = useState({ meetingStartHour: 10, meetingEndHour: 18, meetingMinutes: 20 });
  useEffect(() => {
    if (q.data) setHours({ meetingStartHour: q.data.meetingStartHour, meetingEndHour: q.data.meetingEndHour, meetingMinutes: q.data.meetingMinutes });
  }, [q.data]);
  const c = q.data;
  const redirect = `${window.location.origin}/api/calendar/google/callback`;

  const start = () =>
    connect.mutate({ data: { origin: window.location.origin } }, {
      onSuccess: (r) => window.open(r.url, "_blank", "noopener"),
      onError: (e) => toast({ title: "Could not start Google sign-in", description: errMsg(e), variant: "destructive" }),
    });

  return (
    <Panel title="Google Calendar auto-scheduling" delay={delay}
      action={<span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${c?.connected ? "bg-primary/10 text-primary" : "border border-dashed border-border text-muted-foreground"}`}>{c?.connected ? "Connected" : "Off"}</span>}>
      <div className="grid gap-3 p-4 text-sm">
        <div className="flex items-start gap-3 text-muted-foreground">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarCheck className="h-4 w-4" /></div>
          <p>When a prospect wants to meet, the AI checks your free times, books the slot they ask for (or offers free ones) and sends a Google Calendar invite with a Meet link. No booking link needed.</p>
        </div>

        {!c ? null : !c.configured ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="calendar-setup-steps">
            <b>One-time setup (about 5 minutes)</b>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Open <a className="underline" href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Cloud Console</a> and enable the <b>Google Calendar API</b>.</li>
              <li>Go to <b>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</b>, type <b>Web application</b>.</li>
              <li>Under <b>Authorized redirect URIs</b> add this address:
                <div className="mt-1 flex items-center gap-1.5"><code className="break-all rounded bg-card px-1.5 py-0.5">{redirect}</code>
                  <button className="text-amber-700" onClick={() => { navigator.clipboard.writeText(redirect); toast({ title: "Copied" }); }} aria-label="Copy redirect URI"><Copy className="h-3.5 w-3.5" /></button></div></li>
              <li>Add the Client ID and Client secret as the secrets <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b>, then come back here and press Connect.</li>
            </ol>
          </div>
        ) : c.connected ? (
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <span>Booking on <b data-testid="text-calendar-email">{c.email || "your Google Calendar"}</b></span>
            <Button size="sm" variant="outline" disabled={disconnect.isPending} data-testid="button-disconnect-calendar"
              onClick={() => disconnect.mutate(undefined, { onSuccess: () => { q.refetch(); toast({ title: "Google Calendar disconnected" }); } })}>Disconnect</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={connect.isPending} onClick={start} data-testid="button-connect-calendar">{connect.isPending ? "Opening..." : "Connect Google Calendar"}</Button>
            <span className="text-xs text-muted-foreground">Opens Google in a new tab. Come back here when it says connected.</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div><Label className="text-xs">Meetings from</Label><select className={SELECT} value={hours.meetingStartHour} onChange={(e) => setHours((h) => ({ ...h, meetingStartHour: Number(e.target.value) }))} data-testid="select-meeting-start">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>
          <div><Label className="text-xs">Until</Label><select className={SELECT} value={hours.meetingEndHour} onChange={(e) => setHours((h) => ({ ...h, meetingEndHour: Number(e.target.value) }))} data-testid="select-meeting-end">
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></div>
          <div><Label className="text-xs">Length</Label><select className={SELECT} value={hours.meetingMinutes} onChange={(e) => setHours((h) => ({ ...h, meetingMinutes: Number(e.target.value) }))} data-testid="select-meeting-length">
            {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Weekdays only, in your time zone ({c?.timezone ?? "UTC"}, set under Sending schedule).</span>
          <Button size="sm" variant="outline" disabled={update.isPending || hours.meetingEndHour <= hours.meetingStartHour} data-testid="button-save-meeting-hours"
            onClick={() => update.mutate({ data: hours }, { onSuccess: () => { q.refetch(); toast({ title: "Meeting hours saved" }); } })}>Save hours</Button>
        </div>
      </div>
    </Panel>
  );
}
