import type { SettingsRow } from "@workspace/db";
import { summarizeTimes, type FreeSlots } from "./calendar";

/**
 * Cal.com scheduling through its v2 API with a personal API key (cal.com -> Settings -> Developer -> API Keys).
 * Availability and the video link come from the user's Cal.com setup, which can itself sync Google/Outlook calendars.
 */

const API = "https://api.cal.com/v2";

export const calcomConnected = (s: SettingsRow) => !!s.calcomApiKey && !!s.calcomEventTypeId;

async function cal<T>(apiKey: string, path: string, version: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, "cal-api-version": version, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok || data.status === "error") {
    throw new Error(`Cal.com ${res.status}: ${data.error?.message ?? data.message ?? "request failed"}`);
  }
  return data.data as T;
}

export type CalcomEventType = { id: number; title: string; slug: string | null; length: number };

export async function listEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await cal<any>(apiKey, "/event-types", "2024-06-14");
  // Newer versions return a flat list; older ones group event types by owner.
  const list: any[] = Array.isArray(data) ? data : (data?.eventTypeGroups ?? []).flatMap((g: any) => g.eventTypes ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
  return list.map((e) => ({ id: Number(e.id), title: String(e.title ?? e.slug ?? `Event ${e.id}`), slug: e.slug ?? null, length: Number(e.lengthInMinutes ?? e.length ?? 30) }));
}

/** Free start times for the chosen meeting type over the next `days` days, keyed "YYYY-MM-DD HH:MM" in the user's time zone. */
export async function calcomFreeSlots(s: SettingsRow, days = 7): Promise<FreeSlots> {
  const tz = s.timezone || "UTC";
  const start = new Date(Date.now() + 3 * 60 * 60_000);
  const end = new Date(Date.now() + days * 24 * 60 * 60_000);
  const q = new URLSearchParams({ eventTypeId: String(s.calcomEventTypeId), start: start.toISOString(), end: end.toISOString(), timeZone: tz });
  const data = await cal<Record<string, { start: string }[]>>(s.calcomApiKey, `/slots?${q}`, "2024-09-04");
  const slots = new Map<string, Date>();
  const byDay = new Map<string, string[]>();
  for (const [day, list] of Object.entries(data ?? {})) {
    for (const slot of list) {
      // "2033-09-05T09:00:00.000+02:00" is already local to `tz`; keep the wall-clock part as the key.
      const m = slot.start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      const time = `${m[2]}:${m[3]}`;
      slots.set(`${m[1]} ${time}`, new Date(slot.start));
      const label = `${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} (${day})`;
      byDay.set(label, [...(byDay.get(label) ?? []), time]);
    }
  }
  // Ranges keep the prompt short while still covering the whole day.
  const summary = [...byDay].map(([d, times]) => `${d}: ${summarizeTimes(times)}`).join("\n");
  return { timezone: tz, slots, summary };
}

export async function calcomBook(
  s: SettingsRow,
  args: { start: Date; attendeeEmail: string; attendeeName: string; attendeeTimezone: string | null },
): Promise<{ uid: string | null; meetLink: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await cal<any>(s.calcomApiKey, "/bookings", "2024-08-13", {
    method: "POST",
    body: JSON.stringify({
      start: args.start.toISOString(),
      eventTypeId: s.calcomEventTypeId,
      attendee: { name: args.attendeeName, email: args.attendeeEmail, timeZone: args.attendeeTimezone || s.timezone || "UTC" },
    }),
  });
  return bookingResult(data);
}

/** Moves an existing Cal.com booking to a new start; Cal.com emails the updated invite. */
export async function calcomReschedule(s: SettingsRow, uid: string, start: Date): Promise<{ uid: string | null; meetLink: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await cal<any>(s.calcomApiKey, `/bookings/${encodeURIComponent(uid)}/reschedule`, "2024-08-13", {
    method: "POST",
    body: JSON.stringify({ start: start.toISOString(), reschedulingReason: "Requested by the prospect" }),
  });
  return bookingResult(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bookingResult(data: any): { uid: string | null; meetLink: string | null } {
  const booking = Array.isArray(data) ? data[0] : data;
  const link = booking?.meetingUrl ?? (typeof booking?.location === "string" && /^https?:/.test(booking.location) ? booking.location : null);
  return { uid: booking?.uid ?? null, meetLink: link };
}
