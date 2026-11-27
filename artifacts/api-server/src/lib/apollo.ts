/**
 * Apollo lead data, reached one of two ways:
 *  - Firecrawl Alexandria (secret `FIRECRAWL_API_KEY`): Apollo's data billed in Firecrawl credits;
 *    person search is free there, even without a paid Apollo plan.
 *  - Apollo direct (secret `Apollo_api_key` / `APOLLO_API_KEY`): billed by Apollo on the user's plan.
 *    People search and contact reveal need a paid Apollo plan.
 * `source: "auto"` tries Firecrawl first and falls back to Apollo direct.
 */
import { ApolloError } from "./apollo-error";
import { alexandria, firecrawlKey } from "./firecrawl";

export { ApolloError };

const BASE = "https://api.apollo.io/api/v1";

export type LeadSource = "auto" | "firecrawl" | "apollo";

export function apolloKey(): string | null {
  return process.env["Apollo_api_key"] || process.env["APOLLO_API_KEY"] || process.env["apollo_api_key"] || null;
}

/** True when at least one lead data source has a key. */
export function leadDataConfigured(): boolean {
  return !!(firecrawlKey() || apolloKey());
}

async function apolloFetch<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const key = apolloKey();
  if (!key) throw new ApolloError("Apollo is not connected. Add your Apollo API key as the Apollo_api_key secret.", 400);
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: { "X-Api-Key": key, "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const code = String(json["error_code"] ?? "");
    const planRestricted = code === "API_INACCESSIBLE" || /free plan/i.test(String(json["error"] ?? ""));
    const message = planRestricted
      ? "Your Apollo account is on the free plan, which doesn't allow lead search through the API. Upgrade to any paid Apollo plan, or add a Firecrawl key to search Apollo's data through Firecrawl."
      : res.status === 401
        ? "Apollo rejected the API key. Check the Apollo_api_key secret."
        : res.status === 429
          ? "Apollo rate limit reached. Wait a minute and try again."
          : `Apollo error: ${String(json["error"] ?? json["message"] ?? text.slice(0, 200) ?? res.status)}`;
    throw new ApolloError(message, planRestricted ? 402 : res.status >= 500 ? 502 : 400, planRestricted);
  }
  return json as T;
}

/** Sources to try, in order, for the requested choice. */
function sourcesFor(source: LeadSource = "auto"): ("firecrawl" | "apollo")[] {
  if (source === "firecrawl") {
    if (!firecrawlKey()) throw new ApolloError("Firecrawl is not connected. Add your Firecrawl API key as the FIRECRAWL_API_KEY secret.", 400);
    return ["firecrawl"];
  }
  if (source === "apollo") {
    if (!apolloKey()) throw new ApolloError("Apollo is not connected. Add your Apollo API key as the Apollo_api_key secret.", 400);
    return ["apollo"];
  }
  const out: ("firecrawl" | "apollo")[] = [];
  if (firecrawlKey()) out.push("firecrawl");
  if (apolloKey()) out.push("apollo");
  if (!out.length) throw new ApolloError("No lead source is connected. Add a FIRECRAWL_API_KEY or Apollo_api_key secret.", 400);
  return out;
}

