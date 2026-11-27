import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, accountsTable, activitiesTable, dealsTable, leadsTable, notesTable } from "@workspace/db";
import {
  CreateAccountBody,
  CreateAccountsFromLeadsResponse,
  DeleteAccountParams,
  GetAccountParams,
  GetAccountResponse,
  ListAccountsQueryParams,
  ListAccountsResponse,
  UpdateAccountBody,
  UpdateAccountParams,
  UpdateAccountResponse,
} from "@workspace/api-zod";
import { findOrCreateAccountForLead, serializeAccounts, serializeDeals } from "../lib/crm";
import { leadName, logActivity, serializeLeads } from "../lib/outreach";

const router: IRouter = Router();

router.get("/accounts", async (req, res): Promise<void> => {
  const q = ListAccountsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [];
  if (q.data.type) conds.push(eq(accountsTable.type, q.data.type));
  if (q.data.search) {
    const s = `%${q.data.search}%`;
    conds.push(or(ilike(accountsTable.name, s), ilike(accountsTable.website, s), ilike(accountsTable.industry, s), ilike(accountsTable.location, s))!);
  }
  const rows = await db
    .select()
    .from(accountsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(accountsTable.name));
  res.json(ListAccountsResponse.parse(await serializeAccounts(rows)));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [account] = await db.insert(accountsTable).values({ ...parsed.data, name: parsed.data.name.trim() }).returning();
  await logActivity({ type: "account_created", description: `Account ${account!.name} created`, accountId: account!.id });
  res.status(201).json((await serializeAccounts([account!]))[0]);
});

router.post("/accounts/from-leads", async (_req, res): Promise<void> => {
  const leads = await db
    .select()
    .from(leadsTable)
    .where(and(isNull(leadsTable.accountId), isNotNull(leadsTable.company), sql`trim(${leadsTable.company}) <> ''`));
  const before = (await db.select({ n: sql<number>`count(*)::int` }).from(accountsTable))[0]!.n;
  let linked = 0;
  for (const lead of leads) {
    const account = await findOrCreateAccountForLead(lead);
    if (!account) continue;
    await db.update(leadsTable).set({ accountId: account.id }).where(eq(leadsTable.id, lead.id));
    linked++;
  }
  const after = (await db.select({ n: sql<number>`count(*)::int` }).from(accountsTable))[0]!.n;
  res.json(CreateAccountsFromLeadsResponse.parse({ created: after - before, linked }));
});

router.get("/accounts/:id", async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, params.data.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const [base] = await serializeAccounts([account]);
  const contacts = await db.select().from(leadsTable).where(eq(leadsTable.accountId, account.id)).orderBy(asc(leadsTable.firstName));
  const deals = await db.select().from(dealsTable).where(eq(dealsTable.accountId, account.id)).orderBy(desc(dealsTable.createdAt));
  const contactIds = contacts.map((c) => c.id);
  const dealIds = deals.map((d) => d.id);
  // Account notes plus the notes logged on its deals.
  const notes = await db
    .select()
    .from(notesTable)
    .where(or(eq(notesTable.accountId, account.id), dealIds.length ? inArray(notesTable.dealId, dealIds) : undefined))
    .orderBy(desc(notesTable.createdAt));
  const activity = await db
    .select()
    .from(activitiesTable)
    .where(
      or(
        eq(activitiesTable.accountId, account.id),
        contactIds.length ? inArray(activitiesTable.leadId, contactIds) : undefined,
        dealIds.length ? inArray(activitiesTable.dealId, dealIds) : undefined,
      ),
    )
    .orderBy(desc(activitiesTable.createdAt))
    .limit(60);
  res.json(
    GetAccountResponse.parse({
      ...base,
      contacts: await serializeLeads(contacts),
      deals: await serializeDeals(deals),
      notes,
      activity: activity.map((a) => {
        const lead = contacts.find((c) => c.id === a.leadId);
        return { ...a, leadName: lead ? leadName(lead) : null };
      }),
    }),
  );
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse(req.params);
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [account] = await db.update(accountsTable).set(parsed.data).where(eq(accountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(UpdateAccountResponse.parse((await serializeAccounts([account]))[0]));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const params = DeleteAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Contacts and deals stay; they just lose the link.
  await db.update(leadsTable).set({ accountId: null }).where(eq(leadsTable.accountId, params.data.id));
  await db.delete(accountsTable).where(eq(accountsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
