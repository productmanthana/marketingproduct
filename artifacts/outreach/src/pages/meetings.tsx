import { CalendarClock } from "lucide-react";
import { useListMeetings, getListMeetingsQueryKey } from "@workspace/api-client-react";
import { PageHeader, Panel, Rows, ErrorBox, Empty } from "@/components/bits";
import { LogMeeting, MeetingCard } from "@/components/meetings";

export default function Meetings() {
  const q = useListMeetings(undefined, { query: { queryKey: getListMeetingsQueryKey(), refetchInterval: 60_000 } });
  const now = Date.now();
  const all = q.data ?? [];
  const upcoming = all.filter((m) => m.status === "scheduled" && new Date(m.startsAt).getTime() + m.minutes * 60_000 >= now).reverse();
  const needsFollowUp = all.filter((m) => !upcoming.includes(m) && m.status !== "canceled" && m.status !== "no_show" && !m.followUpSentAt);
  const done = all.filter((m) => !upcoming.includes(m) && !needsFollowUp.includes(m));

  return (
    <div>
      <PageHeader eyebrow="Pipeline" title="Meetings" />
      <div className="space-y-5 p-6 md:p-8">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Meetings the AI books land here, plus any you log yourself. The prospect gets an email reminder before each one. Afterwards the AI drafts a follow-up email for you to review and send, and moves the deal to its next stage.
        </p>
        {q.isLoading ? <Rows n={4} h={70} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : (<>
          <Panel title={`Upcoming (${upcoming.length})`}>
            <LogMeeting />
            {upcoming.length ? <div className="divide-y divide-border">{upcoming.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
              : <div className="p-4"><Empty icon={CalendarClock} title="No upcoming meetings" body="When a prospect agrees to a time, the AI books it and it shows up here." /></div>}
          </Panel>
          {!!needsFollowUp.length && (
            <Panel title={`Needs a follow-up (${needsFollowUp.length})`} delay={40}>
              <div className="divide-y divide-border">{needsFollowUp.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
            </Panel>
          )}
          {!!done.length && (
            <Panel title="Past" delay={80}>
              <div className="divide-y divide-border">{done.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
            </Panel>
          )}
        </>)}
      </div>
    </div>
  );
}
