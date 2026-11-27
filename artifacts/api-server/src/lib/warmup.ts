import type { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { eq, sql } from "drizzle-orm";
import { db, mailboxesTable, type MailboxRow } from "@workspace/db";
import { activeMailboxes } from "./delivery";
import { getSettings, withinSendWindow } from "./outreach";
import { logger } from "./logger";

/**
 * Email warm-up between your own mailboxes: each warm-up mailbox sends a few natural emails a day to the others.
 * When a mailbox syncs it opens them, marks them important, and moves any that landed in spam back to the inbox,
 * which teaches Gmail/Outlook that your mail is wanted. Needs at least two active mailboxes.
 */

export const WARMUP_HEADER = "x-outreach-warmup";
const TICK_MIN = 15;
const TICKS_PER_DAY = (10 * 60) / TICK_MIN; // spread over a ~10 hour send window

const today = () => new Date().toISOString().slice(0, 10);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

const SUBJECTS = ["Quick question", "Notes from earlier", "Thursday works", "Re: the plan", "Following up", "Thanks for this", "Small update", "Lunch next week?", "Checking in", "That article"];
const OPENERS = ["Hi", "Hey", "Hello", "Morning"];
const LINES = [
  "Thanks for sending that over, I had a proper look this morning and it all makes sense.",
  "Just checking we're still on for later this week. Let me know if anything changes.",
  "I went through the notes from our chat and added a couple of thoughts at the end.",
  "Hope the week is going well. The numbers look better than I expected, which is nice.",
  "Could you take a quick look at the draft when you get a minute? No rush at all.",
  "Great catching up yesterday. I'll send the details over once I've tidied them up.",
  "I found that article I mentioned, it's a good read if you have ten minutes.",
  "Happy to move our call to the afternoon if that suits you better.",
];
const CLOSERS = ["Thanks!", "Cheers,", "Best,", "Talk soon,", "Speak later,"];

function warmupEmail(from: MailboxRow, toName: string) {
  const first = toName.split(" ")[0] || "there";
  const body = `${pick(OPENERS)} ${first},\n\n${pick(LINES)} ${pick(LINES)}\n\n${pick(CLOSERS)}\n${from.fromName.split(" ")[0]}`;
  return { subject: pick(SUBJECTS), body };
}

const sentTodayOf = (m: MailboxRow) => (m.warmupDate === today() ? m.warmupSentToday : 0);

/** Warm-up mailboxes that can also read their inbox (needed to rescue warm-up mail from spam). */
async function warmupPool(): Promise<MailboxRow[]> {
  return (await activeMailboxes()).filter((m) => m.warmupEnabled);
}

export async function sendWarmups(force = false): Promise<number> {
  const settings = await getSettings();
  if (!settings.warmupPerDay) return 0;
  const pool = await warmupPool();
  if (pool.length < 2) return 0;
  let sent = 0;
  for (const box of pool) {
    const done = sentTodayOf(box);
    if (done >= settings.warmupPerDay) continue;
    // Spread sends over the day instead of sending them all at once.
    if (!force && Math.random() > (settings.warmupPerDay / TICKS_PER_DAY) * 1.3) continue;
    const to = pick(pool.filter((m) => m.id !== box.id));
    const mail = warmupEmail(box, to.fromName);
    try {
      await nodemailer
        .createTransport({ host: box.smtpHost, port: box.smtpPort, secure: box.smtpSecure, auth: { user: box.smtpUser, pass: box.smtpPass }, connectionTimeout: 15_000 })
        .sendMail({ from: { name: box.fromName, address: box.fromEmail }, to: { name: to.fromName, address: to.fromEmail }, subject: mail.subject, text: mail.body, headers: { [WARMUP_HEADER]: "1" } });
      await db
        .update(mailboxesTable)
        .set({ warmupSentToday: done + 1, warmupDate: today() })
        .where(eq(mailboxesTable.id, box.id));
      sent++;
    } catch (err) {
      logger.warn({ err, mailboxId: box.id }, "Warm-up email failed");
    }
  }
  return sent;
}

/**
 * Runs during a mailbox sync while the IMAP connection is open: moves warm-up mail out of spam,
 * and marks warm-up mail in the inbox as read and important.
 */
export async function tendWarmupMail(client: ImapFlow, m: MailboxRow, inboxWarmupUids: number[]): Promise<void> {
  let rescued = 0;
  try {
    const boxes = await client.list();
    const junk = boxes.find((b) => b.specialUse === "\\Junk") ?? boxes.find((b) => /^(spam|junk)$/i.test(b.name));
    if (junk) {
      const lock = await client.getMailboxLock(junk.path);
      try {
        const uids = (await client.search({ header: { [WARMUP_HEADER]: "1" } }, { uid: true })) || [];
        if (uids.length) {
          await client.messageFlagsAdd(uids, ["\\Seen", "\\Flagged"], { uid: true });
          await client.messageMove(uids, "INBOX", { uid: true });
          rescued = uids.length;
        }
      } finally {
        lock.release();
      }
    }
  } catch (err) {
    logger.warn({ err, mailboxId: m.id }, "Warm-up spam check failed");
  }
  if (inboxWarmupUids.length) {
    const lock = await client.getMailboxLock("INBOX");
    try {
      await client.messageFlagsAdd(inboxWarmupUids, ["\\Seen", "\\Flagged"], { uid: true });
    } finally {
      lock.release();
    }
  }
  if (rescued || inboxWarmupUids.length) {
    await db
      .update(mailboxesTable)
      .set({
        // Rescued mail shows up in the inbox on the next sync, where it is counted as received.
        warmupReceived: sql`${mailboxesTable.warmupReceived} + ${inboxWarmupUids.length}`,
        warmupSpam: sql`${mailboxesTable.warmupSpam} + ${rescued}`,
      })
      .where(eq(mailboxesTable.id, m.id));
  }
}

export function startWarmup(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (withinSendWindow(await getSettings())) {
        const n = await sendWarmups();
        if (n) logger.info({ sent: n }, "Warm-up emails sent");
      }
    } catch (err) {
      logger.error({ err }, "Warm-up tick failed");
    } finally {
      running = false;
    }
  }, TICK_MIN * 60_000);
}
