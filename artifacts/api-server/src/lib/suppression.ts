import { and, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db, leadsTable, suppressionsTable, type LeadRow } from "@workspace/db";
import { linkedinIdentifier } from "./delivery";

/** Do-not-contact list: emails, whole @domains, phone numbers and LinkedIn profiles that must never be contacted. */

export type SuppressionKind = "email" | "domain" | "phone" | "linkedin";

const digits = (v: string) => v.replace(/\D/g, "");
/** Last 10 digits, so "+1 (555) 010-2000" and "5550102000" match. */
const phoneKey = (v: string) => digits(v).slice(-10);

export function normalizeEntry(raw: string): { kind: SuppressionKind; value: string } | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("linkedin.com/")) {
    const id = linkedinIdentifier(v);
    return id ? { kind: "linkedin", value: `li:${id.toLowerCase()}` } : null;
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { kind: "email", value: v };
  const domain = v.replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { kind: "domain", value: `@${domain}` };
  if (digits(v).length >= 7) return { kind: "phone", value: `tel:${phoneKey(v)}` };
  return null;
}

/** The list keys a lead can match. */
function leadKeys(lead: Pick<LeadRow, "email" | "phone" | "linkedinUrl">): string[] {
  const keys: string[] = [];
  if (lead.email) {
    const e = lead.email.trim().toLowerCase();
    keys.push(e, `@${e.split("@")[1]}`);
  }
  if (lead.phone && digits(lead.phone).length >= 7) keys.push(`tel:${phoneKey(lead.phone)}`);
  const li = lead.linkedinUrl ? linkedinIdentifier(lead.linkedinUrl) : null;
  if (li) keys.push(`li:${li.toLowerCase()}`);
  return keys;
}

/** The matching entry when this lead is on the do-not-contact list. */
export async function suppressionFor(lead: Pick<LeadRow, "email" | "phone" | "linkedinUrl">): Promise<string | null> {
  const keys = leadKeys(lead);
  if (!keys.length) return null;
  const [hit] = await db.select().from(suppressionsTable).where(inArray(suppressionsTable.value, keys)).limit(1);
  return hit ? hit.value.replace(/^(tel|li):/, "") : null;
}

/** Leads matching any of these entries, so their sequences can be stopped. */
async function leadsMatching(entries: { kind: SuppressionKind; value: string }[]): Promise<LeadRow[]> {
  const conds: SQL[] = [];
  for (const e of entries) {
    if (e.kind === "email") conds.push(ilike(leadsTable.email, e.value));
    if (e.kind === "domain") conds.push(ilike(leadsTable.email, `%${e.value}`));
    if (e.kind === "linkedin") conds.push(ilike(leadsTable.linkedinUrl, `%/${e.value.slice(3)}%`));
  }
  const byQuery = conds.length ? await db.select().from(leadsTable).where(or(...conds)) : [];
  const phones = new Set(entries.filter((e) => e.kind === "phone").map((e) => e.value));
  const byPhone = phones.size
    ? (await db.select().from(leadsTable)).filter((l) => l.phone && phones.has(`tel:${phoneKey(l.phone)}`))
    : [];
  return [...new Map([...byQuery, ...byPhone].map((l) => [l.id, l])).values()];
}

export async function addSuppressions(values: string[], reason: string): Promise<{ added: number; skipped: number; leadsStopped: number }> {
  const entries = [...new Map(values.map(normalizeEntry).filter((e): e is NonNullable<typeof e> => !!e).map((e) => [e.value, e])).values()];
  const inserted = entries.length
    ? await db.insert(suppressionsTable).values(entries.map((e) => ({ ...e, reason }))).onConflictDoNothing().returning()
    : [];
  const leads = await leadsMatching(entries);
  const active = leads.filter((l) => l.status !== "unsubscribed");
  if (active.length) {
    await db
      .update(leadsTable)
      .set({ status: "unsubscribed", nextStepAt: null })
      .where(and(inArray(leadsTable.id, active.map((l) => l.id))));
  }
  return { added: inserted.length, skipped: values.length - inserted.length, leadsStopped: active.length };
}

/** Puts a lead's own email and LinkedIn profile on the list (used when they unsubscribe). */
export async function suppressLead(lead: LeadRow, reason: string): Promise<void> {
  const values = [lead.email, lead.linkedinUrl].filter((v): v is string => !!v);
  if (values.length) await addSuppressions(values, reason);
}

export async function removeSuppression(id: number): Promise<boolean> {
  const rows = await db.delete(suppressionsTable).where(eq(suppressionsTable.id, id)).returning();
  return rows.length > 0;
}
