import { CalendarCheck } from "lucide-react";
import { useGetCalendar, getGetCalendarQueryKey } from "@workspace/api-client-react";
import { Panel } from "@/components/bits";
import { CalcomSection } from "./calcom";

/** Calendar the AI uses to find free times and book meetings on its own, through Cal.com. */
export function CalendarPanel({ delay }: { delay?: number }) {
  const q = useGetCalendar({ query: { queryKey: getGetCalendarQueryKey(), refetchOnWindowFocus: true } });
  const c = q.data;

  return (
    <Panel title="Meeting auto-scheduling" delay={delay}
      action={<span data-testid="text-scheduling-provider" className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${c?.calcomConnected ? "bg-primary/10 text-primary" : "border border-dashed border-border text-muted-foreground"}`}>{c?.calcomConnected ? "Cal.com" : "Off"}</span>}>
      <div className="grid gap-3 p-4 text-sm">
        <div className="flex items-start gap-3 text-muted-foreground">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarCheck className="h-4 w-4" /></div>
          <p>When a prospect wants to meet, the AI checks your free times, books the slot they ask for (or offers free ones) and sends the invite with a meeting link. No booking link needed.</p>
        </div>
        {c && <CalcomSection c={c} />}
      </div>
    </Panel>
  );
}
