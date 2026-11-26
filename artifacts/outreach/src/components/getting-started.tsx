import { Link } from "wouter";
import { ArrowRight, Check } from "lucide-react";

type Item = { done: boolean; title: string; body: string; href: string; cta: string };

/** Step-by-step checklist for first-time users. Hidden once every step is done. */
export function GettingStarted({ items }: { items: Item[] }) {
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;
  const nextIdx = items.findIndex((i) => !i.done);
  return (
    <section className="rise overflow-hidden rounded-xl border border-card-border bg-card" data-testid="panel-getting-started">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-display text-lg font-bold">Getting started</h2>
          <p className="text-sm text-muted-foreground">Follow these steps in order. {doneCount} of {items.length} done.</p>
        </div>
        <div className="hidden h-2 w-40 overflow-hidden rounded-full bg-muted sm:block">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-border">
        {items.map((it, i) => {
          const isNext = i === nextIdx;
          return (
            <li key={it.title} className={`flex items-center gap-3 px-4 py-3 ${isNext ? "bg-primary/5" : ""}`} data-testid={`step-getting-started-${i + 1}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${it.done ? "bg-[hsl(var(--ch-linkedin))] text-white" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {it.done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold ${it.done ? "text-muted-foreground line-through" : ""}`}>{it.title}</div>
                {!it.done && <div className="text-xs text-muted-foreground">{it.body}</div>}
              </div>
              {!it.done && (
                <Link href={it.href} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ${isNext ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-input hover:bg-muted"}`} data-testid={`link-getting-started-${i + 1}`}>
                  {it.cta}<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
