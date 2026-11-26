// Whether everyone gets message 1 at the same time, or one person at a time with a gap between them.
const GAPS = [
  { label: "Everyone at the same time", minutes: 0 },
  { label: "One person every 5 minutes", minutes: 5 },
  { label: "One person every 15 minutes", minutes: 15 },
  { label: "One person every 30 minutes", minutes: 30 },
  { label: "One person every hour", minutes: 60 },
  { label: "One person every 3 hours", minutes: 180 },
  { label: "One person every day", minutes: 1440 },
];

export function gapLabel(minutes: number) {
  return GAPS.find((g) => g.minutes === minutes)?.label.toLowerCase() ?? `one person every ${minutes} minutes`;
}

export function SendPace({ minutes, people, onChange, disabled }: { minutes: number; people: number; onChange: (m: number) => void; disabled?: boolean }) {
  const lastIn = minutes * Math.max(people - 1, 0);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-4 py-3 text-sm" data-testid="panel-send-pace">
      <span className="font-medium">How should they get message 1?</span>
      <select className="h-8 rounded-md border border-input bg-card px-2 text-sm font-medium" value={minutes} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} data-testid="select-send-pace">
        {!GAPS.some((g) => g.minutes === minutes) && <option value={minutes}>{gapLabel(minutes)}</option>}
        {GAPS.map((g) => <option key={g.minutes} value={g.minutes}>{g.label}</option>)}
      </select>
      <span className="text-xs text-muted-foreground">
        {minutes === 0 ? "Everyone gets it together." : people > 1 ? `Spread out so it looks natural; the last person gets it about ${fmt(lastIn)} after the first.` : "Spread out so it looks natural."}
        {" "}A wait set on a person above replaces this for them. Each person's follow-ups then count from their own message.
      </span>
    </div>
  );
}

function fmt(min: number) {
  if (min < 60) return `${min} minutes`;
  if (min < 1440) return `${Math.round(min / 60)} hour${Math.round(min / 60) === 1 ? "" : "s"}`;
  const d = Math.round(min / 1440);
  return `${d} day${d === 1 ? "" : "s"}`;
}
