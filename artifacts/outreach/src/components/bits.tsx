import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Mail, Linkedin, Phone, Sparkles, AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type Ch = "email" | "linkedin" | "call";
export const CH: Record<Ch, { label: string; icon: typeof Mail; var: string }> = {
  email: { label: "Email", icon: Mail, var: "--ch-email" },
  linkedin: { label: "LinkedIn", icon: Linkedin, var: "--ch-linkedin" },
  call: { label: "Call", icon: Phone, var: "--ch-call" },
};
export const chColor = (c: Ch, a = 1) => `hsl(var(${CH[c].var}) / ${a})`;

export function ChannelTag({ channel, compact }: { channel: Ch; compact?: boolean }) {
  const m = CH[channel];
  const I = m.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: chColor(channel), background: chColor(channel, 0.1), boxShadow: `inset 0 0 0 1px ${chColor(channel, 0.25)}` }}
      data-testid={`tag-channel-${channel}`}
    >
      <I className="h-3 w-3" />
      {!compact && m.label}
    </span>
  );
}

export function ChannelDot({ channel }: { channel: Ch }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: chColor(channel) }} />;
}

const TONES: Record<string, string> = {
  new: "bg-secondary text-secondary-foreground",
  contacted: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  replied: "bg-[hsl(var(--ch-linkedin)/.12)] text-[hsl(var(--ch-linkedin))]",
  interested: "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]",
  meeting_booked: "bg-primary text-primary-foreground",
  not_interested: "bg-muted text-muted-foreground line-through decoration-1",
  unsubscribed: "bg-muted text-muted-foreground",
  draft: "bg-secondary text-secondary-foreground",
  active: "bg-[hsl(var(--ch-linkedin)/.14)] text-[hsl(var(--ch-linkedin))]",
  paused: "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]",
  completed: "bg-foreground text-background",
  open: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  auto_replied: "bg-accent text-accent-foreground",
  needs_review: "bg-destructive/10 text-destructive",
  closed: "bg-muted text-muted-foreground",
  scheduled: "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]",
  no_answer: "bg-muted text-muted-foreground",
  positive: "bg-[hsl(var(--ch-linkedin)/.12)] text-[hsl(var(--ch-linkedin))]",
  neutral: "bg-secondary text-secondary-foreground",
  negative: "bg-destructive/10 text-destructive",
  objection: "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]",
  out_of_office: "bg-muted text-muted-foreground",
  unsubscribe: "bg-destructive/10 text-destructive",
  not_now: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  referral: "bg-accent text-accent-foreground",
  snoozed: "bg-muted text-muted-foreground",
  nurture: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  bounced: "bg-destructive/10 text-destructive",
  blocked: "bg-destructive/10 text-destructive",
  valid: "bg-[hsl(var(--ch-linkedin)/.12)] text-[hsl(var(--ch-linkedin))]",
  risky: "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]",
  invalid: "bg-destructive/10 text-destructive",
  canceled: "bg-muted text-muted-foreground line-through decoration-1",
  no_show: "bg-destructive/10 text-destructive",
  sent: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  accepted: "bg-primary text-primary-foreground",
  declined: "bg-muted text-muted-foreground line-through decoration-1",
  prospect: "bg-[hsl(var(--ch-email)/.1)] text-[hsl(var(--ch-email))]",
  customer: "bg-[hsl(var(--ch-linkedin)/.14)] text-[hsl(var(--ch-linkedin))]",
  partner: "bg-accent text-accent-foreground",
  churned: "bg-muted text-muted-foreground",
};
export const label = (s: string) => s.replace(/_/g, " ");

export function Pill({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", TONES[value] ?? "bg-secondary", className)} data-testid={`status-${value}`}>
      {value === "active" && <span className="h-1.5 w-1.5 rounded-full bg-current pulse-dot" />}
      {label(value)}
    </span>
  );
}

export const ago = (d?: string | null) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : "never");
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 pb-5 pt-7 md:px-8">
      <div className="rise">
        {eyebrow && <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-bold md:text-[34px]">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Panel({ title, action, children, className, delay = 0 }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  return (
    <section className={cn("rise rounded-xl border border-card-border bg-card shadow-[0_1px_0_hsl(var(--border)),0_8px_24px_-16px_hsl(228_40%_12%/.25)]", className)} style={{ animationDelay: `${delay}ms` }}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon: I, title, body, children }: { icon: typeof Mail; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="grid-paper flex flex-col items-center justify-center rounded-lg px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-border bg-card shadow-sm">
        <I className="h-5 w-5 text-primary" />
      </div>
      <div className="font-display text-lg font-bold">{title}</div>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Rows({ n = 5, h = 44 }: { n?: number; h?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="scanbar rounded-md bg-muted" style={{ height: h, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="m-4 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <AlertTriangle className="h-4 w-4 text-destructive" />
      <span className="flex-1">Couldn't load this. The server may be waking up.</span>
      <button onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-destructive hover:underline" data-testid="button-retry">
        <RotateCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  );
}

export function AiWorking({ text }: { text: string }) {
  return (
    <div className="rise flex items-center gap-3 rounded-lg border border-primary/25 bg-accent/60 px-4 py-3 text-sm text-accent-foreground">
      <Sparkles className="h-4 w-4 animate-spin [animation-duration:2.4s]" />
      <span className="font-medium">{text}</span>
      <span className="ml-auto flex gap-1">
        {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" style={{ animationDelay: `${i * 0.18}s` }} />)}
      </span>
    </div>
  );
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const i = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-foreground font-mono text-[11px] font-medium text-background", className)}>{i}</span>;
}

export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export const TONE_OPTIONS = ["friendly", "professional", "direct", "consultative", "playful"];

/** The server's error message from a failed API call. */
export const errMsg = (e: unknown, fallback = "Something went wrong") =>
  (e as { data?: { error?: string } } | null)?.data?.error ?? (e instanceof Error ? e.message : fallback);
