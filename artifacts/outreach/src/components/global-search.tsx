import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Building2, KanbanSquare, Search, User } from "lucide-react";
import { useGlobalSearch } from "@workspace/api-client-react";
import type { SearchHit } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const KINDS = [
  { kind: "account", heading: "Accounts", icon: Building2, path: "/accounts" },
  { kind: "deal", heading: "Deals", icon: KanbanSquare, path: "/deals" },
  { kind: "lead", heading: "Leads & contacts", icon: User, path: "/leads" },
] as const;

/** Ctrl/Cmd + K search across accounts, deals and leads. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [, nav] = useLocation();
  const q = useGlobalSearch({ q: term }, { query: { enabled: term.length > 1 } });

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (h: SearchHit) => {
    setOpen(false);
    setText("");
    nav(`${KINDS.find((k) => k.kind === h.kind)!.path}/${h.id}`);
  };
  const hits = term.length > 1 ? (q.data ?? []) : [];

  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="button-global-search"
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-sidebar-border px-3 py-2 text-left text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
        <Search className="h-3.5 w-3.5" /><span className="flex-1">Search</span>
        <kbd className="hidden rounded border border-sidebar-border px-1 font-mono text-[10px] md:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:py-2.5">
            <CommandInput placeholder="Search accounts, deals and leads..." value={text} onValueChange={setText} data-testid="input-global-search" />
            <CommandList>
              {term.length > 1 && !q.isFetching && <CommandEmpty>No matches for "{term}".</CommandEmpty>}
              {term.length <= 1 && <div className="py-6 text-center text-sm text-muted-foreground">Type at least two letters.</div>}
              {KINDS.map(({ kind, heading, icon: I }) => {
                const items = hits.filter((h) => h.kind === kind);
                if (!items.length) return null;
                return (
                  <CommandGroup key={kind} heading={heading}>
                    {items.map((h) => (
                      <CommandItem key={`${kind}-${h.id}`} value={`${kind}-${h.id}`} onSelect={() => go(h)} data-testid={`search-hit-${kind}-${h.id}`}>
                        <I className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{h.title}</span>
                        {h.subtitle && <span className="ml-2 truncate text-xs capitalize text-muted-foreground">{h.subtitle}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
