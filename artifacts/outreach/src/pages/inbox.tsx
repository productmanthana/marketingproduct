import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { Bot, Inbox as InboxIcon, Send, Sparkles, FlaskConical, User, RefreshCw, Eye, AlertTriangle } from "lucide-react";
import {
  useListConversations, getListConversationsQueryKey, useGetConversation, getGetConversationQueryKey, useUpdateConversation, useSendMessage, useReceiveInbound, useDraftAiReply, useSyncMailboxes,
} from "@workspace/api-client-react";
import type { AiDraft, Channel, ConversationStatus, Message } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Rows, ErrorBox, Empty, ChannelTag, Pill, AiWorking, Initials, ago, label, chColor, errMsg, useRefreshAll, type Ch } from "@/components/bits";

const STATUSES = ["open", "auto_replied", "needs_review", "closed"];

export default function Inbox() {
  const initial = Number(new URLSearchParams(useSearch()).get("c")) || null;
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<number | null>(initial);
  const params = { channel: (channel || undefined) as Channel | undefined, status: (status || undefined) as ConversationStatus | undefined };
  const q = useListConversations(params, { query: { queryKey: getListConversationsQueryKey(params), refetchInterval: 20_000 } });
  const sync = useSyncMailboxes();
  const refresh = useRefreshAll();
  const { toast } = useToast();

  return (
    <div className="flex h-[100dvh] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <h1 className="font-display mr-4 text-2xl font-bold">Inbox</h1>
        <Seg value={channel} onChange={setChannel} opts={[["", "All"], ["email", "Email"], ["linkedin", "LinkedIn"]]} id="channel" />
        <Seg value={status} onChange={setStatus} opts={[["", "Any"], ...STATUSES.map((s) => [s, label(s)] as [string, string])]} id="status" />
        <Button size="sm" variant="outline" className="ml-auto" disabled={sync.isPending} data-testid="button-check-replies"
          onClick={() => sync.mutate(undefined, { onSuccess: (r) => { refresh(); toast({ title: r.mailboxes ? `${r.newReplies} new replies` : "No mailbox with reply sync", description: r.errors.length ? r.errors.join("; ") : r.mailboxes ? undefined : "Add IMAP details to a mailbox in Settings.", variant: r.errors.length ? "destructive" : undefined }); } })}>
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", sync.isPending && "animate-spin")} />Check replies</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("w-full shrink-0 overflow-y-auto border-r border-border md:w-[340px]", sel && "hidden md:block")}>
          {q.isLoading ? <Rows n={7} h={58} /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> : !q.data?.length ? (
            <div className="p-4"><Empty icon={InboxIcon} title="Inbox zero" body="Replies across email and LinkedIn land here. The AI answers what it can." /></div>
          ) : q.data.map((c, i) => (
            <button key={c.id} onClick={() => setSel(c.id)} data-testid={`button-conversation-${c.id}`}
              className={cn("rise relative block w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/50", sel === c.id && "bg-card")} style={{ animationDelay: `${i * 25}ms` }}>
              <span className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ background: sel === c.id ? chColor(c.channel as Ch) : "transparent" }} />
              <div className="flex items-center gap-2">
                {c.unread && <span className="h-2 w-2 rounded-full bg-primary" />}
                <span className={cn("flex-1 truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.leadName}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.leadCompany}</span></span>
                <span className="font-mono text-[10px] text-muted-foreground">{ago(c.lastMessageAt).replace(" ago", "")}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.lastMessagePreview}</div>
              <div className="mt-1.5 flex items-center gap-1.5"><ChannelTag channel={c.channel as Ch} compact /><Pill value={c.status} /><Pill value={c.sentiment} /></div>
            </button>
          ))}
        </div>
        <div className={cn("min-w-0 flex-1", !sel && "hidden md:block")}>
          {sel ? <Thread id={sel} onBack={() => setSel(null)} /> : <div className="grid h-full place-items-center p-6"><Empty icon={Bot} title="Pick a thread" body="Lead messages, your replies and AI replies are color-coded so you always know who said what." /></div>}
        </div>
      </div>
    </div>
  );
}

