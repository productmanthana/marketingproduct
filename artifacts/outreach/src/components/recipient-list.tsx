import { Link } from "wouter";
import type { Lead } from "@workspace/api-client-react";
import { Initials } from "@/components/bits";

export function RecipientList({ leads }: { leads: Lead[] }) {
  if (!leads.length) return null;
  return (
    <div className="rounded-lg border border-border" data-testid="list-recipients">
      <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
        Who will receive it ({leads.length})
      </div>
      <div className="max-h-72 divide-y divide-border overflow-y-auto">
        {leads.map((l) => (
          <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40" data-testid={`recipient-${l.id}`}>
            <Initials name={`${l.firstName} ${l.lastName}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{`${l.firstName} ${l.lastName}`.trim() || "No name"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[l.title, l.company].filter(Boolean).join(" at ") || "No company"}
              </div>
            </div>
            <div className="hidden min-w-0 text-right text-xs text-muted-foreground sm:block">
              {l.email && <div className="truncate">{l.email}</div>}
              {l.phone && <div className="truncate">{l.phone}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
