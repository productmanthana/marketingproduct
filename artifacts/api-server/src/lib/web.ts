import type { LeadRow } from "@workspace/db";

const FREE_MAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|yandex|zoho)\./i;

export function websiteFor(lead: LeadRow): string | null {
  if (lead.website?.trim()) return /^https?:\/\//.test(lead.website) ? lead.website.trim() : `https://${lead.website.trim()}`;
  if (lead.email && !FREE_MAIL.test(lead.email)) return `https://${lead.email.split("@")[1]}`;
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetches a page and returns its readable text ("" when it cannot be read). */
export async function pageText(url: string, max = 6000): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Mozilla/5.0 (compatible; OutreachAutopilot/1.0)" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return htmlToText(await res.text()).slice(0, max);
  } catch {
    return "";
  }
}
