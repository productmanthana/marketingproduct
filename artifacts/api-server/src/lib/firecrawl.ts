/**
 * Firecrawl Alexandria client: calls data providers (Apollo and others) with one
 * Firecrawl API key (secret `FIRECRAWL_API_KEY`), billed in Firecrawl credits.
 * Docs: https://docs.firecrawl.dev/features/alexandria
 */
import { ApolloError } from "./apollo-error";

export function firecrawlKey(): string | null {
  return process.env["FIRECRAWL_API_KEY"] || process.env["firecrawl_api_key"] || null;
}

type AlexandriaItem = {
  data?: unknown;
  error?: { code?: string; message?: string; status?: number };
};

/** Run one Alexandria provider tool and return its raw data payload. */
export async function alexandria<T>(provider: string, capability: string, options: Record<string, unknown>): Promise<T> {
  const key = firecrawlKey();
  if (!key) throw new ApolloError("Firecrawl is not connected. Add your Firecrawl API key as the FIRECRAWL_API_KEY secret.", 400);
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ alexandria: { provider, capability, options } }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const code = String(json["code"] ?? "");
    const actionUrl = (json["requiresAction"] as { url?: string } | undefined)?.url;
    const message =
      res.status === 401
        ? "Firecrawl rejected the API key. Check the FIRECRAWL_API_KEY secret."
        : res.status === 402 || code === "insufficient_credits"
          ? "Your Firecrawl account is out of credits. Add credits in Firecrawl to keep searching."
          : code === "THIRD_PARTY_DATA_TERMS_REQUIRED"
            ? `Accept Apollo's data terms in Firecrawl first${actionUrl ? `: ${actionUrl}` : " (Firecrawl → Settings → Data sources)"}.`
            : res.status === 429
              ? "Firecrawl rate limit reached. Wait a minute and try again."
              : `Firecrawl error: ${String(json["error"] ?? text.slice(0, 200) ?? res.status)}`;
    throw new ApolloError(message, res.status === 402 ? 402 : res.status >= 500 ? 502 : 400, res.status === 402);
  }
  const data = (json["data"] ?? {}) as { alexandria?: AlexandriaItem[] };
  const item = data.alexandria?.[0];
  if (!item) throw new ApolloError("Firecrawl returned no result.", 502);
  if (item.error) {
    const status = item.error.status ?? 400;
    throw new ApolloError(`Firecrawl (${provider}): ${item.error.message ?? item.error.code}`, status >= 500 ? 502 : 400);
  }
  return (item.data ?? {}) as T;
}
