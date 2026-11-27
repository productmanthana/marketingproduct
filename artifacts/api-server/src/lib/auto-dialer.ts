import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { db, callsTable, leadsTable, type CallRow, type SettingsRow } from "@workspace/db";
import { startAiCall } from "./calls";
import { takeDailyQuota } from "./delivery";
import { logger } from "./logger";
import { getSettings, leadName, leadTimezone, logActivity, withinSendWindow } from "./outreach";
import { suppressionFor } from "./suppression";

const HOUR_MS = 60 * 60 * 1000;
const RETRY_DELAY_MS = 24 * HOUR_MS;

function voiceReady(s: SettingsRow): boolean {
  return !!(s.voiceApiKey && s.voicePhoneNumberId);
}

/** Dials due calls from the queue: within each person's calling hours, up to the daily limit and concurrency. */
async function dialDueCalls(): Promise<void> {
  const s = await getSettings();
  if (!s.autoDialEnabled || !voiceReady(s)) return;

  // Calls still "in progress" after an hour lost their end report; don't let them hold a slot.
  const [{ running }] = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(callsTable)
    .where(and(eq(callsTable.status, "in_progress"), eq(callsTable.mode, "ai"), gt(callsTable.scheduledAt, new Date(Date.now() - HOUR_MS))));
  let slots = s.callConcurrency - running;
  if (slots <= 0) return;

  const now = new Date();
  const due = await db
    .select({ call: callsTable, lead: leadsTable })
    .from(callsTable)
    .innerJoin(leadsTable, eq(callsTable.leadId, leadsTable.id))
    .where(and(eq(callsTable.status, "scheduled"), lte(callsTable.scheduledAt, now), isNotNull(leadsTable.phone)))
    .orderBy(asc(callsTable.scheduledAt))
    .limit(100);

  for (const { call, lead } of due) {
    if (slots <= 0) break;
    if (!withinSendWindow(s, now, leadTimezone(lead, s))) continue;
    if (await suppressionFor(lead)) {
      await db.update(callsTable).set({ status: "completed", outcome: "Skipped: on the do-not-contact list" }).where(eq(callsTable.id, call.id));
      continue;
    }
    if (!(await takeDailyQuota("calls", s.callDailyLimit))) return;
    slots--;
    try {
      await db.update(callsTable).set({ scheduledAt: now }).where(eq(callsTable.id, call.id));
      await startAiCall(call);
    } catch (err) {
      const reason = (err as Error).message;
      await db.update(callsTable).set({ status: "no_answer", outcome: `Could not dial: ${reason}` }).where(eq(callsTable.id, call.id));
      await logActivity({ type: "call_completed", description: `Auto-dial to ${leadName(lead)} failed: ${reason}`, channel: "call", leadId: lead.id });
    }
  }
}

/** After an unanswered auto-dialed call, queue one more try for the next day. */
export async function queueRetryIfUnanswered(call: CallRow): Promise<void> {
  const s = await getSettings();
  if (!s.autoDialEnabled || call.attempt >= 2) return;
  await db.insert(callsTable).values({
    leadId: call.leadId,
    campaignId: call.campaignId,
    objective: call.objective,
    script: call.script,
    status: "scheduled",
    scheduledAt: new Date(Date.now() + RETRY_DELAY_MS),
    attempt: call.attempt + 1,
  });
}

export function startAutoDialer(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dialDueCalls();
    } catch (err) {
      logger.error({ err }, "Auto-dialer tick failed");
    } finally {
      running = false;
    }
  }, 60_000);
}
