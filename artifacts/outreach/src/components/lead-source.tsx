import { useState } from "react";
import type { LeadSource, ProspectStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const KEY = "leadSource";
export const SOURCE_LABEL: Record<"firecrawl" | "apollo", string> = { firecrawl: "Firecrawl", apollo: "Apollo" };

/** Remembered lead source choice. Falls back to "auto" when the chosen one isn't connected. */
export function useLeadSource(status: ProspectStatus | undefined) {
  const [picked, setPicked] = useState<LeadSource>(() => (localStorage.getItem(KEY) as LeadSource | null) ?? "auto");
  const set = (s: LeadSource) => { localStorage.setItem(KEY, s); setPicked(s); };
  const source: LeadSource = status && picked !== "auto" && !status[picked] ? "auto" : picked;
  return [source, set] as const;
}

/** Choose Firecrawl, Apollo, or Auto (Firecrawl first, Apollo as backup). Only connected sources are offered. */
export function LeadSourcePicker({ status, value, onChange, className }: {
  status: ProspectStatus | undefined; value: LeadSource; onChange: (s: LeadSource) => void; className?: string;
}) {
  if (!status?.configured) return null;
  const opts: { v: LeadSource; l: string }[] = [];
  if (status.firecrawl && status.apollo) opts.push({ v: "auto", l: "Auto" });
  if (status.firecrawl) opts.push({ v: "firecrawl", l: "Firecrawl" });
  if (status.apollo) opts.push({ v: "apollo", l: "Apollo" });
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)} data-testid="lead-source-picker">
      <span className="text-muted-foreground">Source</span>
      {opts.map((o) => (
        <button type="button" key={o.v} onClick={() => onChange(o.v)} data-testid={`source-${o.v}`}
          className={cn("rounded-full border px-2.5 py-0.5 font-mono transition-colors",
            (opts.length === 1 || value === o.v) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50")}>
          {o.l}
        </button>
      ))}
      {opts.length > 1 && value === "auto" && <span className="text-muted-foreground">Firecrawl first, Apollo as backup</span>}
    </div>
  );
}
