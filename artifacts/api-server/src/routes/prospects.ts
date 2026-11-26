import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { db, leadsTable } from "@workspace/db";
import {
  GetProspectStatusResponse,
  ImportProspectsBody,
  ImportProspectsResponse,
  SearchProspectsBody,
  SearchProspectsResponse,
} from "@workspace/api-zod";
import { ApolloError, apolloKey, orgFields, placeOf, revealPeople, searchPeople } from "../lib/apollo";
import { logActivity } from "../lib/outreach";

const router: IRouter = Router();

function sendApolloError(res: import("express").Response, err: unknown): void {
  if (err instanceof ApolloError) {
    res.status(err.status).json({ error: err.message, planRestricted: err.planRestricted });
    return;
  }
  throw err;
}

router.get("/prospects/status", (_req, res): void => {
  res.json(GetProspectStatusResponse.parse({ configured: !!apolloKey() }));
});

router.post("/prospects/search", async (req, res): Promise<void> => {
  const parsed = SearchProspectsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await searchPeople(parsed.data);
    const ids = result.people.map((p) => p.apolloId);
    const existing = ids.length
      ? await db.select({ apolloId: leadsTable.apolloId }).from(leadsTable).where(inArray(leadsTable.apolloId, ids))
      : [];
    const have = new Set(existing.map((e) => e.apolloId));
    res.json(
      SearchProspectsResponse.parse({
        ...result,
        people: result.people.map((p) => ({ ...p, alreadyImported: have.has(p.apolloId) })),
      }),
    );
  } catch (err) {
    sendApolloError(res, err);
  }
});

router.post("/prospects/import", async (req, res): Promise<void> => {
  const parsed = ImportProspectsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select({ apolloId: leadsTable.apolloId })
    .from(leadsTable)
    .where(inArray(leadsTable.apolloId, parsed.data.apolloIds));
  const have = new Set(existing.map((e) => e.apolloId));
  const fresh = [...new Set(parsed.data.apolloIds)].filter((id) => !have.has(id));
  try {
    const people = fresh.length ? await revealPeople(fresh) : [];
    const rows = people
      .filter((p) => p.first_name)
      .map((p) => {
        const org = orgFields(p.organization);
        return {
          firstName: p.first_name!,
          lastName: p.last_name ?? "",
          email: p.email && p.email_status !== "unavailable" ? p.email : null,
          linkedinUrl: p.linkedin_url ?? null,
          title: p.title ?? null,
          company: org?.company ?? p.organization_name ?? null,
          website: org?.website ?? null,
          industry: org?.industry ?? null,
          companySize: org?.companySize ?? null,
          companyLocation: org?.companyLocation ?? null,
          companyLinkedinUrl: org?.companyLinkedinUrl ?? null,
          notes: placeOf(p) ? `Based in ${placeOf(p)}` : null,
          apolloId: p.id,
          campaignId: parsed.data.campaignId ?? null,
        };
      });
    if (rows.length) {
      await db.insert(leadsTable).values(rows);
      await logActivity({ type: "lead_added", description: `${rows.length} leads imported from Apollo` });
    }
    res.json(
      ImportProspectsResponse.parse({ imported: rows.length, skipped: parsed.data.apolloIds.length - rows.length }),
    );
  } catch (err) {
    sendApolloError(res, err);
  }
});

export default router;
