import { promises as dns } from "node:dns";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadsTable,
  outreachConversationsTable,
  outreachMessagesTable,
  type LeadRow,
} from "@workspace/db";
import type { ParsedMail } from "mailparser";
import { createTask, getSettings, leadName, logActivity } from "./outreach";
import { logger } from "./logger";

/** Email checks before sending, bounce detection from the inbox, and auto-pausing campaigns that bounce too much. */

export type EmailStatus = "valid" | "risky" | "invalid" | "bounced";

const DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|throwawaymail)\./i;
const ROLE = /^(info|sales|support|admin|contact|hello|team|office|noreply|no-reply|help|billing|marketing|careers|jobs)@/i;
const SYNTAX = /^[^\s@"()<>,;:]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const MIN_SENT_FOR_PAUSE = 20;

const mxCache = new Map<string, { ok: boolean; at: number }>();

async function domainAcceptsMail(domain: string): Promise<boolean> {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 60 * 60_000) return hit.ok;
  let ok: boolean;
  try {
    ok = (await dns.resolveMx(domain)).some((r) => r.exchange && r.exchange !== ".");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      // No MX: mail falls back to the A record, if there is one.
      ok = await dns.resolve4(domain).then((a) => a.length > 0).catch(() => false);
    } else {
      throw err; // network trouble: don't judge the address
    }
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/** Syntax, disposable/role address and mail-server (MX) check. Never contacts the recipient's server. */
export async function verifyEmail(email: string): Promise<Exclude<EmailStatus, "bounced">> {
  const e = email.trim().toLowerCase();
  if (!SYNTAX.test(e)) return "invalid";
  if (DISPOSABLE.test(e)) return "invalid";
  try {
    if (!(await domainAcceptsMail(e.split("@")[1]!))) return "invalid";
  } catch {
    return "risky";
  }
  return ROLE.test(e) ? "risky" : "valid";
}

export async function verifyLead(lead: LeadRow): Promise<EmailStatus | null> {
  if (!lead.email) return null;
  const status = await verifyEmail(lead.email);
  await db.update(leadsTable).set({ emailStatus: status, emailCheckedAt: new Date() }).where(eq(leadsTable.id, lead.id));
  return status;
}

// ---------- bounces ----------

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT = /undeliver|delivery (status notification|failure|has failed)|returned mail|failure notice|could not be delivered|mail delivery failed|address not found/i;

/** Recipient addresses a bounce message reports as failed (empty when this is not a bounce). */
export function bouncedRecipients(parsed: ParsedMail, ownAddresses: string[]): string[] {
  const from = `${parsed.from?.text ?? ""}`;
  if (!BOUNCE_FROM.test(from) && !BOUNCE_SUBJECT.test(parsed.subject ?? "")) return [];
  const text = `${parsed.text ?? ""}\n${parsed.headers.get("x-failed-recipients") ?? ""}`;
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:final-recipient:\s*rfc822;\s*|original-recipient:\s*rfc822;\s*)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const a = m[1]!.toLowerCase();
    if (!own.has(a) && !BOUNCE_FROM.test(a)) found.add(a);
  }
  return [...found];
}

/** Marks a lead's address as bounced, stops their sequence and pauses the campaign if it bounces too much. */
export async function recordBounce(lead: LeadRow): Promise<void> {
  if (lead.emailStatus === "bounced") return;
  await db
    .update(leadsTable)
    .set({ emailStatus: "bounced", status: "bounced", nextStepAt: null, emailCheckedAt: new Date() })
    .where(eq(leadsTable.id, lead.id));
  const [latest] = await db
    .select({ id: outreachMessagesTable.id })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(and(eq(outreachConversationsTable.leadId, lead.id), eq(outreachMessagesTable.direction, "outbound"), eq(outreachMessagesTable.channel, "email")))
    .orderBy(sql`${outreachMessagesTable.createdAt} desc`)
    .limit(1);
  if (latest) await db.update(outreachMessagesTable).set({ deliveryStatus: "bounced" }).where(eq(outreachMessagesTable.id, latest.id));
  await logActivity({ type: "email_bounced", description: `Email to ${leadName(lead)} (${lead.email}) bounced`, channel: "email", leadId: lead.id });
  if (lead.campaignId) await pauseIfBouncing(lead.campaignId);
}

export async function campaignBounceRate(campaignId: number): Promise<{ sent: number; bounced: number }> {
  const [row] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${outreachMessagesTable.deliveryStatus} in ('sent','bounced'))::int`,
      bounced: sql<number>`count(*) filter (where ${outreachMessagesTable.deliveryStatus} = 'bounced')::int`,
    })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(and(eq(outreachConversationsTable.campaignId, campaignId), eq(outreachMessagesTable.direction, "outbound"), eq(outreachMessagesTable.channel, "email")));
  return { sent: row?.sent ?? 0, bounced: row?.bounced ?? 0 };
}

export async function pauseIfBouncing(campaignId: number): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.bouncePausePercent) return false;
  const { sent, bounced } = await campaignBounceRate(campaignId);
  if (sent < MIN_SENT_FOR_PAUSE || (bounced / sent) * 100 < settings.bouncePausePercent) return false;
  const [c] = await db
    .update(campaignsTable)
    .set({ status: "paused" })
    .where(and(eq(campaignsTable.id, campaignId), eq(campaignsTable.status, "active")))
    .returning();
  if (!c) return false;
  const rate = Math.round((bounced / sent) * 100);
  logger.warn({ campaignId, sent, bounced }, "Campaign paused for bounces");
  await logActivity({ type: "campaign_paused", description: `${c.name} paused: ${rate}% of emails bounced (${bounced} of ${sent})` });
  await createTask({ title: `Clean the list for "${c.name}" (${rate}% bounced), then resume it`, source: "review", dueAt: new Date() });
  return true;
}
