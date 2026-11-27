import { useState } from "react";
import { Link } from "wouter";
import { Bell, CalendarPlus, ExternalLink, Send, Sparkles, Trash2 } from "lucide-react";
import {
  type Meeting,
  useCreateMeeting,
  useDeleteMeeting,
  useDraftMeetingFollowUp,
  getListMeetingsQueryKey,
  useListLeads,
  useListMeetings,
  useSendMeetingFollowUp,
  useUpdateMeeting,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Panel, Pill, ago, errMsg, useRefreshAll } from "@/components/bits";

const when = (d: string) => new Date(d).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One meeting: time and link, reminder status, and once it's over the AI follow-up draft to review and send. */
export function MeetingCard({ m, showLead = true }: { m: Meeting; showLead?: boolean }) {
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const update = useUpdateMeeting();
  const del = useDeleteMeeting();
  const draft = useDraftMeetingFollowUp();
  const send = useSendMeetingFollowUp();
  const [subject, setSubject] = useState(m.followUpSubject ?? "");
  const [body, setBody] = useState(m.followUpBody ?? "");
  const [notes, setNotes] = useState(m.notes ?? "");
  const past = new Date(m.startsAt).getTime() + m.minutes * 60_000 < Date.now();
  const dirty = subject !== (m.followUpSubject ?? "") || body !== (m.followUpBody ?? "");
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: "destructive" });

  return (
    <div className="rise space-y-3 p-4" data-testid={`row-meeting-${m.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{m.title}</b><Pill value={m.status} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{m.provider === "calcom" ? "Cal.com" : m.provider === "google" ? "Google" : "logged"}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {when(m.startsAt)} · {m.minutes} min
            {showLead && <> · <Link href={`/leads/${m.leadId}`} className="hover:text-primary">{m.leadName}{m.leadCompany ? `, ${m.leadCompany}` : ""}</Link></>}
            {m.dealId && <> · <Link href={`/deals/${m.dealId}`} className="hover:text-primary">{m.dealName}</Link></>}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" />Meeting link</a>}
            {m.reminderSentAt && <span className="inline-flex items-center gap-1" data-testid={`text-reminder-${m.id}`}><Bell className="h-3 w-3" />Reminder sent {ago(m.reminderSentAt)}</span>}
            {m.followUpSentAt && <span className="inline-flex items-center gap-1"><Send className="h-3 w-3" />Follow-up sent {ago(m.followUpSentAt)}</span>}
          </div>
        </div>
        {m.status === "scheduled" && (
          <select className="h-8 rounded-md border border-input bg-card px-2 text-xs" value="" aria-label="Update meeting" data-testid={`select-meeting-status-${m.id}`}
            onChange={(e) => e.target.value && update.mutate({ id: m.id, data: { status: e.target.value as Meeting["status"] } }, { onSuccess: refresh })}>
            <option value="">Mark as...</option><option value="completed">Done</option><option value="no_show">No-show</option><option value="canceled">Canceled</option>
          </select>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" aria-label="Delete meeting" data-testid={`button-delete-meeting-${m.id}`}
          onClick={() => del.mutate({ id: m.id }, { onSuccess: refresh })}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>

      {(past || m.status === "completed") && m.status !== "canceled" && !m.followUpSentAt && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" data-testid={`follow-up-${m.id}`}>
          <div className="text-xs font-medium">Follow-up email</div>
          <Textarea rows={2} placeholder="Meeting notes (optional): what you discussed, next steps. The AI uses them for the follow-up." value={notes} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (m.notes ?? "") && update.mutate({ id: m.id, data: { notes } })} data-testid={`input-meeting-notes-${m.id}`} />
          {m.followUpBody || body ? (<>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid={`input-follow-up-subject-${m.id}`} />
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`input-follow-up-body-${m.id}`} />
          </>) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" disabled={draft.isPending} data-testid={`button-draft-follow-up-${m.id}`}
              onClick={() => update.mutate({ id: m.id, data: { notes } }, { onSuccess: () => draft.mutate({ id: m.id }, { onSuccess: (r) => { setSubject(r.followUpSubject ?? ""); setBody(r.followUpBody ?? ""); refresh(); }, onError: fail("Could not draft") }) })}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />{draft.isPending ? "Writing..." : m.followUpBody ? "Rewrite with AI" : "Draft with AI"}</Button>
            {(m.followUpBody || body) && (
              <Button size="sm" disabled={send.isPending || !body.trim() || !m.leadEmail} title={m.leadEmail ? undefined : "This person has no email address"} data-testid={`button-send-follow-up-${m.id}`}
                onClick={() => {
                  const go = () => send.mutate({ id: m.id }, { onSuccess: () => { refresh(); toast({ title: "Follow-up sent" }); }, onError: fail("Could not send") });
                  if (dirty) update.mutate({ id: m.id, data: { followUpSubject: subject, followUpBody: body } }, { onSuccess: go });
                  else go();
                }}><Send className="mr-1 h-3.5 w-3.5" />{send.isPending ? "Sending..." : "Send follow-up"}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Log a meeting that was booked outside the app, so reminders and the follow-up still happen. */
export function LogMeeting({ leadId, onDone }: { leadId?: number; onDone?: () => void }) {
  const create = useCreateMeeting();
  const leads = useListLeads();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [f, setF] = useState({ lead: "", at: "", minutes: 30, link: "" });
  const target = leadId ?? Number(f.lead);
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-border p-3" data-testid="form-log-meeting">
      {!leadId && (
        <select className="h-9 min-w-[180px] flex-1 rounded-md border border-input bg-card px-2 text-sm" value={f.lead} onChange={(e) => setF({ ...f, lead: e.target.value })} data-testid="select-meeting-lead">
          <option value="">Who with?</option>{leads.data?.map((l) => <option key={l.id} value={l.id}>{l.firstName} {l.lastName}{l.company ? ` · ${l.company}` : ""}</option>)}
        </select>
      )}
      <Input type="datetime-local" className="w-52" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} data-testid="input-meeting-at" />
      <select className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} data-testid="select-meeting-minutes">
        {[15, 20, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} min</option>)}
      </select>
      <Input className="min-w-[160px] flex-1" placeholder="Meeting link (optional)" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} data-testid="input-meeting-link" />
      <Button disabled={!target || !f.at || create.isPending} data-testid="button-log-meeting"
        onClick={() => create.mutate({ data: { leadId: target, startsAt: new Date(f.at).toISOString(), minutes: f.minutes, link: f.link || undefined } }, {
          onSuccess: () => { refresh(); setF({ lead: "", at: "", minutes: 30, link: "" }); toast({ title: "Meeting saved", description: "A reminder goes out before it starts." }); onDone?.(); },
          onError: (e) => toast({ title: "Could not save", description: errMsg(e), variant: "destructive" }),
        })}><CalendarPlus className="mr-1 h-4 w-4" />Log meeting</Button>
    </div>
  );
}

/** Meetings with one person (lead page) or on one deal (deal page). */
export function MeetingsPanel({ leadId, dealId, delay }: { leadId?: number; dealId?: number; delay?: number }) {
  const params = { leadId, dealId };
  const q = useListMeetings(params, { query: { queryKey: getListMeetingsQueryKey(params) } });
  return (
    <Panel title={`Meetings · ${q.data?.length ?? 0}`} delay={delay}>
      {leadId && <LogMeeting leadId={leadId} />}
      {q.data?.length ? <div className="divide-y divide-border">{q.data.map((m) => <MeetingCard key={m.id} m={m} showLead={!leadId} />)}</div>
        : <p className="p-4 text-sm text-muted-foreground">No meetings yet. Meetings the AI books appear here automatically.</p>}
    </Panel>
  );
}
