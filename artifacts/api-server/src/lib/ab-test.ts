import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  outreachConversationsTable,
  outreachMessagesTable,
  sequenceStepsTable,
  type SequenceStepRow,
} from "@workspace/db";
import { logActivity } from "./outreach";

/**
 * A/B tests on sequence steps: half the people get version A, half version B. Once both versions reached
 * AB_MIN_SENDS sends, the one with the better reply rate (open rate on a tie) wins and everyone gets it.
 */
export const AB_MIN_SENDS = 30;

export type Variant = "a" | "b";
export type VariantStat = { variant: Variant; sent: number; opened: number; replied: number };

export const hasTest = (step: SequenceStepRow) => !!step.variantTemplate?.trim();

export function variantFor(step: SequenceStepRow, leadId: number): Variant {
  if (!hasTest(step)) return "a";
  if (step.abWinner === "a" || step.abWinner === "b") return step.abWinner;
  return leadId % 2 === 0 ? "a" : "b";
}

/** Subject and template for this person's version of the step. */
export function contentFor(step: SequenceStepRow, variant: Variant): { subject: string | null; template: string } {
  if (variant === "b" && hasTest(step)) return { subject: step.variantSubject || step.subject, template: step.variantTemplate! };
  return { subject: step.subject, template: step.template };
}

/** Columns are written out in full: drizzle leaves them unqualified on single-table queries, which would bind them to `i`. */
/** Replied = the thread got an inbound message after this one went out. */
const repliedSql = sql<number>`count(*) filter (where exists (select 1 from outreach_messages i where i.conversation_id = "outreach_messages"."conversation_id" and i.direction = 'inbound' and i.created_at > "outreach_messages"."created_at"))::int`;

export async function variantStats(campaignId: number, stepOrders: number[]): Promise<Map<number, VariantStat[]>> {
  const out = new Map<number, VariantStat[]>();
  if (!stepOrders.length) return out;
  const rows = await db
    .select({
      stepOrder: outreachMessagesTable.stepOrder,
      variant: outreachMessagesTable.variant,
      sent: sql<number>`count(*)::int`,
      opened: sql<number>`count(${outreachMessagesTable.openedAt})::int`,
      replied: repliedSql,
    })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(
      and(
        eq(outreachConversationsTable.campaignId, campaignId),
        eq(outreachMessagesTable.direction, "outbound"),
        inArray(outreachMessagesTable.stepOrder, stepOrders),
        isNotNull(outreachMessagesTable.variant),
      ),
    )
    .groupBy(outreachMessagesTable.stepOrder, outreachMessagesTable.variant);
  for (const order of stepOrders) {
    const stats = (["a", "b"] as const).map((v) => {
      const r = rows.find((x) => x.stepOrder === order && x.variant === v);
      return { variant: v, sent: r?.sent ?? 0, opened: r?.opened ?? 0, replied: r?.replied ?? 0 };
    });
    out.set(order, stats);
  }
  return out;
}

/** Picks the winner once both versions have enough sends. Returns the winner, or null while the test runs. */
export async function maybePickWinner(step: SequenceStepRow, campaignName: string): Promise<Variant | null> {
  if (!hasTest(step) || step.abWinner) return null;
  const stats = (await variantStats(step.campaignId, [step.stepOrder])).get(step.stepOrder)!;
  const [a, b] = stats as [VariantStat, VariantStat];
  if (a.sent < AB_MIN_SENDS || b.sent < AB_MIN_SENDS) return null;
  const rate = (s: VariantStat, k: "replied" | "opened") => s[k] / s.sent;
  let winner: Variant | null = null;
  if (rate(a, "replied") !== rate(b, "replied")) winner = rate(a, "replied") > rate(b, "replied") ? "a" : "b";
  else if (rate(a, "opened") !== rate(b, "opened")) winner = rate(a, "opened") > rate(b, "opened") ? "a" : "b";
  if (!winner) return null;
  await db.update(sequenceStepsTable).set({ abWinner: winner }).where(eq(sequenceStepsTable.id, step.id));
  const w = winner === "a" ? a : b;
  await logActivity({
    type: "ab_winner",
    description: `${campaignName}: version ${winner.toUpperCase()} of step ${step.stepOrder} won (${Math.round((w.replied / w.sent) * 100)}% replies, ${Math.round((w.opened / w.sent) * 100)}% opens)`,
  });
  return winner;
}
