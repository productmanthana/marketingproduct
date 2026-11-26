import { Link } from "wouter";
import { Activity as ActIcon, ArrowUpRight, Inbox, Sparkles, Zap } from "lucide-react";
import {
  useGetDashboardSummary, useGetChannelPerformance, useGetLeadFunnel, useGetRecentActivity, useListConversations,
  useListMailboxes, useListCampaigns,
} from "@workspace/api-client-react";
import { GettingStarted } from "@/components/getting-started";
import { PageHeader, Panel, Rows, ErrorBox, Empty, ChannelTag, Pill, ago, pct, chColor, label, type Ch } from "@/components/bits";

export default function Dashboard() {
  const s = useGetDashboardSummary();
  const ch = useGetChannelPerformance();
  const fn = useGetLeadFunnel();
  const act = useGetRecentActivity({ limit: 25 });
  const rev = useListConversations({ status: "needs_review" });
  const d = s.data;
  const mb = useListMailboxes();
  const camps = useListCampaigns();

  const kpis = d ? [
    ["Leads", d.totalLeads, `${d.activeCampaigns} live campaigns`],
    ["Sent", d.messagesSent, `${d.emailsOpened} emails opened`],
    ["Replies", d.repliesReceived, `${pct(d.replyRate)} reply rate`],
    ["AI replies", d.aiRepliesSent, "handled for you", true],
    ["Meetings", d.meetingsBooked, "booked"],
    ["Calls", d.callsScheduled, `scheduled · ${d.openTasks} open tasks`],
  ] as const : [];

  const maxF = Math.max(1, ...(fn.data ?? []).map((f) => f.count));

  return (
    <div>
      <PageHeader eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} title="Home">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90" data-testid="link-run-campaigns">
          <Zap className="h-4 w-4" /> My campaigns
        </Link>
      </PageHeader>
      <div className="space-y-5 p-6 md:p-8">
        {d && mb.data && camps.data && (
          <GettingStarted items={[
            { done: mb.data.some((m) => m.active), title: "Connect your email", body: "So messages go out from your own Gmail or Outlook and replies come back here.", href: "/settings", cta: "Connect email" },
            { done: d.totalLeads > 0, title: "Add people to contact", body: "Search by industry, job title and location, or add people you already know.", href: "/find-leads", cta: "Find people" },
            { done: camps.data.length > 0, title: "Create a campaign", body: "Describe what you offer, and the AI writes the messages.", href: "/campaigns", cta: "Create campaign" },
            { done: d.messagesSent > 0 || d.activeCampaigns > 0, title: "Start sending", body: "Press Start sending on your campaign. Follow-ups go out by themselves.", href: camps.data[0] ? `/campaigns/${camps.data[0].id}` : "/campaigns", cta: "Open campaign" },
            { done: d.repliesReceived > 0, title: "Watch replies come in", body: "The AI answers replies for you. Anything tricky waits in the Inbox.", href: "/inbox", cta: "Open Inbox" },
          ]} />
        )}
        {s.isError ? <ErrorBox onRetry={() => s.refetch()} /> : (
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-card-border bg-card md:grid-cols-3 xl:grid-cols-6">
            {s.isLoading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[104px] border-r border-b border-border p-4"><div className="scanbar h-full rounded bg-muted" /></div>) :
              kpis.map(([k, v, sub, ai], i) => (
                <div key={k} className="rise border-b border-r border-border p-4" style={{ animationDelay: `${i * 50}ms` }} data-testid={`kpi-${k}`}>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{ai && <Sparkles className="h-3 w-3 text-primary" />}{k}</div>
                  <div className={`font-display tnum mt-1 text-[32px] font-bold leading-none ${ai ? "text-primary" : ""}`}>{v.toLocaleString()}</div>
                  <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>
                </div>
              ))}
          </div>
        )}

        {!!d?.needsReview && (
          <Link href="/inbox" className="rise flex items-center gap-3 rounded-xl bg-foreground px-5 py-3.5 text-background" data-testid="link-needs-review-banner">
            <span className="h-2 w-2 rounded-full bg-primary pulse-dot" />
            <span className="text-sm"><b className="font-display">{d.needsReview} conversation{d.needsReview > 1 ? "s" : ""}</b> waiting for your answer. The AI didn't reply because they looked negative or tricky.</span>
            <ArrowUpRight className="ml-auto h-4 w-4" />
          </Link>
        )}

        <div className="grid gap-5 lg:grid-cols-5">
          <Panel title="Results by channel" className="lg:col-span-3" delay={80}>
            {ch.isLoading ? <Rows n={3} h={52} /> : ch.isError ? <ErrorBox onRetry={() => ch.refetch()} /> : (
              <div className="divide-y divide-border">
                {(ch.data ?? []).map((c) => {
                  const max = Math.max(1, ...(ch.data ?? []).map((x) => x.sent));
                  return (
                    <div key={c.channel} className="grid grid-cols-[110px_1fr_auto] items-center gap-4 px-4 py-3.5" data-testid={`row-channel-${c.channel}`}>
                      <ChannelTag channel={c.channel as Ch} />
                      <div className="space-y-1.5">
                        <div className="h-2 rounded-full bg-muted"><div className="h-2 origin-left rounded-full transition-transform duration-700" style={{ width: `${(c.sent / max) * 100}%`, background: chColor(c.channel as Ch, 0.35) }} /></div>
                        <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${(c.replies / max) * 100}%`, background: chColor(c.channel as Ch) }} /></div>
                      </div>
                      <div className="text-right font-mono text-xs tnum">
                        <div><span className="text-muted-foreground">sent</span> {c.sent} <span className="text-muted-foreground">/ rep</span> {c.replies}</div>
                        <div className="font-display text-lg font-bold" style={{ color: chColor(c.channel as Ch) }}>{pct(c.replyRate)}</div>
                      </div>
                    </div>
                  );
                })}
                {!ch.data?.length && <Empty icon={Zap} title="No sends yet" body="Run a campaign and each channel lights up here." />}
              </div>
            )}
          </Panel>
          <Panel title="Where your leads are" className="lg:col-span-2" delay={140}>
            {fn.isLoading ? <Rows n={6} h={22} /> : fn.isError ? <ErrorBox onRetry={() => fn.refetch()} /> : (
              <div className="space-y-1.5 p-4">
                {(fn.data ?? []).map((f, i) => (
                  <Link key={f.status} href={`/leads?status=${f.status}`} className="group grid grid-cols-[108px_1fr_40px] items-center gap-2 text-xs" data-testid={`link-funnel-${f.status}`}>
                    <span className="capitalize text-muted-foreground group-hover:text-foreground">{label(f.status)}</span>
                    <div className="h-5 rounded bg-muted">
                      <div className="rise h-5 rounded" style={{ width: `${Math.max(2, (f.count / maxF) * 100)}%`, background: f.status === "meeting_booked" ? "hsl(var(--primary))" : `hsl(228 38% ${20 + i * 9}%)`, animationDelay: `${i * 60}ms` }} />
                    </div>
                    <span className="text-right font-mono tnum">{f.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
          <Panel title="Replies waiting for you" className="lg:col-span-2" delay={200} action={<Link href="/inbox" className="text-xs text-primary hover:underline" data-testid="link-inbox">Open inbox</Link>}>
            {rev.isLoading ? <Rows n={3} /> : rev.isError ? <ErrorBox onRetry={() => rev.refetch()} /> : !rev.data?.length ? (
              <Empty icon={Inbox} title="All clear" body="The AI is handling every thread. Anything tricky lands here." />
            ) : (
              <div className="divide-y divide-border">
                {rev.data.slice(0, 6).map((c, i) => (
                  <Link key={c.id} href={`/inbox?c=${c.id}`} className="rise flex items-start gap-3 px-4 py-3 hover:bg-muted/50" style={{ animationDelay: `${i * 40}ms` }} data-testid={`link-review-${c.id}`}>
                    <ChannelTag channel={c.channel as Ch} compact />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">{c.leadName}<Pill value={c.sentiment} /></div>
                      <div className="truncate text-xs text-muted-foreground">{c.lastMessagePreview}</div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{ago(c.lastMessageAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Recent activity" className="lg:col-span-3" delay={260}>
            {act.isLoading ? <Rows n={6} h={30} /> : act.isError ? <ErrorBox onRetry={() => act.refetch()} /> : !act.data?.length ? (
              <Empty icon={ActIcon} title="Quiet so far" body="Every send, reply and AI answer is logged here as it happens." />
            ) : (
              <ol className="max-h-[420px] overflow-y-auto py-1">
                {act.data.map((a, i) => (
                  <li key={a.id} className="rise grid grid-cols-[72px_10px_1fr] items-start gap-3 px-4 py-2 text-sm" style={{ animationDelay: `${i * 25}ms` }} data-testid={`row-activity-${a.id}`}>
                    <span className="pt-0.5 font-mono text-[10px] text-muted-foreground">{ago(a.createdAt).replace(" ago", "")}</span>
                    <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: a.type === "ai_reply" ? "hsl(var(--primary))" : a.channel ? chColor(a.channel as Ch) : "hsl(var(--muted-foreground))" }} />
                    <span>
                      {a.type === "ai_reply" && <span className="mr-1.5 rounded bg-accent px-1 font-mono text-[10px] text-accent-foreground">AI</span>}
                      {a.leadId ? <Link href={`/leads/${a.leadId}`} className="font-medium hover:text-primary">{a.leadName}</Link> : null}
                      <span className="text-muted-foreground"> {a.description}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
