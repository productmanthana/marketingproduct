import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  db,
  accountsTable,
  dealsTable,
  leadsTable,
  type AccountRow,
  type DealRow,
  type LeadRow,
} from "@workspace/db";
import { getSettings, leadName, logActivity } from "./outreach";

export const STAGES = ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
export type Stage = (typeof STAGES)[number];
export const CLOSED_STAGES: Stage[] = ["closed_won", "closed_lost"];

/** Default win probability per stage, applied when a deal moves stage without an explicit probability. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

export const isClosed = (stage: string) => (CLOSED_STAGES as string[]).includes(stage);
export const stageLabel = (stage: string) => stage.replace("closed_", "closed ").replace("_", " ");

export async function serializeAccounts(accounts: AccountRow[]) {
  if (!accounts.length) return [];
  const ids = accounts.map((a) => a.id);
  const contacts = await db
    .select({ accountId: leadsTable.accountId, n: sql<number>`count(*)::int` })
    .from(leadsTable)
    .where(inArray(leadsTable.accountId, ids))
    .groupBy(leadsTable.accountId);
  const deals = await db
    .select({
      accountId: dealsTable.accountId,
      open: sql<number>`count(*) filter (where ${dealsTable.stage} not in ('closed_won','closed_lost'))::int`,
      pipeline: sql<number>`coalesce(sum(${dealsTable.amount}) filter (where ${dealsTable.stage} not in ('closed_won','closed_lost')), 0)::bigint`,
      won: sql<number>`coalesce(sum(${dealsTable.amount}) filter (where ${dealsTable.stage} = 'closed_won'), 0)::bigint`,
    })
    .from(dealsTable)
    .where(inArray(dealsTable.accountId, ids))
    .groupBy(dealsTable.accountId);
  return accounts.map((a) => {
    const d = deals.find((x) => x.accountId === a.id);
    return {
      ...a,
      contactCount: contacts.find((c) => c.accountId === a.id)?.n ?? 0,
      openDealCount: d?.open ?? 0,
      pipelineValue: Number(d?.pipeline ?? 0),
      wonValue: Number(d?.won ?? 0),
    };
  });
}

export async function serializeDeals(deals: DealRow[]) {
  if (!deals.length) return [];
  const accountIds = [...new Set(deals.map((d) => d.accountId).filter((x): x is number => x != null))];
  const leadIds = [...new Set(deals.map((d) => d.leadId).filter((x): x is number => x != null))];
  const accounts = accountIds.length ? await db.select({ id: accountsTable.id, name: accountsTable.name }).from(accountsTable).where(inArray(accountsTable.id, accountIds)) : [];
  const leads = leadIds.length ? await db.select().from(leadsTable).where(inArray(leadsTable.id, leadIds)) : [];
  return deals.map((d) => {
    const lead = leads.find((l) => l.id === d.leadId);
    return {
      ...d,
      accountName: accounts.find((a) => a.id === d.accountId)?.name ?? null,
      leadName: lead ? leadName(lead) : null,
    };
  });
}

/** The account named like the lead's company (case-insensitive), created from the lead's company details when missing. */
export async function findOrCreateAccountForLead(lead: LeadRow): Promise<AccountRow | null> {
  const name = lead.company?.trim();
  if (!name) return null;
  const [existing] = await db.select().from(accountsTable).where(sql`lower(${accountsTable.name}) = lower(${name})`).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(accountsTable)
    .values({
      name,
      website: lead.website,
      industry: lead.industry,
      size: lead.companySize,
      location: lead.companyLocation,
      linkedinUrl: lead.companyLinkedinUrl,
    })
    .returning();
  await logActivity({ type: "account_created", description: `Account ${name} created`, accountId: created!.id });
  return created!;
}

/** Create a deal for a lead, linking (and if needed creating) the lead's account. */
export async function createDealForLead(args: {
  lead: LeadRow;
  source: "lead_conversion" | "meeting_booked";
  name?: string;
  amount?: number;
  closeDate?: Date | null;
  stage?: Stage;
}): Promise<DealRow> {
  let accountId = args.lead.accountId;
  if (accountId == null) {
    const account = await findOrCreateAccountForLead(args.lead);
    if (account) {
      accountId = account.id;
      await db.update(leadsTable).set({ accountId }).where(eq(leadsTable.id, args.lead.id));
    }
  }
  const settings = await getSettings();
  const stage = args.stage ?? "qualification";
  const [deal] = await db
    .insert(dealsTable)
    .values({
      name: args.name?.trim() || `${args.lead.company || leadName(args.lead)} - new deal`,
      accountId,
      leadId: args.lead.id,
      stage,
      amount: args.amount ?? 0,
      probability: STAGE_PROBABILITY[stage],
      closeDate: args.closeDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ownerName: settings.senderName,
      source: args.source,
      ...(isClosed(stage) ? { closedAt: new Date() } : {}),
    })
    .returning();
  await logActivity({
    type: "deal_created",
    description: `Deal ${deal!.name} created${args.source === "meeting_booked" ? " after a booked meeting" : ""}`,
    leadId: args.lead.id,
    accountId,
    dealId: deal!.id,
  });
  return deal!;
}

/** Opens a deal when a lead books a meeting, unless the lead already has an open one. */
export async function ensureDealForBookedLead(leadId: number): Promise<void> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) return;
  const [open] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(eq(dealsTable.leadId, leadId), notInArray(dealsTable.stage, CLOSED_STAGES)))
    .limit(1);
  if (open) return;
  await createDealForLead({ lead, source: "meeting_booked" });
}
