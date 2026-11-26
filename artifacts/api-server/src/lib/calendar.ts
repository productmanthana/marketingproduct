import { randomUUID } from "node:crypto";
import type { SettingsRow } from "@workspace/db";

/**
 * Google Calendar auto-scheduling: OAuth connect, free/busy lookup and booking an event with a Meet link.
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Google Cloud "Web application" OAuth client).
 */

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const API = "https://www.googleapis.com/calendar/v3";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const calendarConnected = (s: SettingsRow) => googleConfigured() && !!s.googleRefreshToken;
export const redirectUri = (origin: string) => `${origin}/api/calendar/google/callback`;

// ---------- OAuth ----------

/** One-time `state` values for in-flight consent screens, mapped to the browser origin that started them. */
const pending = new Map<string, { origin: string; expires: number }>();

export function consentUrl(origin: string): string {
  const state = randomUUID();
  pending.set(state, { origin, expires: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Validates the state and returns the origin the flow started from (or null when unknown/expired). */
export function takeState(state: string): string | null {
  const entry = pending.get(state);
  pending.delete(state);
  return entry && entry.expires > Date.now() ? entry.origin : null;
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; id_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`Google token error: ${data.error_description ?? data.error ?? res.status}`);
  return data;
}

export async function exchangeCode(code: string, origin: string): Promise<{ refreshToken: string; email: string }> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token");
  const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${t.access_token}` },
  }).then((r) => r.json() as Promise<{ email?: string }>);
  return { refreshToken: t.refresh_token, email: info.email ?? "" };
}

export async function revoke(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
}

async function google<T>(s: SettingsRow, path: string, body: unknown): Promise<T> {
  const { access_token } = await tokenRequest({ refresh_token: s.googleRefreshToken, grant_type: "refresh_token" });
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`Google Calendar error: ${data.error?.message ?? res.status}`);
  return data as T;
}

// ---------- time zone helpers ----------

function zoneParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
}

/** The instant when the wall clock in `tz` shows the given local date and time. */
function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = zoneParts(new Date(guess), tz);
  const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - guess;
  return new Date(guess - offset);
}

const pad = (n: number) => String(n).padStart(2, "0");

// ---------- availability and booking ----------

export type FreeSlots = {
  timezone: string;
  /** "YYYY-MM-DD HH:MM" (local to `timezone`) -> slot start instant */
  slots: Map<string, Date>;
  /** Compact per-day listing for the AI prompt. */
  summary: string;
};

/** Free meeting start times on the next weekdays, inside meeting hours, that don't clash with busy calendar events. */
export async function findFreeSlots(s: SettingsRow, days = 7): Promise<FreeSlots> {
  const tz = s.timezone || "UTC";
  const minutes = s.meetingMinutes;
  const earliest = Date.now() + 3 * 60 * 60_000;
  const today = zoneParts(new Date(), tz);

  const candidates: { key: string; label: string; time: string; start: Date }[] = [];
  for (let i = 0, found = 0; found < days && i < days * 2; i++) {
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    found++;
    const [y, mo, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const label = day.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    for (let m = s.meetingStartHour * 60; m + minutes <= s.meetingEndHour * 60; m += 30) {
      const start = zonedInstant(y, mo, d, Math.floor(m / 60), m % 60, tz);
      if (start.getTime() < earliest) continue;
      const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      candidates.push({ key: `${y}-${pad(mo)}-${pad(d)} ${time}`, label: `${label} (${y}-${pad(mo)}-${pad(d)})`, time, start });
    }
  }
  if (!candidates.length) return { timezone: tz, slots: new Map(), summary: "" };

  const fb = await google<{ calendars: { primary?: { busy: { start: string; end: string }[] } } }>(s, "/freeBusy", {
    timeMin: candidates[0]!.start.toISOString(),
    timeMax: new Date(candidates.at(-1)!.start.getTime() + minutes * 60_000).toISOString(),
    items: [{ id: "primary" }],
  });
  const busy = (fb.calendars.primary?.busy ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const free = candidates.filter((c) => {
    const a = c.start.getTime();
    const b = a + minutes * 60_000;
    return !busy.some(([bs, be]) => a < be && b > bs);
  });

  const byDay = new Map<string, string[]>();
  for (const c of free) byDay.set(c.label, [...(byDay.get(c.label) ?? []), c.time]);
  return {
    timezone: tz,
    slots: new Map(free.map((c) => [c.key, c.start])),
    summary: [...byDay].map(([day, times]) => `${day}: ${times.join(", ")}`).join("\n"),
  };
}

/** Creates the event on the connected calendar with a Google Meet link; Google emails the invite to the attendee. */
export async function bookMeeting(
  s: SettingsRow,
  args: { start: Date; attendeeEmail: string | null; attendeeName: string; summary: string; description: string },
): Promise<{ htmlLink: string; meetLink: string | null }> {
  const end = new Date(args.start.getTime() + s.meetingMinutes * 60_000);
  const event = await google<{ htmlLink: string; hangoutLink?: string }>(
    s,
    "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.start.toISOString(), timeZone: s.timezone || "UTC" },
      end: { dateTime: end.toISOString(), timeZone: s.timezone || "UTC" },
      attendees: args.attendeeEmail ? [{ email: args.attendeeEmail, displayName: args.attendeeName }] : [],
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  );
  return { htmlLink: event.htmlLink, meetLink: event.hangoutLink ?? null };
}
