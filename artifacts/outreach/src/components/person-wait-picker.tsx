import { PRESETS } from "@/components/wait-picker";

const GROUP = "group";

// One person's wait before message 1. "Same as everyone" follows the group pace below the list.
export function PersonWaitPicker({ hours, onChange, disabled, testId }: { hours: number | null | undefined; onChange: (h: number | null) => void; disabled?: boolean; testId?: string }) {
  const value = hours == null ? GROUP : String(hours);
  const known = hours == null || PRESETS.some((p) => p.delayDays * 24 + p.delayHours === hours);
  return (
    <select className="h-7 rounded-md border border-input bg-card px-2 text-xs font-medium" value={value} disabled={disabled} data-testid={testId}
      title="How long this person waits for message 1 after you press Start sending"
      onChange={(e) => onChange(e.target.value === GROUP ? null : Number(e.target.value))}>
      <option value={GROUP}>Same as everyone</option>
      {!known && <option value={value}>{hours} hours</option>}
      {PRESETS.map((p) => <option key={p.label} value={p.delayDays * 24 + p.delayHours}>{p.label}</option>)}
    </select>
  );
}