/** Run the call on each source in order; the first success wins, otherwise the last error is thrown. */
async function viaSources<T>(
  source: LeadSource | undefined,
  run: { firecrawl: () => Promise<T>; apollo: () => Promise<T> },
): Promise<{ data: T; usedSource: "firecrawl" | "apollo" }> {
  const order = sourcesFor(source);
  let lastErr: unknown;
  for (const s of order) {
    try {
      return { data: await run[s](), usedSource: s };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

type ApolloOrg = {
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

type ApolloPerson = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  has_email?: boolean | null;
  email_status?: string | null;
  organization?: ApolloOrg | null;
  organization_name?: string | null;
};

export function placeOf(x: { city?: string | null; state?: string | null; country?: string | null }): string | null {
  const parts = [x.city, x.state, x.country].filter((p): p is string => !!p && p.trim() !== "");
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

type SearchFilters = {
  titles?: string[];
  industries?: string[];
  locations?: string[];
  employeeRanges?: string[];
  keywords?: string;
  page?: number;
  source?: LeadSource;
};

type SearchData = {
  people?: ApolloPerson[];
  total_entries?: number;
  pagination?: { total_entries?: number; total_pages?: number; page?: number };
};

export async function searchPeople(filters: SearchFilters) {
  const page = filters.page ?? 1;
  const keywords = filters.keywords?.trim();
  const { data, usedSource } = await viaSources<SearchData>(filters.source, {
    apollo: () => {
      const body: Record<string, unknown> = { page, per_page: 25 };
      if (filters.titles?.length) body["person_titles"] = filters.titles;
      if (filters.industries?.length) body["q_organization_keyword_tags"] = filters.industries;
      if (filters.locations?.length) body["person_locations"] = filters.locations;
      if (filters.employeeRanges?.length) body["organization_num_employees_ranges"] = filters.employeeRanges;
      if (keywords) body["q_keywords"] = keywords;
      return apolloFetch<SearchData>("/mixed_people/api_search", { method: "POST", body });
    },
    // Firecrawl's people/search takes titles, locations and free-text keywords; industries go into the keywords.
    firecrawl: () => {
      const options: Record<string, unknown> = { page, per_page: 25 };
      if (filters.titles?.length) options["person_titles"] = filters.titles;
      if (filters.locations?.length) options["person_locations"] = filters.locations;
      const q = [...(filters.industries ?? []), keywords].filter(Boolean).join(" ");
      if (q) options["q_keywords"] = q;
      return alexandria<SearchData>("apollo", "people/search", options);
    },
  });
  const people = data.people ?? [];
  const total = data.pagination?.total_entries ?? data.total_entries ?? people.length;
  return {
    source: usedSource,
    people: people.map((p) => ({
      apolloId: p.id,
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? p.last_name_obfuscated ?? "",
      title: p.title ?? null,
      company: p.organization?.name ?? p.organization_name ?? null,
      location: placeOf(p),
      linkedinUrl: p.linkedin_url ?? null,
      hasEmail: p.has_email ?? !!p.email,
    })),
    total,
    page: data.pagination?.page ?? page,
    totalPages: data.pagination?.total_pages ?? Math.max(1, Math.ceil(total / 25)),
  };
}

/** Reveal full contact details (uses credits). Max 10 ids per call. */
export async function revealPeople(ids: string[], source?: LeadSource): Promise<ApolloPerson[]> {
  const out: ApolloPerson[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const details = ids.slice(i, i + 10).map((id) => ({ id }));
    const { data } = await viaSources<{ matches?: (ApolloPerson | null)[] }>(source, {
      apollo: () => apolloFetch("/people/bulk_match", { method: "POST", body: { details, reveal_personal_emails: false } }),
      firecrawl: () => alexandria("apollo", "people/bulk-match", { details, reveal_personal_emails: false }),
    });
    out.push(...(data.matches ?? []).filter((m): m is ApolloPerson => !!m));
  }
  return out;
}

export function orgFields(org: ApolloOrg | null | undefined) {
  if (!org) return null;
  return {
    company: org.name ?? null,
    website: org.website_url ?? (org.primary_domain ? `https://${org.primary_domain}` : null),
    industry: org.industry ?? null,
    companySize: org.estimated_num_employees ? `${org.estimated_num_employees.toLocaleString("en-US")} employees` : null,
    companyLocation: placeOf(org),
    companyLinkedinUrl: org.linkedin_url ?? null,
  };
}

/** Company details from a domain. */
export async function enrichOrganization(domain: string, source?: LeadSource) {
  const { data } = await viaSources<{ organization?: ApolloOrg | null } & ApolloOrg>(source, {
    apollo: () => apolloFetch(`/organizations/enrich?domain=${encodeURIComponent(domain)}`, { method: "GET" }),
    firecrawl: () => alexandria("apollo", "companies/enrich", { domain }),
  });
  // Apollo wraps the record in `organization`; accept a bare record too.
  return orgFields(data.organization ?? (data.name ? data : null));
}
