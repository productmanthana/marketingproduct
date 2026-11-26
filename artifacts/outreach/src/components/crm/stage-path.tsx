import { Check } from "lucide-react";
import type { DealStage } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { OPEN_STAGES, stageMeta } from "./format";

/** Chevron path of the open stages plus a final "Closed" step, like a CRM opportunity path. */
export function StagePath({ stage, onSelect, disabled }: { stage: DealStage; onSelect: (s: DealStage) => void; disabled?: boolean }) {
  const closed = stage.startsWith("closed_");
  const idx = closed ? OPEN_STAGES.length : OPEN_STAGES.findIndex((s) => s.id === stage);
  const steps = [...OPEN_STAGES.map((s) => ({ id: s.id, label: s.label })), { id: stage === "closed_lost" ? "closed_lost" : "closed_won", label: closed ? stageMeta(stage).label : "Closed" }];
  return (
    <div className="flex w-full overflow-x-auto" role="list" data-testid="stage-path">
      {steps.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        const lost = current && s.id === "closed_lost";
        const isCloseStep = i === OPEN_STAGES.length;
        return (
          <button key={s.id} role="listitem" type="button" disabled={disabled || isCloseStep}
            onClick={() => onSelect(s.id as DealStage)} data-testid={`path-stage-${s.id}`}
            className={cn(
              "relative -ml-2 flex h-9 min-w-[120px] flex-1 items-center justify-center gap-1.5 px-5 text-xs font-semibold transition-colors first:ml-0 first:rounded-l-full last:rounded-r-full",
              "[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%,12px_50%)] first:[clip-path:polygon(0_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,0_100%)] last:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%,12px_50%)]",
              done && "bg-[hsl(var(--ch-linkedin)/.18)] text-[hsl(var(--ch-linkedin))] hover:bg-[hsl(var(--ch-linkedin)/.28)]",
              current && (lost ? "bg-destructive text-destructive-foreground" : closed ? "bg-[hsl(var(--ch-linkedin))] text-white" : "bg-foreground text-background"),
              !done && !current && "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground",
              isCloseStep && "cursor-default",
            )}>
            {done && <Check className="h-3.5 w-3.5" />}{s.label}
          </button>
        );
      })}
    </div>
  );
}
