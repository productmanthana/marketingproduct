import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ChevronLeft, Globe, Linkedin, Mail, MessagesSquare, Phone, PhoneCall, Trash2, History, Sparkles, CheckSquare } from "lucide-react";
import { useGetLead, useUpdateLead, useDeleteLead, useCreateCall, useEnrichLead, useQualifyLeads } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { FitBadge } from "@/components/fit-badge";
import { AddTask, TaskRow } from "@/pages/tasks";
import type { LeadStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ErrorBox, Empty, ChannelTag, Pill, Initials, AiWorking, ago, label, chColor, errMsg, useRefreshAll, type Ch } from "@/components/bits";

const STATUSES = ["new", "contacted", "replied", "interested", "meeting_booked", "not_interested", "unsubscribed"];

export default function LeadDetail() {
  const id = Number(useParams().id);
  const q = useGetLead(id);
  const upd = useUpdateLead();
  const del = useDeleteLead();
  const call = useCreateCall();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const enrich = useEnrichLead();
  const qualify = useQualifyLeads();
  const [notes, setNotes] = useState<string | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const l = q.data;
  if (q.isLoading) return <div className="p-8"><Rows n={5} h={80} /></div>;
  if (q.isError || !l) return <ErrorBox onRetry={() => q.refetch()} />;
  const name = `${l.firstName} ${l.lastName}`;

  return (
    <div className="p-6 md:p-8">
      <Link href="/leads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back-leads"><ChevronLeft className="h-3 w-3" />Leads</Link>
      <div className="rise mt-3 flex flex-wrap items-center gap-4 border-b border-border pb-5">
        <Initials name={name} className="h-14 w-14 rounded-xl text-base" />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold" data-testid="text-lead-name">{name}</h1>
          <p className="text-sm text-muted-foreground">{l.title}{l.company && ` at ${l.company}`}{l.industry && ` · ${l.industry}`}</p>
        </div>
        <select className="h-9 rounded-md border border-input bg-card px-2 text-sm capitalize" value={l.status} data-testid="select-lead-status"
          onChange={(e) => upd.mutate({ id, data: { status: e.target.value as LeadStatus } }, { onSuccess: () => { refresh(); toast({ title: `Marked ${label(e.target.value)}` }); } })}>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <Button variant="outline" disabled={enrich.isPending} data-testid="button-enrich-lead"
          onClick={() => enrich.mutate({ id }, { onSuccess: () => { setNotes(null); refresh(); toast({ title: "Research added to notes" }); }, onError: (e) => toast({ title: "Research failed", description: errMsg(e), variant: "destructive" }) })}>
          <Sparkles className="mr-1 h-4 w-4 text-primary" />{enrich.isPending ? "Researching..." : "Research with AI"}
        </Button>
        <Button variant="outline" disabled={call.isPending} data-testid="button-schedule-call"
          onClick={() => call.mutate({ data: { leadId: id, campaignId: l.campaignId ?? undefined, objective: "Follow up and book a meeting" } }, { onSuccess: (c) => { refresh(); nav(`/calls?id=${c.id}`); } })}>
          <PhoneCall className="mr-1 h-4 w-4" />{call.isPending ? "Scheduling..." : "Schedule call"}
        </Button>
        <Button variant="outline" size="icon" onClick={() => setConfirm(true)} data-testid="button-delete-lead"><Trash2 className="h-4 w-4" /></Button>
      </div>

      {enrich.isPending && <div className="mt-4"><AiWorking text="Looking up company details and reading the website for personalization hooks" /></div>}
      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <Panel title="Profile">
            <dl className="divide-y divide-border text-sm">
              {[[Mail, l.email, l.email && `mailto:${l.email}`, "email"], [Phone, l.phone, l.phone && `tel:${l.phone}`, "call"], [Linkedin, l.linkedinUrl, l.linkedinUrl, "linkedin"]].map(([I, v, href, ch], i) => {
                const Icon = I as typeof Mail;
                return <div key={i} className="flex items-center gap-3 px-4 py-2.5"><Icon className="h-4 w-4" style={{ color: chColor(ch as Ch) }} />
                  {v ? <a href={href as string} target="_blank" rel="noreferrer" className="truncate hover:text-primary">{v as string}</a> : <span className="text-muted-foreground">-</span>}</div>;
              })}
              <div className="flex items-center gap-2 px-4 py-2"><Globe className="h-4 w-4 text-muted-foreground" />
                <Input className="h-8" placeholder="company.com" value={website ?? l.website ?? ""} onChange={(e) => setWebsite(e.target.value)} data-testid="input-lead-website" />
                {website !== null && <Button size="sm" variant="outline" className="h-8" disabled={upd.isPending} data-testid="button-save-website"
                  onClick={() => upd.mutate({ id, data: { website } }, { onSuccess: () => { setWebsite(null); refresh(); } })}>Save</Button>}</div>
              {(l.companySize || l.companyLocation || l.companyLinkedinUrl) && (
                <div className="space-y-1 px-4 py-2.5 text-xs" data-testid="block-company-details">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Company</div>
                  {l.companySize && <div data-testid="text-company-size">{l.companySize}</div>}
                  {l.companyLocation && <div className="text-muted-foreground" data-testid="text-company-location">{l.companyLocation}</div>}
                  {l.companyLinkedinUrl && <a href={l.companyLinkedinUrl} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline" data-testid="link-company-linkedin">Company LinkedIn page</a>}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-4 py-2.5"><span className="text-muted-foreground">ICP fit</span>
                <span className="flex items-center gap-2"><FitBadge score={l.fitScore} reason={l.fitReason} />
                  <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={qualify.isPending} data-testid="button-score-lead"
                    onClick={() => qualify.mutate({ data: { leadIds: [id] } }, { onSuccess: () => refresh(), onError: (e) => toast({ title: "Could not score", description: errMsg(e), variant: "destructive" }) })}>{qualify.isPending ? "scoring..." : l.fitScore == null ? "score" : "rescore"}</button></span></div>
              {l.fitReason && <p className="px-4 py-2.5 text-xs text-muted-foreground" data-testid="text-fit-reason">{l.fitReason}</p>}
              <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Campaign</span>{l.campaignId ? <Link href={`/campaigns/${l.campaignId}`} className="hover:text-primary">{l.campaignName}</Link> : "-"}</div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Step</span><span className="font-mono">{l.currentStep ?? 0}</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Last touch</span><span>{ago(l.lastContactedAt)}</span></div>
            </dl>
          </Panel>
          <Panel title="Notes">
            <div className="space-y-2 p-3">
              <Textarea rows={4} value={notes ?? l.notes ?? ""} onChange={(e) => setNotes(e.target.value)} data-testid="input-lead-notes" />
              <Button size="sm" disabled={notes === null || upd.isPending} data-testid="button-save-notes"
                onClick={() => upd.mutate({ id, data: { notes: notes ?? "" } }, { onSuccess: () => { setNotes(null); refresh(); toast({ title: "Notes saved" }); } })}>Save notes</Button>
            </div>
          </Panel>
        </div>
        <div className="min-w-0 space-y-5">
          <Panel title={`Conversations · ${l.conversations.length}`} delay={60}>
            {!l.conversations.length ? <Empty icon={MessagesSquare} title="No conversations" body="Threads appear when the campaign reaches this lead." /> :
              <div className="divide-y divide-border">{l.conversations.map((c) => (
                <Link key={c.id} href={`/inbox?c=${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40" data-testid={`link-conversation-${c.id}`}>
                  <ChannelTag channel={c.channel as Ch} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.subject ?? "Conversation"}</div><div className="truncate text-xs text-muted-foreground">{c.lastMessagePreview}</div></div>
                  <Pill value={c.status} /><span className="font-mono text-[10px] text-muted-foreground">{ago(c.lastMessageAt)}</span>
                </Link>))}</div>}
          </Panel>
          <Panel title={`Tasks · ${l.tasks.filter((t) => !t.done).length} open`} delay={80}>
            <AddTask leadId={id} />
            {!l.tasks.length ? <div className="p-4"><Empty icon={CheckSquare} title="No tasks" body="Call next steps and replies that need you show up here." /></div> :
              <div className="divide-y divide-border">{l.tasks.map((t) => <TaskRow key={t.id} t={t} showLead={false} />)}</div>}
          </Panel>
          <Panel title={`Calls · ${l.calls.length}`} delay={100}>
            {!l.calls.length ? <Empty icon={PhoneCall} title="No calls" body="Schedule one and the AI writes the script." /> :
              <div className="divide-y divide-border">{l.calls.map((c) => (
                <Link key={c.id} href={`/calls?id=${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40" data-testid={`link-call-${c.id}`}>
                  <ChannelTag channel="call" /><span className="flex-1 truncate text-sm">{c.objective ?? "Call"}</span>{c.outcome && <span className="text-xs text-muted-foreground">{c.outcome}</span>}<Pill value={c.status} />
                </Link>))}</div>}
          </Panel>
          <Panel title="Timeline" delay={140}>
            {!l.activity.length ? <Empty icon={History} title="Nothing yet" /> :
              <ol className="relative p-4 pl-8">
                <span className="absolute bottom-4 left-[19px] top-4 w-px bg-border" />
                {l.activity.map((a, i) => (
                  <li key={a.id} className="rise relative pb-3" style={{ animationDelay: `${i * 30}ms` }}>
                    <span className="absolute -left-[17px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card" style={{ background: a.type === "ai_reply" ? "hsl(var(--primary))" : a.channel ? chColor(a.channel as Ch) : "hsl(var(--muted-foreground))" }} />
                    <div className="text-sm">{a.description}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{label(a.type)} · {ago(a.createdAt)}</div>
                  </li>))}
              </ol>}
          </Panel>
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {name}?</AlertDialogTitle><AlertDialogDescription>Removes the lead with its conversations and calls.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-lead" onClick={() => del.mutate({ id }, { onSuccess: () => { refresh(); nav("/leads"); } })}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
