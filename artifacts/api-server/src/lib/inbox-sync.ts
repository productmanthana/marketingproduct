import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, eq, ilike } from "drizzle-orm";
import { db, leadsTable, mailboxesTable, outreachMessagesTable, type MailboxRow } from "@workspace/db";
import { activeMailboxes } from "./delivery";
import { getOrCreateConversation, processInbound } from "./outreach";
import { logger } from "./logger";
import { bouncedRecipients, recordBounce } from "./email-check";
import { tendWarmupMail, WARMUP_HEADER } from "./warmup";

const FIRST_SYNC_DAYS = 3;

function imapClient(m: MailboxRow): ImapFlow {
  return new ImapFlow({
    host: m.imapHost!,
    port: m.imapPort,
    secure: m.imapSecure,
    auth: { user: m.imapUser || m.smtpUser, pass: m.imapPass || m.smtpPass },
    logger: false,
    socketTimeout: 30_000,
  });
}

export async function verifyImap(m: MailboxRow): Promise<void> {
  const client = imapClient(m);
  await client.connect();
  await client.logout();
}

/** Keeps only the new part of a reply: drops quoted history and "On ... wrote:" blocks. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    // Gmail often wraps "On <date> <name> <email>" and "wrote:" onto two lines.
    const header = `${line.trim()} ${lines[i + 1]?.trim() ?? ""}`;
    if (/^On .+wrote:/i.test(line.trim()) || (/^On /i.test(line.trim()) && /^On .+wrote:\s*$/i.test(header))) break;
    if (/^-{2,}\s*Original Message/i.test(line.trim()) || /^From: .+/i.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}

/** Pulls new INBOX messages since the last seen UID and runs every reply from a known lead through the AI reply loop. */
export async function syncMailbox(m: MailboxRow): Promise<number> {
  if (!m.imapHost) return 0;
  const client = imapClient(m);
  let processed = 0;
  let maxUid = m.lastUid ?? 0;
  const warmupUids: number[] = [];
  const own = (await activeMailboxes()).map((b) => b.fromEmail);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const query = m.lastUid
        ? { uid: `${m.lastUid + 1}:*` }
        : { since: new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000) };
      for await (const msg of client.fetch(query, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= (m.lastUid ?? 0)) continue;
        maxUid = Math.max(maxUid, msg.uid);
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        if (parsed.headers.has(WARMUP_HEADER)) {
          warmupUids.push(msg.uid);
          continue;
        }
        const bounced = bouncedRecipients(parsed, own);
        if (bounced.length) {
          for (const address of bounced) {
            const [lead] = await db.select().from(leadsTable).where(ilike(leadsTable.email, address)).limit(1);
            if (lead) await recordBounce(lead);
          }
          continue;
        }
        const from = parsed.from?.value[0]?.address?.toLowerCase();
        if (!from || from === m.fromEmail.toLowerCase()) continue;
        const messageId = parsed.messageId ?? null;
        if (messageId) {
          const [dupe] = await db.select({ id: outreachMessagesTable.id }).from(outreachMessagesTable).where(eq(outreachMessagesTable.externalId, messageId)).limit(1);
          if (dupe) continue;
        }
        const [lead] = await db.select().from(leadsTable).where(ilike(leadsTable.email, from)).limit(1);
        if (!lead) continue;
        const body = stripQuoted(parsed.text ?? "");
        if (!body) continue;
        const conv = await getOrCreateConversation(lead, "email", lead.campaignId, parsed.subject ?? null);
        await processInbound(conv.id, { body, subject: parsed.subject ?? null, externalId: messageId });
        processed++;
      }
    } finally {
      lock.release();
    }
    if (m.warmupEnabled) await tendWarmupMail(client, m, warmupUids);
  } finally {
    await client.logout().catch(() => undefined);
  }
  await db
    .update(mailboxesTable)
    .set({ lastUid: maxUid || m.lastUid, lastSyncAt: new Date(), lastError: null })
    .where(eq(mailboxesTable.id, m.id));
  return processed;
}

export async function syncAllMailboxes(): Promise<{ mailboxes: number; newReplies: number; errors: string[] }> {
  const boxes = (await activeMailboxes()).filter((m) => m.imapHost);
  let newReplies = 0;
  const errors: string[] = [];
  for (const m of boxes) {
    try {
      newReplies += await syncMailbox(m);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      errors.push(`${m.label}: ${error}`);
      await db.update(mailboxesTable).set({ lastError: error, lastSyncAt: new Date() }).where(and(eq(mailboxesTable.id, m.id)));
    }
  }
  return { mailboxes: boxes.length, newReplies, errors };
}

/** Background reply detection: checks every mailbox with IMAP settings right after start, then every 30 seconds. */
export function startInboxSync(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncAllMailboxes();
      if (r.newReplies || r.errors.length) logger.info(r, "Mailbox sync");
    } catch (err) {
      logger.error({ err }, "Mailbox sync failed");
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, 30_000);
}
