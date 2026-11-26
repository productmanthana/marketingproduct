import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** AI fit score (0-100) against the ideal customer profile, with the reason on hover. */
export function FitBadge({ score, reason }: { score?: number | null; reason?: string | null }) {
  if (score == null) return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  const tone = score >= 70 ? "bg-[hsl(var(--ch-linkedin)/.14)] text-[hsl(var(--ch-linkedin))]" : score >= 40 ? "bg-[hsl(var(--ch-call)/.15)] text-[hsl(36_80%_32%)]" : "bg-muted text-muted-foreground";
  const badge = <span className={cn("inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium", tone)} data-testid="badge-fit">{score}</span>;
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}
