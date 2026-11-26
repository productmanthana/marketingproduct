// How long to wait before a follow-up goes out, stored as days + extra hours.
export type Wait = { delayDays: number; delayHours: number };

export const PRESETS: Array<{ label: string } & Wait> = [
  { label: "No wait", delayDays: 0, delayHours: 0 },
  { label: "1 hour", delayDays: 0, delayHours: 1 },
  { label: "3 hours", delayDays: 0, delayHours: 3 },
  { label: "6 hours", delayDays: 0, delayHours: 6 },
  { label: "12 hours", delayDays: 0, delayHours: 12 },
  { label: "1 day", delayDays: 1, delayHours: 0 },
  { label: "2 days", delayDays: 2, delayHours: 0 },
  { label: "3 days", delayDays: 3, delayHours: 0 },
  { label: "5 days", delayDays: 5, delayHours: 0 },
  { label: "1 week", delayDays: 7, delayHours: 0 },
  { label: "2 weeks", delayDays: 14, delayHours: 0 },
];

const totalHours = (w: Wait) => w.delayDays * 24 + w.delayHours;

export function waitLabel(w: Wait) {
  const h = totalHours(w);
  const preset = PRESETS.find((p) => totalHours(p) === h);
  if (preset) return preset.label;
  const parts = [w.delayDays && `${w.delayDays} day${w.delayDays === 1 ? "" : "s"}`, w.delayHours && `${w.delayHours} hour${w.delayHours === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(" ");
}

export function WaitPicker({ value, onChange, disabled, className = "", testId }: { value: Wait; onChange: (w: Wait) => void; disabled?: boolean; className?: string; testId?: string }) {
  const h = totalHours(value);
  const known = PRESETS.some((p) => totalHours(p) === h);
  return (
    <select className={`h-8 rounded-md border border-input bg-card px-2 text-sm font-medium ${className}`} value={h} disabled={disabled} data-testid={testId}
      onChange={(e) => { const n = Number(e.target.value); onChange({ delayDays: Math.floor(n / 24), delayHours: n % 24 }); }}>
      {!known && <option value={h}>{waitLabel(value)}</option>}
      {PRESETS.map((p) => <option key={p.label} value={totalHours(p)}>{p.label}</option>)}
    </select>
  );
}
