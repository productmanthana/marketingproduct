/**
 * Apollo.io client. Uses the user's own Apollo API key (secret `Apollo_api_key`
 * or `APOLLO_API_KEY`); usage is billed by Apollo against the user's plan.
 * People search and contact reveal need a paid Apollo plan; organization
 * enrichment also works on the free plan.
 */
const BASE = "https://api.apollo.io/api/v1";

export class ApolloError extends Error {
  constructor(
    message: string,
    public status: number,
    public planRestricted = false,
  ) {
    super(message);
  }
}

export function apolloKey(): string | null {
  return process.env["Apollo_api_key"] || process.env["APOLLO_API_KEY"] || process.env["apollo_api_key"] || null;
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
      ? "Your Apollo account is on the free plan, which doesn't allow lead search through the API. Upgrade to any paid Apollo plan to use Find leads."
      : res.status === 401
        ? "Apollo rejected the API key. Check the Apollo_api_key secret."
        : res.status === 429
          ? "Apollo rate limit reached. Wait a minute and try again."
          : `Apollo error: ${String(json["error"] ?? json["message"] ?? text.slice(0, 200) ?? res.status)}`;
    throw new ApolloError(message, planRestricted ? 402 : res.status >= 500 ? 502 : 400, planRestricted);
  }
  return json as T;
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

export async function searchPeople(filters: {
  titles?: string[];
  industries?: string[];
  locations?: string[];
  employeeRanges?: string[];
  keywords?: string;
  page?: number;
}) {
  const body: Record<string, unknown> = { page: filters.page ?? 1, per_page: 25 };
  if (filters.titles?.length) body["person_titles"] = filters.titles;
  if (filters.industries?.length) body["q_organization_keyword_tags"] = filters.industries;
  if (filters.locations?.length) body["person_locations"] = filters.locations;
  if (filters.employeeRanges?.length) body["organization_num_employees_ranges"] = filters.employeeRanges;
  if (filters.keywords?.trim()) body["q_keywords"] = filters.keywords.trim();
  const data = await apolloFetch<{
    people?: ApolloPerson[];
    total_entries?: number;
    pagination?: { total_entries?: number; total_pages?: number; page?: number };
  }>("/mixed_people/api_search", { method: "POST", body });
  const people = data.people ?? [];
  const total = data.pagination?.total_entries ?? data.total_entries ?? people.length;
  return {
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
    page: data.pagination?.page ?? filters.page ?? 1,
    totalPages: data.pagination?.total_pages ?? Math.max(1, Math.ceil(total / 25)),
  };
}

/** Reveal full contact details (uses Apollo credits). Max 10 ids per call. */
export async function revealPeople(ids: string[]): Promise<ApolloPerson[]> {
  const out: ApolloPerson[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const data = await apolloFetch<{ matches?: (ApolloPerson | null)[] }>("/people/bulk_match", {
      method: "POST",
      body: { details: chunk.map((id) => ({ id })), reveal_personal_emails: false },
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

/** Company details from a domain. Works on Apollo's free plan. */
export async function enrichOrganization(domain: string) {
  const data = await apolloFetch<{ organization?: ApolloOrg | null }>(
    `/organizations/enrich?domain=${encodeURIComponent(domain)}`,
    { method: "GET" },
  );
  return orgFields(data.organization);
}
