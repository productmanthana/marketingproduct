import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ChevronLeft, Radar, Globe, Linkedin, Mail, MessagesSquare, Phone, PhoneCall, Trash2, Sparkles, CheckSquare, KanbanSquare, Building2 } from "lucide-react";
import { useGetLead, useUpdateLead, useDeleteLead, useCreateCall, useEnrichLead, useQualifyLeads, useListAccounts, useScanLeadSignals, useVerifyLeadEmails, useListTeam } from "@workspace/api-client-react";
import { MeetingsPanel } from "@/components/meetings";
import { Timeline } from "@/components/timeline";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { useMoney } from "@/components/crm/format";
import { StageBadge } from "@/pages/pipeline";
import { Input } from "@/components/ui/input";
import { FitBadge } from "@/components/fit-badge";
import { AddTask, TaskRow } from "@/pages/tasks";
import type { LeadStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Panel, Rows, ErrorBox, Empty, ChannelTag, Pill, Initials, AiWorking, ago, label, chColor, errMsg, useRefreshAll, type Ch } from "@/components/bits";

const STATUSES = ["new", "contacted", "replied", "interested", "meeting_booked", "nurture", "not_interested", "unsubscribed", "bounced"];

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
  const [converting, setConverting] = useState(false);
  const accounts = useListAccounts();
  const scan = useScanLeadSignals();
  const verify = useVerifyLeadEmails();
  const team = useListTeam();
  const { money } = useMoney();
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
        <Button onClick={() => setConverting(true)} data-testid="button-convert-lead"><KanbanSquare className="mr-1 h-4 w-4" />Convert to deal</Button>
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
              {l.email && (
                <div className="flex items-center justify-between gap-2 px-4 py-2.5"><span className="text-muted-foreground">Email check</span>
                  <span className="flex items-center gap-2">{l.emailStatus ? <Pill value={l.emailStatus} /> : <span className="text-xs text-muted-foreground">not checked</span>}
                    <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={verify.isPending} data-testid="button-verify-lead-email"
                      onClick={() => verify.mutate({ data: { leadIds: [id] } }, { onSuccess: () => refresh() })}>{verify.isPending ? "checking..." : "check"}</button></span></div>
              )}
              <div className="flex items-center justify-between gap-3 px-4 py-2"><span className="text-muted-foreground">Owner</span>
                <select className="h-8 max-w-[160px] rounded-md border border-input bg-card px-1.5 text-xs" value={l.ownerId ?? ""} data-testid="select-lead-owner"
                  onChange={(e) => upd.mutate({ id, data: { ownerId: e.target.value ? Number(e.target.value) : null } }, { onSuccess: () => { refresh(); toast({ title: "Owner updated" }); } })}>
                  <option value="">Unassigned</option>{team.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-muted-foreground">Time zone</span><span className="text-xs" data-testid="text-lead-timezone">{l.timezone ?? (l.companyLocation ? "from location" : "yours")}</span></div>
              <div className="space-y-1.5 px-4 py-2.5" data-testid="block-signals">
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><Radar className="h-3.5 w-3.5" />Buying signals</span>
                  <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={scan.isPending} data-testid="button-scan-lead-signals"
                    onClick={() => scan.mutate({ data: { leadIds: [id] } }, { onSuccess: (r) => { refresh(); toast({ title: r.skipped ? "Add the company website first" : r.withSignals ? "Signals found" : "No signals on their website right now" }); }, onError: (e) => toast({ title: "Scan failed", description: errMsg(e), variant: "destructive" }) })}>{scan.isPending ? "scanning..." : l.signalsAt ? "rescan" : "scan"}</button></div>
                {l.signals ? <ul className="list-disc space-y-0.5 pl-4 text-xs">{l.signals.split("\n").map((s) => <li key={s}>{s}</li>)}</ul>
                  : <p className="text-xs text-muted-foreground">{l.signalsAt ? `None found ${ago(l.signalsAt)}` : "Hiring, funding, launches or expansion from their website."}</p>}
              </div>
              <div className="flex items-center justify-between gap-2 px-4 py-2.5"><span className="text-muted-foreground">ICP fit</span>
                <span className="flex items-center gap-2"><FitBadge score={l.fitScore} reason={l.fitReason} />
                  <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={qualify.isPending} data-testid="button-score-lead"
                    onClick={() => qualify.mutate({ data: { leadIds: [id] } }, { onSuccess: () => refresh(), onError: (e) => toast({ title: "Could not score", description: errMsg(e), variant: "destructive" }) })}>{qualify.isPending ? "scoring..." : l.fitScore == null ? "score" : "rescore"}</button></span></div>
              {l.fitReason && <p className="px-4 py-2.5 text-xs text-muted-foreground" data-testid="text-fit-reason">{l.fitReason}</p>}
              <div className="flex items-center justify-between gap-3 px-4 py-2"><span className="flex items-center gap-1.5 text-muted-foreground"><Building2 className="h-3.5 w-3.5" />Account</span>
                <span className="flex min-w-0 items-center gap-2">
                  {l.accountId && <Link href={`/accounts/${l.accountId}`} className="truncate text-xs text-primary hover:underline" data-testid="link-lead-account">open</Link>}
                  <select className="h-8 max-w-[160px] rounded-md border border-input bg-card px-1.5 text-xs" value={l.accountId ?? ""} data-testid="select-lead-account"
                    onChange={(e) => upd.mutate({ id, data: { accountId: e.target.value ? Number(e.target.value) : null } }, { onSuccess: () => { refresh(); toast({ title: e.target.value ? "Linked to account" : "Removed from account" }); } })}>
                    <option value="">None</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></span></div>
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
          <MeetingsPanel leadId={id} delay={65} />
          <Panel title={`Deals · ${l.deals.length}`} delay={70} action={<button className="text-xs text-primary hover:underline" onClick={() => setConverting(true)} data-testid="button-lead-new-deal">+ Deal</button>}>
            {!l.deals.length ? <Empty icon={KanbanSquare} title="No deals" body="Convert this lead when there is a real opportunity. Booking a meeting opens one automatically." /> :
              <div className="divide-y divide-border">{l.deals.map((d) => (
                <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40" data-testid={`link-lead-deal-${d.id}`}>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span><StageBadge stage={d.stage} /><span className="font-mono text-sm">{money(d.amount)}</span>
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
          <Panel title="Timeline" delay={140}><Timeline activity={l.activity} /></Panel>
        </div>
      </div>
      {converting && <ConvertLeadDialog lead={l} onClose={() => setConverting(false)} />}
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
