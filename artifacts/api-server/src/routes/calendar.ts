import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable, type SettingsRow } from "@workspace/db";
import { ConnectCalendarBody, GetCalendarResponse, UpdateCalendarBody } from "@workspace/api-zod";
import { getSettings } from "../lib/outreach";
import { calendarConnected, consentUrl, exchangeCode, googleConfigured, revoke, takeState } from "../lib/calendar";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const status = (s: SettingsRow) =>
  GetCalendarResponse.parse({
    configured: googleConfigured(),
    connected: calendarConnected(s),
    email: s.googleEmail,
    meetingStartHour: s.meetingStartHour,
    meetingEndHour: s.meetingEndHour,
    meetingMinutes: s.meetingMinutes,
    timezone: s.timezone,
  });

router.get("/calendar", async (_req, res): Promise<void> => {
  res.json(status(await getSettings()));
});

router.put("/calendar", async (req, res): Promise<void> => {
  const parsed = UpdateCalendarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await getSettings();
  const [row] = await db.update(settingsTable).set(parsed.data).where(eq(settingsTable.id, 1)).returning();
  res.json(status(row!));
});

router.delete("/calendar", async (_req, res): Promise<void> => {
  const s = await getSettings();
  if (s.googleRefreshToken) await revoke(s.googleRefreshToken);
  const [row] = await db
    .update(settingsTable)
    .set({ googleRefreshToken: "", googleEmail: "" })
    .where(eq(settingsTable.id, 1))
    .returning();
  res.json(status(row!));
});

router.post("/calendar/connect", async (req, res): Promise<void> => {
  const parsed = ConnectCalendarBody.safeParse(req.body);
  if (!parsed.success || !/^https?:\/\/[^/\s]+$/.test(parsed.data.origin)) {
    res.status(400).json({ error: "A valid origin is required" });
    return;
  }
  if (!googleConfigured()) {
    res.status(400).json({ error: "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first" });
    return;
  }
  res.json({ url: consentUrl(parsed.data.origin) });
});

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, text: string, origin: string | null) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px;text-align:center">` +
  `<h2>${title}</h2><p>${esc(text)}</p>${origin ? `<p><a href="${esc(origin)}/settings">Back to Settings</a></p>` : ""}` +
  `<script>setTimeout(()=>window.close(),1500)</script></body>`;

router.get("/calendar/google/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const origin = state ? takeState(state) : null;
  if (error || !code || !origin) {
    res.status(400).send(page("Google Calendar not connected", error ? `Google said: ${error}` : "This link expired. Start again from Settings.", origin));
    return;
  }
  try {
    const { refreshToken, email } = await exchangeCode(code, origin);
    await getSettings();
    await db.update(settingsTable).set({ googleRefreshToken: refreshToken, googleEmail: email }).where(eq(settingsTable.id, 1));
    res.send(page("Google Calendar connected", `Connected ${email}. You can close this tab.`, origin));
  } catch (err) {
    logger.error({ err }, "Google Calendar connect failed");
    res.status(500).send(page("Google Calendar not connected", (err as Error).message, origin));
  }
});

export default router;
