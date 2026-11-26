import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import type { LeadInput } from "@workspace/api-client-react";

/**
 * Turns real-world prospect spreadsheets (CSV or Excel) into leads without asking the user to map columns.
 * Columns are recognised by their header text, several files are merged by company name (e.g. a firm list
 * plus a contacts sheet), a cell listing several people ("Ann Lee; Bob Roy") becomes one lead per person,
 * and every column we don't map lands in the lead's notes so nothing is lost.
 */

type Rec = Record<string, string>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const companyKey = (s: string) => norm(s).replace(/\b(llc|inc|lp|llp|ltd|corp|co|incorporated|corporation|the)\b/g, "").replace(/\s+/g, " ").trim();

const JUNK = /\b(not supplied|n\/?a|unknown|none|tbd|verify|verification|needs|contact form|not available|not listed)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

type Kind = "company" | "first" | "last" | "person" | "title" | "email" | "phone" | "linkedin" | "website" | "industry";

function kindOf(header: string): Kind | null {
  const h = norm(header);
  if (/note|comment|description|summary/.test(h)) return null;
  if (/\bemail\b|e mail/.test(h)) return "email";
  if (/phone|mobile|\btel\b|cell/.test(h)) return "phone";
  if (/linkedin/.test(h)) return "linkedin";
  if (/website|\burl\b|domain|\bsite\b/.test(h)) return "website";
  if (/^(first|given) ?name$|^firstname$/.test(h)) return "first";
  if (/^(last|family) ?name$|^lastname$|^surname$/.test(h)) return "last";
  if (/firm|company|organi[sz]ation|business name|account name|^account$/.test(h)) return "company";
  if (/^(job )?title$|position|^role$|designation/.test(h)) return "title";
  if (/industry|sector|vertical/.test(h)) return "industry";
  if (/contact|^name$|full name|person|founder|partner|ceo|president|chief|officer|director|owner|principal|\bvp\b|head of|manager/.test(h)) return "person";
  return null;
}

/** Header row = the first of the top rows that names at least two columns we recognise. */
function toRecords(rows: string[][]): Rec[] {
  const at = rows.slice(0, 10).findIndex((r) => r.filter((c) => c && kindOf(c)).length >= 2);
  const hi = at < 0 ? 0 : at;
  const header = rows[hi]?.map((h, i) => h?.trim() || `Column ${i + 1}`) ?? [];
  return rows.slice(hi + 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]).filter(([, v]) => v)) as Rec)
    .filter((r) => Object.keys(r).length);
}

async function readFile(file: File): Promise<Rec[]> {
  const cell = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  if (/\.xlsx$/i.test(file.name)) return toRecords((await readSheet(file)).map((r) => r.map(cell)));
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return toRecords(Papa.parse<string[]>(await file.text(), { skipEmptyLines: true }).data);
  throw new Error(`${file.name}: please upload a .csv or .xlsx file (old .xls files can be saved as .xlsx from Excel)`);
}

/** Rows for the same company across files are merged; the first non-empty value of each column wins. */
function mergeByCompany(recs: Rec[]): Rec[] {
  const out = new Map<string, Rec>();
  recs.forEach((r, i) => {
    const col = Object.keys(r).find((h) => kindOf(h) === "company");
    const key = col ? companyKey(r[col]) || `row${i}` : `row${i}`;
    const prev = out.get(key) ?? {};
    for (const [h, v] of Object.entries(r)) if (!prev[h]) prev[h] = v;
    out.set(key, prev);
  });
  return [...out.values()];
}

const splitPeople = (cell: string) => cell.split(/[;\n|]|\s&\s|,\s*(?=[A-Z][a-z]+\s+[A-Z])/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s) && !JUNK.test(s) && !EMAIL.test(s));

function toLeads(r: Rec): LeadInput[] {
  const by = (k: Kind) => Object.keys(r).filter((h) => kindOf(h) === k);
  const used = new Set<string>();
  const first = (k: Kind, ok: (v: string) => boolean = (v) => !JUNK.test(v)) => {
    // Prefer "direct"/"business"/"mobile" columns over "general"/"main" ones.
    const cols = by(k).sort((a, b) => Number(/general|main|office|info/i.test(a)) - Number(/general|main|office|info/i.test(b)));
    cols.forEach((h) => used.add(h));
    for (const h of cols) if (ok(r[h])) return r[h];
    return undefined;
  };
  const email = first("email", (v) => EMAIL.test(v))?.match(EMAIL)?.[0];
  const phone = first("phone", (v) => (v.match(/\d/g)?.length ?? 0) >= 7);
  const linkedinRaw = first("linkedin", (v) => /linkedin\.com/i.test(v));
  const website = first("website", (v) => /\.[a-z]{2,}/i.test(v) && !JUNK.test(v));
  const company = first("company");
  const industry = first("industry");
  const title = first("title");
  const fn = first("first");
  const ln = first("last");
  const linkedinUrl = linkedinRaw && /\/in\//i.test(linkedinRaw) ? linkedinRaw : undefined;

  // People: explicit first/last name, else every person-type column (its header becomes the title when it's a role).
  const people: Array<{ name: string; title?: string }> = [];
  if (fn) people.push({ name: `${fn} ${ln ?? ""}`, title });
  else for (const h of by("person")) {
    used.add(h);
    const role = /contact|^name$|full name|person/i.test(norm(h)) ? title : h;
    for (const p of splitPeople(r[h])) {
      const m = p.match(/^(.*?)\s*\((.+)\)$/); // "Ann Lee (CEO)"
      people.push(m ? { name: m[1], title: m[2] } : { name: p, title: role });
    }
  }

  const notes = Object.entries(r).filter(([h]) => !used.has(h) || (kindOf(h) === "linkedin" && !linkedinUrl))
    .map(([h, v]) => `${h}: ${v}`).join("\n") || undefined;
  const base = { email, phone, company, industry, website, notes };
  if (!people.length) return company || email ? [{ ...base, firstName: "Team", lastName: "", title: "General contact", linkedinUrl }] : [];
  // Shared contact details (a firm's main email/phone) only go to the first named person to avoid emailing one inbox repeatedly.
  return people.map((p, i) => {
    const [firstName, ...rest] = p.name.trim().split(/\s+/);
    return { ...base, email: i === 0 ? email : undefined, phone: i === 0 ? phone : undefined, linkedinUrl: i === 0 ? linkedinUrl : undefined, firstName, lastName: rest.join(" "), title: p.title || undefined };
  });
}

export async function leadsFromFiles(files: File[]): Promise<LeadInput[]> {
  const recs = (await Promise.all(files.map(readFile))).flat();
  return mergeByCompany(recs).flatMap(toLeads).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as LeadInput);
}
