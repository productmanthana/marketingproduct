import { useState } from "react";
import { Link } from "wouter";
import { useListCampaignSent } from "@workspace/api-client-react";
import type { SentItem } from "@workspace/api-client-react";
import { ChannelTag, Rows, ago, type Ch } from "@/components/bits";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ v: "all" | Ch; l: string }> = [
  { v: "all", l: "All" }, { v: "email", l: "Emails" }, { v: "linkedin", l: "LinkedIn" }, { v: "call", l: "Calls" },
];

// Plain-language status for a sent message or a call.
function statusOf(i: SentItem): { text: string; tone: string } {
  if (i.kind === "call") {
    if (i.status === "completed") return { text: "Call done", tone: "text-emerald-700" };
    if (i.status === "failed" || i.status === "no_answer") return { text: i.status === "failed" ? "Call failed" : "No answer", tone: "text-destructive" };
    return { text: i.status === "scheduled" ? "On call list" : i.status.replace("_", " "), tone: "text-muted-foreground" };
  }
  if (i.status === "failed") return { text: "Not delivered", tone: "text-destructive" };
  if (i.status === "recorded") return { text: "Saved only, not delivered", tone: "text-amber-700" };
  if (i.openedAt) return { text: `Opened ${ago(i.openedAt)}`, tone: "text-emerald-700" };
  return { text: "Delivered", tone: "text-emerald-700" };
}

// Everything this campaign sent: emails, LinkedIn messages and calls.
export function SentLog({ campaignId }: { campaignId: number }) {
  const q = useListCampaignSent(campaignId);
  const [filter, setFilter] = useState<"all" | Ch>("all");
  const [open, setOpen] = useState<string | null>(null);
  const items = (q.data ?? []).filter((i) => filter === "all" || i.channel === filter);
  const count = (c: Ch) => (q.data ?? []).filter((i) => i.channel === c).length;

  return (
    <div className="overflow-hidden rounded-lg border border-border" data-testid="panel-sent-log">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">What's been sent ({q.data?.length ?? 0})</span>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button key={f.v} type="button" onClick={() => setFilter(f.v)} data-testid={`filter-sent-${f.v}`}
              className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", filter === f.v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50")}>
              {f.l}{f.v !== "all" ? ` ${count(f.v)}` : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {q.isLoading ? <Rows n={3} h={44} /> : !items.length ? (
          <p className="p-5 text-center text-sm text-muted-foreground">Nothing sent here yet. Press Send anything due now, or wait for the schedule.</p>
        ) : items.map((i) => {
          const s = statusOf(i);
          const expanded = open === i.key;
          return (
            <div key={i.key} className="border-b border-border last:border-0" data-testid={`row-sent-${i.key}`}>
              <button type="button" onClick={() => setOpen(expanded ? null : i.key)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
                <ChannelTag channel={i.channel as Ch} compact />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{i.leadName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{i.subject || i.body || "-"}</span>
                </span>
                <span className="shrink-0 text-right text-[11px]">
                  <span className={cn("block font-medium", s.tone)}>{s.text}</span>
                  <span className="text-muted-foreground">{ago(i.createdAt)}</span>
                </span>
              </button>
              {expanded && (
                <div className="space-y-2 bg-muted/30 px-3 py-3 text-sm">
                  {i.subject && <div className="font-medium">{i.subject}</div>}
                  {i.body && <p className="whitespace-pre-wrap text-muted-foreground">{i.body}</p>}
                  {i.error && <p className="text-xs text-destructive">Why: {i.error}</p>}
                  <div className="flex gap-3 text-xs">
                    <Link href={`/leads/${i.leadId}`} className="text-primary hover:underline">Open {i.leadName}</Link>
                    <Link href={i.kind === "call" ? "/calls" : "/inbox"} className="text-primary hover:underline">{i.kind === "call" ? "Open Calls" : "Open Inbox"}</Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
