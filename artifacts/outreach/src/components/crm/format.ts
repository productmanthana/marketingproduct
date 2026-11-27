import { useGetSettings } from "@workspace/api-client-react";
import type { DealStage } from "@workspace/api-client-react";

export const STAGES: { id: DealStage; label: string; color: string; prob: number }[] = [
  { id: "prospecting", label: "Prospecting", color: "hsl(220 14% 55%)", prob: 10 },
  { id: "qualification", label: "Qualification", color: "hsl(var(--ch-email))", prob: 25 },
  { id: "proposal", label: "Proposal", color: "hsl(265 60% 55%)", prob: 50 },
  { id: "negotiation", label: "Negotiation", color: "hsl(var(--ch-call))", prob: 75 },
  { id: "closed_won", label: "Closed won", color: "hsl(var(--ch-linkedin))", prob: 100 },
  { id: "closed_lost", label: "Closed lost", color: "hsl(var(--destructive))", prob: 0 },
];
export const OPEN_STAGES = STAGES.filter((s) => !s.id.startsWith("closed_"));
export const stageMeta = (id: string) => STAGES.find((s) => s.id === id) ?? STAGES[0]!;
export const isClosedStage = (id: string) => id.startsWith("closed_");

export const ACCOUNT_TYPES = ["prospect", "customer", "partner", "churned"] as const;

export const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "JPY"];

/** Formats deal amounts in the workspace currency (Settings > Sender identity). */
export function useMoney() {
  const { data } = useGetSettings();
  const currency = data?.currency || "USD";
  const full = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  const short = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 });
  return { currency, money: (n: number) => full.format(n), compact: (n: number) => short.format(n) };
}

/** yyyy-mm-dd for a date input from an ISO string. */
export const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");
/** ISO string at noon UTC so the chosen day survives any time zone. */
export const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00Z`).toISOString() : null);
export const shortDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date";
