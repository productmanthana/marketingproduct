import { History } from "lucide-react";
import type { Activity } from "@workspace/api-client-react";
import { Empty, ago, chColor, label, type Ch } from "@/components/bits";

const CRM_COLORS: Record<string, string> = {
  deal_won: "hsl(var(--ch-linkedin))",
  deal_lost: "hsl(var(--destructive))",
  deal_created: "hsl(265 60% 55%)",
  deal_stage_changed: "hsl(265 60% 55%)",
  note_added: "hsl(var(--foreground))",
  ai_reply: "hsl(var(--primary))",
};

export function Timeline({ activity, showLead }: { activity: Activity[]; showLead?: boolean }) {
  if (!activity.length) return <Empty icon={History} title="Nothing yet" />;
  return (
    <ol className="relative p-4 pl-8">
      <span className="absolute bottom-4 left-[19px] top-4 w-px bg-border" />
      {activity.map((a, i) => (
        <li key={a.id} className="rise relative pb-3" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
          <span className="absolute -left-[17px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card"
            style={{ background: CRM_COLORS[a.type] ?? (a.channel ? chColor(a.channel as Ch) : "hsl(var(--muted-foreground))") }} />
          <div className="text-sm">{a.description}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{label(a.type)}{showLead && a.leadName ? ` · ${a.leadName}` : ""} · {ago(a.createdAt)}</div>
        </li>
      ))}
    </ol>
  );
}
