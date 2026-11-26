import nodemailer from "nodemailer";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  leadsTable,
  mailboxesTable,
  outreachMessagesTable,
  usageCountersTable,
  type ConversationRow,
  type LeadRow,
  type MailboxRow,
  type SettingsRow,
} from "@workspace/db";

/** Outcome of handing a message to a real provider. */
export type DeliveryResult =
  | { status: "sent"; externalId: string | null; mailboxId?: number; threadId?: string | null; note?: string }
  | { status: "recorded" }
  | { status: "failed"; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- mailboxes & warm-up ----------

/** Daily sending limit after the warm-up ramp (start + increment per day since the mailbox was added). */
export function todayLimit(m: MailboxRow): number {
  if (!m.warmupEnabled) return m.dailyLimit;
  const days = Math.floor((Date.now() - new Date(m.createdAt).getTime()) / DAY_MS);
  return Math.min(m.dailyLimit, m.warmupStart + m.warmupIncrement * days);
}

export function sentTodayOf(m: MailboxRow): number {
  return m.sentDate === today() ? m.sentToday : 0;
}

export async function activeMailboxes(): Promise<MailboxRow[]> {
  return db.select().from(mailboxesTable).where(eq(mailboxesTable.active, true));
}

/** Picks a mailbox for this thread: the thread's own mailbox first, then the least-used one with capacity. */
async function pickMailbox(preferredId: number | null, ignoreLimit: boolean): Promise<MailboxRow | null | "none"> {
  const boxes = await activeMailboxes();
  if (!boxes.length) return "none";
  const free = boxes.filter((m) => ignoreLimit || sentTodayOf(m) < todayLimit(m));
  const preferred = free.find((m) => m.id === preferredId);
  if (preferred) return preferred;
  return free.sort((a, b) => sentTodayOf(a) - sentTodayOf(b))[0] ?? null;
}

/** True when automated email may go out now: no mailbox connected (in-app mode) or one has capacity left today. */
export async function hasEmailCapacity(): Promise<boolean> {
  const boxes = await activeMailboxes();
  return !boxes.length || boxes.some((m) => sentTodayOf(m) < todayLimit(m));
}

function transportFor(m: Pick<MailboxRow, "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPass">) {
  return nodemailer.createTransport({
    host: m.smtpHost,
    port: m.smtpPort,
    secure: m.smtpSecure,
    auth: { user: m.smtpUser, pass: m.smtpPass },
    connectionTimeout: 15_000,
  });
}

export async function verifySmtp(m: MailboxRow): Promise<void> {
  await transportFor(m).verify();
}

function baseUrl(settings: SettingsRow): string {
  return settings.publicBaseUrl.replace(/\/+$/, "");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Message-IDs of the email thread, oldest first, for the In-Reply-To/References headers. */
async function threadReferences(conversationId: number, threadId: string): Promise<string[]> {
  const rows = await db
    .select({ id: outreachMessagesTable.externalId })
    .from(outreachMessagesTable)
    .where(and(eq(outreachMessagesTable.conversationId, conversationId), isNotNull(outreachMessagesTable.externalId)))
    .orderBy(asc(outreachMessagesTable.createdAt));
  const ids = rows.map((r) => r.id!).filter((id) => id.startsWith("<"));
  return [...new Set([threadId, ...ids])];
}

export async function sendEmail(args: {
  settings: SettingsRow;
  conversation: ConversationRow;
  lead: LeadRow;
  subject: string | null;
  body: string;
  trackingToken: string;
  manual: boolean;
}): Promise<DeliveryResult> {
  if (!args.lead.email) return { status: "failed", error: "Lead has no email address" };
  const box = await pickMailbox(args.conversation.mailboxId, args.manual);
  if (box === "none") return { status: "recorded" };
  if (!box) return { status: "failed", error: "Every mailbox reached today's sending limit" };

  const base = baseUrl(args.settings);
  const unsubUrl = base ? `${base}/api/unsubscribe/${args.lead.unsubscribeToken}` : null;
  let text = args.body;
  let html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(args.body).replace(/\n/g, "<br>")}</div>`;
  if (unsubUrl && args.settings.unsubscribeFooter) {
    text += `\n\n--\nDon't want to hear from me? Unsubscribe: ${unsubUrl}`;
    html += `<p style="font-size:11px;color:#888;margin-top:24px">Don't want to hear from me? <a href="${unsubUrl}">Unsubscribe</a></p>`;
  }
  if (base && args.settings.trackOpens) {
    html += `<img src="${base}/api/t/${args.trackingToken}.gif" width="1" height="1" alt="" style="display:none">`;
  }
  const threadId = args.conversation.externalThreadId;
  // Follow-ups in an existing thread keep "Re: <original subject>" and reply to the latest message,
  // otherwise Gmail/Outlook split them into a new conversation.
  const references = threadId ? await threadReferences(args.conversation.id, threadId) : [];
  const rootSubject = (args.conversation.subject ?? args.subject ?? "").replace(/^(re:\s*)+/i, "");
  const subject = threadId && rootSubject ? `Re: ${rootSubject}` : (args.subject ?? args.conversation.subject ?? "(no subject)");
  try {
    const info = await transportFor(box).sendMail({
      from: { name: box.fromName, address: box.fromEmail },
      to: args.lead.email,
      subject,
      text,
      html,
      ...(threadId ? { inReplyTo: references.at(-1), references } : {}),
      ...(unsubUrl ? { list: { unsubscribe: { url: unsubUrl, comment: "Unsubscribe" } } } : {}),
    });
    const isNewDay = box.sentDate !== today();
    await db
      .update(mailboxesTable)
      .set({ sentToday: isNewDay ? 1 : box.sentToday + 1, sentDate: today(), lastError: null })
      .where(eq(mailboxesTable.id, box.id));
    return { status: "sent", externalId: info.messageId ?? null, mailboxId: box.id, threadId: threadId ?? info.messageId ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(mailboxesTable).set({ lastError: error }).where(eq(mailboxesTable.id, box.id));
    return { status: "failed", error };
  }
}

// ---------- LinkedIn via Unipile ----------

export function unipileConfigured(s: SettingsRow): boolean {
  return !!(s.unipileDsn && s.unipileApiKey && s.unipileAccountId);
}

function unipileUrl(s: SettingsRow, path: string): string {
  const dsn = s.unipileDsn.trim().replace(/\/+$/, "");
  return `${/^https?:\/\//.test(dsn) ? dsn : `https://${dsn}`}${path}`;
}

export async function unipileFetch(s: SettingsRow, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(unipileUrl(s, path), {
    ...init,
    headers: { "X-API-KEY": s.unipileApiKey, accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Unipile ${res.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

export function linkedinIdentifier(url: string): string | null {
  const m = url.match(/linkedin\.com\/(?:in|sales\/lead|sales\/people)\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Counts one action against a per-day limit; returns false when the limit is reached. */
async function takeDailyQuota(key: string, limit: number): Promise<boolean> {
  const day = today();
  const [row] = await db.select().from(usageCountersTable).where(eq(usageCountersTable.key, key));
  const used = row && row.day === day ? row.count : 0;
  if (used >= limit) return false;
  await db
    .insert(usageCountersTable)
    .values({ key, day, count: used + 1 })
    .onConflictDoUpdate({ target: usageCountersTable.key, set: { day, count: used + 1 } });
  return true;
}

export async function linkedinQuotaLeft(s: SettingsRow): Promise<boolean> {
  if (!unipileConfigured(s)) return true;
  const [row] = await db.select().from(usageCountersTable).where(eq(usageCountersTable.key, "linkedin"));
  return !row || row.day !== today() || row.count < s.linkedinDailyLimit;
}

export async function sendLinkedIn(args: { settings: SettingsRow; lead: LeadRow; body: string }): Promise<DeliveryResult> {
  const s = args.settings;
  if (!unipileConfigured(s)) return { status: "recorded" };
  if (!args.lead.linkedinUrl) return { status: "failed", error: "Lead has no LinkedIn URL" };
  const ident = linkedinIdentifier(args.lead.linkedinUrl);
  if (!ident) return { status: "failed", error: "Could not read the LinkedIn profile id from the URL" };
  if (!(await takeDailyQuota("linkedin", s.linkedinDailyLimit))) {
    return { status: "failed", error: "LinkedIn daily limit reached" };
  }
  try {
    const profile = await unipileFetch(s, `/api/v1/users/${encodeURIComponent(ident)}?account_id=${encodeURIComponent(s.unipileAccountId)}`);
    const providerId: string = profile.provider_id;
    if (providerId && providerId !== args.lead.linkedinProviderId) {
      await db.update(leadsTable).set({ linkedinProviderId: providerId }).where(eq(leadsTable.id, args.lead.id));
    }
    const connected = profile.network_distance === "FIRST_DEGREE" || profile.is_relationship === true;
    if (connected) {
      const form = new FormData();
      form.append("account_id", s.unipileAccountId);
      form.append("attendees_ids", providerId);
      form.append("text", args.body);
      const chat = await unipileFetch(s, "/api/v1/chats", { method: "POST", body: form });
      return { status: "sent", externalId: chat.message_id ?? chat.chat_id ?? null };
    }
    // Not connected yet: send a connection request carrying the note (LinkedIn caps notes at 300 characters).
    const note = args.body.length > 300 ? `${args.body.slice(0, 297)}...` : args.body;
    const inv = await unipileFetch(s, "/api/v1/users/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider_id: providerId, account_id: s.unipileAccountId, message: note }),
    });
    return { status: "sent", externalId: inv.invitation_id ?? null, note: "connection request" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