function Seg({ value, onChange, opts, id }: { value: string; onChange: (v: string) => void; opts: [string, string][]; id: string }) {
  return (
    <div className="flex rounded-lg border border-border bg-card p-0.5">
      {opts.map(([v, l]) => <button key={v} onClick={() => onChange(v)} data-testid={`filter-${id}-${v || "all"}`}
        className={cn("rounded-md px-2.5 py-1 text-xs capitalize transition-colors", value === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
    </div>
  );
}

const AUTH: Record<string, { name: string; icon: typeof Bot; cls: string }> = {
  lead: { name: "Lead", icon: User, cls: "bg-card border-border" },
  user: { name: "You", icon: Send, cls: "bg-foreground text-background border-foreground" },
  ai: { name: "AI agent", icon: Sparkles, cls: "bg-accent border-primary/30 text-accent-foreground" },
};

function Bubble({ m, i }: { m: Message; i: number }) {
  const a = AUTH[m.author];
  const I = a.icon;
  const out = m.direction === "outbound";
  return (
    <div className={cn("rise flex", out ? "justify-end" : "justify-start")} style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }} data-testid={`message-${m.id}`}>
      <div className={cn("max-w-[78%] rounded-xl border px-4 py-3 shadow-sm", a.cls, out ? "rounded-br-sm" : "rounded-bl-sm")}>
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider opacity-70"><I className="h-3 w-3" />{a.name}<span>· {ago(m.createdAt)}</span></div>
        {m.subject && <div className="mb-1 text-sm font-semibold">{m.subject}</div>}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
        {out && <Delivery m={m} />}
      </div>
    </div>
  );
}

function Delivery({ m }: { m: Message }) {
  const base = "mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider opacity-70";
  if (m.deliveryStatus === "failed") return <div className={cn(base, "text-destructive opacity-100")} title={m.deliveryError ?? ""} data-testid={`delivery-failed-${m.id}`}><AlertTriangle className="h-3 w-3" />Not delivered: {m.deliveryError}</div>;
  return (
    <div className={base} data-testid={`delivery-${m.deliveryStatus}-${m.id}`}>
      {m.deliveryStatus === "sent" ? `Delivered via ${m.channel === "email" ? "mailbox" : "LinkedIn"}` : "Saved in-app (no provider connected)"}
      {m.openedAt && <span className="ml-1 inline-flex items-center gap-1"><Eye className="h-3 w-3" />opened {ago(m.openedAt)}</span>}
    </div>
  );
}

function Thread({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useGetConversation(id, { query: { enabled: !!id, queryKey: getGetConversationQueryKey(id), refetchInterval: 20_000 } });
  const upd = useUpdateConversation();
  const send = useSendMessage();
  const inbound = useReceiveInbound();
  const draft = useDraftAiReply();
  const refresh = useRefreshAll();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [ai, setAi] = useState<AiDraft | null>(null);
  const [sim, setSim] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const c = q.data;
  const updRef = useRef(upd.mutate); updRef.current = upd.mutate;

  useEffect(() => { setBody(""); setSubject(""); setAi(null); setSim(""); }, [id]);
  useEffect(() => { if (c?.unread) updRef.current({ id, data: { unread: false } }, { onSuccess: () => refresh() }); }, [c?.unread, id]); // eslint-disable-line
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [c?.messages.length, inbound.isPending]);

  if (q.isLoading) return <Rows n={5} h={80} />;
  if (q.isError || !c) return <ErrorBox onRetry={() => q.refetch()} />;
  const isEmail = c.channel === "email";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <button className="text-xs text-muted-foreground md:hidden" onClick={onBack} data-testid="button-back-list">Back</button>
        <Initials name={c.leadName} />
        <div className="min-w-0 flex-1">
          <Link href={`/leads/${c.leadId}`} className="font-display text-lg font-bold hover:text-primary" data-testid="link-thread-lead">{c.leadName}</Link>
          <div className="truncate text-xs text-muted-foreground">{c.lead?.title} {c.leadCompany && `at ${c.leadCompany}`}{c.campaignName && ` · ${c.campaignName}`}</div>
        </div>
        <ChannelTag channel={c.channel as Ch} /><Pill value={c.sentiment} />
        <select className="h-8 rounded-md border border-input bg-card px-2 text-xs capitalize" value={c.status} data-testid="select-conversation-status"
          onChange={(e) => upd.mutate({ id, data: { status: e.target.value as ConversationStatus } }, { onSuccess: () => { refresh(); toast({ title: `Marked ${label(e.target.value)}` }); } })}>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      <div className="grid-paper min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {c.messages.map((m, i) => <Bubble key={m.id} m={m} i={i} />)}
        {inbound.isPending && <div className="mx-auto max-w-md"><AiWorking text="Lead reply received. AI is reading the thread and deciding how to answer" /></div>}
        <div ref={endRef} />
      </div>

      <div className="space-y-3 border-t border-border bg-card p-4">
        {draft.isPending && <AiWorking text="Drafting a reply in your tone" />}
        {ai && (
          <div className="pop rounded-lg border border-primary/30 bg-accent/50 p-3 text-xs" data-testid="panel-ai-draft">
            <div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-primary" /><b className="text-accent-foreground">AI draft loaded below</b><span className="text-muted-foreground">Detected</span><Pill value={ai.sentiment} />
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setAi(null)} data-testid="button-dismiss-draft">Dismiss</button></div>
            <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{ai.reasoning}</p>
          </div>
        )}
        {isEmail && <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-reply-subject" />}
        <Textarea rows={4} placeholder={`Reply on ${c.channel}...`} value={body} onChange={(e) => setBody(e.target.value)} data-testid="input-reply-body" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={draft.isPending} data-testid="button-draft-ai"
            onClick={() => draft.mutate({ id }, { onSuccess: (d) => { setAi(d); setBody(d.body); if (d.subject) setSubject(d.subject); }, onError: () => toast({ title: "Draft failed", variant: "destructive" }) })}>
            <Sparkles className="mr-1.5 h-4 w-4 text-primary" />{draft.isPending ? "Drafting..." : "Draft with AI"}
          </Button>
          <Button className="ml-auto" disabled={!body.trim() || send.isPending} data-testid="button-send-reply"
            onClick={() => send.mutate({ id, data: { body, subject: isEmail && subject ? subject : undefined } }, { onSuccess: () => { setBody(""); setAi(null); refresh(); toast({ title: "Sent" }); }, onError: (e) => toast({ title: "Send failed", description: errMsg(e), variant: "destructive" }) })}>
            <Send className="mr-1.5 h-4 w-4" />{send.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
        <details className="group rounded-lg border border-dashed border-border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground" data-testid="toggle-simulate"><FlaskConical className="h-3.5 w-3.5" />Simulate lead reply (test the auto-reply loop)</summary>
          <div className="flex gap-2 p-3 pt-0">
            <Input placeholder={`What ${c.lead?.firstName ?? "the lead"} says...`} value={sim} onChange={(e) => setSim(e.target.value)} data-testid="input-simulate" />
            <Button variant="secondary" disabled={!sim.trim() || inbound.isPending} data-testid="button-simulate"
              onClick={() => inbound.mutate({ id, data: { body: sim } }, { onSuccess: () => { setSim(""); refresh(); toast({ title: "Inbound processed" }); } })}>
              {inbound.isPending ? "Processing..." : "Receive"}
            </Button>
          </div>
        </details>
      </div>
    </div>
  );
}
