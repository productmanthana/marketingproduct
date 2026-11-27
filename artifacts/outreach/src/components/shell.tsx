import { Fragment, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutGrid, Send, Users, Inbox, PhoneCall, Settings, Radar, CheckSquare, Telescope, KanbanSquare, Building2, BarChart3, CalendarClock } from "lucide-react";
import { ViewingAsSelect } from "@/components/viewing-as";
import { GlobalSearch } from "@/components/global-search";
import { useGetDashboardSummary, useGetSettings } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/find-leads", label: "Find leads", icon: Telescope },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "needsReview" as const },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/meetings", label: "Meetings", icon: CalendarClock },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, badge: "openTasks" as const },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, group: "CRM" },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings, group: "Workspace" },
];

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { data: sum } = useGetDashboardSummary();
  const { data: settings } = useGetSettings();
  const auto = settings?.globalAutoReply;
  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className="sticky top-0 z-30 flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:h-[100dvh] md:w-[220px]">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Radar className="h-4 w-4" /></div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold text-sidebar-accent-foreground">Outreach</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-primary">Autopilot</div>
          </div>
        </div>
        <GlobalSearch />
        <ViewingAsSelect />
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-y-auto md:pb-0">
          {NAV.map((n) => {
            const active = n.href === "/" ? loc === "/" : loc.startsWith(n.href) || (n.href === "/pipeline" && loc.startsWith("/deals"));
            const I = n.icon;
            return (
              <Fragment key={n.href}>
              {"group" in n && <div className="hidden px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45 md:block">{n.group}</div>}
              <Link href={n.href} data-testid={`link-nav-${n.label.toLowerCase()}`}
                className={cn("group relative flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
                {active && <span className="absolute left-0 top-2 bottom-2 hidden w-[3px] rounded-r bg-sidebar-primary md:block" />}
                <I className="h-4 w-4" />
                <span className="flex-1">{n.label}</span>
                {n.badge && !!sum?.[n.badge] && <span className="rounded-full bg-sidebar-primary px-1.5 font-mono text-[10px] text-sidebar-primary-foreground" data-testid={`badge-${n.badge}`}>{sum[n.badge]}</span>}
              </Link>
              </Fragment>
            );
          })}
        </nav>
        <div className="mt-auto hidden p-4 md:block">
          <Link href="/settings" className="block rounded-lg border border-sidebar-border p-3 text-xs" data-testid="link-autopilot-status">
            <div className="flex items-center gap-2 font-mono uppercase tracking-wider">
              <span className={cn("h-2 w-2 rounded-full", auto ? "bg-[hsl(var(--ch-linkedin))] pulse-dot" : "bg-sidebar-foreground/40")} />
              {auto ? "Autopilot engaged" : "Autopilot off"}
            </div>
            <div className="mt-1.5 text-sidebar-foreground/60">{sum ? `${sum.aiRepliesSent} AI replies sent` : "Connecting..."}</div>
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
