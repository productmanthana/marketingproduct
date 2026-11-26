import { useSyncExternalStore } from "react";
import { useListTeam } from "@workspace/api-client-react";

/** Which team member's leads and inbox are shown (undefined = everyone). Kept in this browser. */
const KEY = "outreach.viewingAs";
const EVENT = "viewing-as-change";

const read = () => {
  const n = Number(localStorage.getItem(KEY));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

export function setViewingAs(id?: number) {
  if (id) localStorage.setItem(KEY, String(id));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** The selected owner id, but only while that person is still on the team. */
export function useViewingAs(): number | undefined {
  const id = useSyncExternalStore(subscribe, read);
  const team = useListTeam();
  return id && team.data?.some((m) => m.id === id) ? id : undefined;
}

export function ViewingAsSelect() {
  const team = useListTeam();
  const id = useViewingAs();
  if (!team.data?.length) return null;
  return (
    <label className="mx-3 mb-2 hidden flex-col gap-1 md:flex">
      <span className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">Viewing as</span>
      <select className="h-8 rounded-md border border-sidebar-border bg-sidebar-accent px-2 text-xs text-sidebar-accent-foreground" value={id ?? ""}
        onChange={(e) => setViewingAs(Number(e.target.value) || undefined)} data-testid="select-viewing-as">
        <option value="">Whole team</option>
        {team.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </label>
  );
}
