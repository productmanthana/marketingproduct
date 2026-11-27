import { eq } from "drizzle-orm";
import { db, leadsTable, type LeadRow } from "@workspace/db";
import { detectSignals } from "./ai";
import { pageText, websiteFor } from "./web";
import { leadName, logActivity } from "./outreach";

/** Buying signals from the company's own website: home page plus its careers, news and blog pages when they exist. */
const EXTRA_PATHS = ["/careers", "/jobs", "/news", "/blog", "/press"];

export async function scanSignals(lead: LeadRow): Promise<string[] | null> {
  const site = websiteFor(lead);
  if (!site) return null;
  const root = new URL(site).origin;
  const urls = [site, ...EXTRA_PATHS.map((p) => `${root}${p}`)];
  const pages = (await Promise.all(urls.map(async (url) => ({ url, text: await pageText(url, 2500) })))).filter((p) => p.text.length > 80);
  const signals = pages.length ? await detectSignals({ lead, pages }) : [];
  await db
    .update(leadsTable)
    .set({ signals: signals.length ? signals.join("\n") : null, signalsAt: new Date() })
    .where(eq(leadsTable.id, lead.id));
  if (signals.length) {
    await logActivity({ type: "buying_signal", description: `Buying signal at ${lead.company || leadName(lead)}: ${signals[0]}`, leadId: lead.id });
  }
  return signals;
}
