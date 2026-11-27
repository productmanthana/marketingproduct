import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, dealsTable, leadsTable, quotesTable, type QuoteItem, type QuoteRow } from "@workspace/db";
import {
  CreateQuoteBody,
  DeleteQuoteParams,
  ListQuotesQueryParams,
  SendQuoteParams,
  UpdateQuoteBody,
  UpdateQuoteParams,
} from "@workspace/api-zod";
import { STAGES, STAGE_PROBABILITY, isClosed, type Stage } from "../lib/crm";
import { createTask, getOrCreateConversation, getSettings, leadName, logActivity, recordOutbound } from "../lib/outreach";

/** Price quotes on deals: build, email to the contact, and let them accept or decline from a public link. */
const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

function totals(items: QuoteItem[], discountPercent: number, taxPercent: number) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const afterDiscount = subtotal * (1 - discountPercent / 100);
  return { subtotal, total: round2(afterDiscount * (1 + taxPercent / 100)) };
}

async function baseUrl(): Promise<string> {
  return (await getSettings()).publicBaseUrl.replace(/\/+$/, "");
}

async function serialize(rows: QuoteRow[]) {
  const base = await baseUrl();
  const ids = [...new Set(rows.map((r) => r.dealId))];
  const deals = ids.length ? await db.select({ id: dealsTable.id, name: dealsTable.name }).from(dealsTable).where(inArray(dealsTable.id, ids)) : [];
  return rows.map((q) => ({
    ...q,
    dealName: deals.find((d) => d.id === q.dealId)?.name ?? null,
    subtotal: totals(q.items, q.discountPercent, q.taxPercent).subtotal,
    publicUrl: `${base}/api/q/${q.publicToken}`,
  }));
}

router.get("/quotes", async (req, res): Promise<void> => {
  const q = ListQuotesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(quotesTable)
    .where(q.data.dealId ? eq(quotesTable.dealId, q.data.dealId) : undefined)
    .orderBy(desc(quotesTable.createdAt));
  res.json(await serialize(rows));
});

router.post("/quotes", async (req, res): Promise<void> => {
  const parsed = CreateQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, parsed.data.dealId));
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const d = parsed.data;
  const items = d.items.filter((i) => i.name.trim());
  const { total } = totals(items, d.discountPercent ?? 0, d.taxPercent ?? 0);
  const [row] = await db
    .insert(quotesTable)
    .values({
      dealId: d.dealId,
      number: "Q-draft",
      title: d.title,
      items,
      discountPercent: d.discountPercent ?? 0,
      taxPercent: d.taxPercent ?? 0,
      total,
      notes: d.notes || null,
      validUntil: d.validUntil ?? new Date(Date.now() + 30 * 24 * 60 * 60_000),
    })
    .returning();
  const [numbered] = await db
    .update(quotesTable)
    .set({ number: `Q-${new Date().getFullYear()}-${String(row!.id).padStart(4, "0")}` })
    .where(eq(quotesTable.id, row!.id))
    .returning();
  await logActivity({ type: "quote_created", description: `Quote ${numbered!.number} created for ${deal.name}`, leadId: deal.leadId, dealId: deal.id });
  res.status(201).json((await serialize([numbered!]))[0]);
});

router.patch("/quotes/:id", async (req, res): Promise<void> => {
  const params = UpdateQuoteParams.safeParse(req.params);
  const parsed = UpdateQuoteBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [current] = await db.select().from(quotesTable).where(eq(quotesTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  const items = parsed.data.items?.filter((i) => i.name.trim()) ?? current.items;
  const discountPercent = parsed.data.discountPercent ?? current.discountPercent;
  const taxPercent = parsed.data.taxPercent ?? current.taxPercent;
  const [row] = await db
    .update(quotesTable)
    .set({ ...parsed.data, items, total: totals(items, discountPercent, taxPercent).total })
    .where(eq(quotesTable.id, current.id))
    .returning();
  res.json((await serialize([row!]))[0]);
});

router.delete("/quotes/:id", async (req, res): Promise<void> => {
  const params = DeleteQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(quotesTable).where(eq(quotesTable.id, params.data.id));
  res.sendStatus(204);
});

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

router.post("/quotes/:id/send", async (req, res): Promise<void> => {
  const params = SendQuoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, params.data.id));
  const [deal] = quote ? await db.select().from(dealsTable).where(eq(dealsTable.id, quote.dealId)) : [];
  const [lead] = deal?.leadId ? await db.select().from(leadsTable).where(eq(leadsTable.id, deal.leadId)) : [];
  if (!quote || !deal) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }
  if (!lead?.email) {
    res.status(400).json({ error: "The deal's contact needs an email address to receive the quote" });
    return;
  }
  const settings = await getSettings();
  const base = settings.publicBaseUrl.replace(/\/+$/, "");
  if (!base) {
    res.status(400).json({ error: "Set the Public app URL in Settings first, so the quote link works" });
    return;
  }
  const subject = `Your quote ${quote.number}: ${quote.title}`;
  const body = [
    `Hi ${lead.firstName},`,
    "",
    `As promised, here is our quote for ${quote.title}: ${money(quote.total, settings.currency)}${quote.validUntil ? `, valid until ${quote.validUntil.toISOString().slice(0, 10)}` : ""}.`,
    "",
    `You can view the details and accept it here: ${base}/api/q/${quote.publicToken}`,
    "",
    "Happy to answer any questions.",
    "",
    settings.signature || settings.senderName,
  ].join("\n");
  const conv = await getOrCreateConversation(lead, "email", lead.campaignId, subject);
  const msg = await recordOutbound({ conversation: conv, lead, body, subject, author: "user" });
  if (msg.deliveryStatus === "failed" || msg.deliveryStatus === "blocked") {
    res.status(400).json({ error: msg.deliveryError ?? "The email could not be sent" });
    return;
  }
  const [row] = await db.update(quotesTable).set({ status: "sent", sentAt: new Date() }).where(eq(quotesTable.id, quote.id)).returning();
  // Sending a quote means the deal is at least at the proposal stage.
  if (!isClosed(deal.stage) && STAGES.indexOf(deal.stage as Stage) < STAGES.indexOf("proposal")) {
    await db.update(dealsTable).set({ stage: "proposal", probability: STAGE_PROBABILITY.proposal, stageChangedAt: new Date(), updatedAt: new Date() }).where(eq(dealsTable.id, deal.id));
  }
  await logActivity({ type: "quote_sent", description: `Quote ${quote.number} sent to ${leadName(lead)}`, channel: "email", leadId: lead.id, dealId: deal.id });
  res.json((await serialize([row!]))[0]);
});

// ---------- public quote page ----------

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function quotePage(q: QuoteRow, companyName: string, currency: string, notice?: string) {
  const { subtotal } = totals(q.items, q.discountPercent, q.taxPercent);
  const rows = q.items
    .map((i) => `<tr><td>${esc(i.name)}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${money(i.unitPrice, currency)}</td><td style="text-align:right">${money(i.quantity * i.unitPrice, currency)}</td></tr>`)
    .join("");
  const open = q.status === "sent" && (!q.validUntil || q.validUntil.getTime() > Date.now());
  const state =
    q.status === "accepted" ? `<p style="color:#15803d;font-weight:600">Accepted. Thank you!</p>`
    : q.status === "declined" ? `<p style="color:#b91c1c;font-weight:600">Declined.</p>`
    : open ? `<form method="post" style="display:flex;gap:8px;margin-top:20px"><button name="action" value="accept" style="background:#111;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:14px;cursor:pointer">Accept quote</button><button name="action" value="decline" style="background:#fff;border:1px solid #ccc;padding:10px 18px;border-radius:8px;font-size:14px;cursor:pointer">Decline</button></form>`
    : `<p style="color:#555">This quote is no longer open.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote ${esc(q.number)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f5f2;margin:0;padding:32px 16px;color:#111}.card{background:#fff;max-width:720px;margin:0 auto;padding:32px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08)}table{width:100%;border-collapse:collapse;font-size:14px;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #eee}th{text-align:left;color:#666;font-weight:500}</style></head>
<body><div class="card"><div style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.1em">${esc(companyName)} · Quote ${esc(q.number)}</div>
<h1 style="font-size:22px;margin:6px 0 0">${esc(q.title)}</h1>
${notice ? `<p style="background:#f0fdf4;padding:10px;border-radius:8px">${esc(notice)}</p>` : ""}
<table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table style="max-width:300px;margin-left:auto"><tr><td>Subtotal</td><td style="text-align:right">${money(subtotal, currency)}</td></tr>
${q.discountPercent ? `<tr><td>Discount (${q.discountPercent}%)</td><td style="text-align:right">-${money(subtotal * q.discountPercent / 100, currency)}</td></tr>` : ""}
${q.taxPercent ? `<tr><td>Tax (${q.taxPercent}%)</td><td style="text-align:right">${money(subtotal * (1 - q.discountPercent / 100) * q.taxPercent / 100, currency)}</td></tr>` : ""}
<tr><td><b>Total</b></td><td style="text-align:right"><b>${money(q.total, currency)}</b></td></tr></table>
${q.notes ? `<p style="white-space:pre-wrap;color:#444;font-size:14px">${esc(q.notes)}</p>` : ""}
${q.validUntil ? `<p style="color:#666;font-size:13px">Valid until ${q.validUntil.toISOString().slice(0, 10)}</p>` : ""}
${state}</div></body></html>`;
}

router.get("/q/:token", async (req, res): Promise<void> => {
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.publicToken, req.params.token));
  if (!q) {
    res.status(404).send("Quote not found");
    return;
  }
  const s = await getSettings();
  res.send(quotePage(q, s.companyName, s.currency));
});

router.post("/q/:token", async (req, res): Promise<void> => {
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.publicToken, req.params.token));
  if (!q) {
    res.status(404).send("Quote not found");
    return;
  }
  const s = await getSettings();
  const action = req.body?.action;
  const open = q.status === "sent" && (!q.validUntil || q.validUntil.getTime() > Date.now());
  if (!open || (action !== "accept" && action !== "decline")) {
    res.send(quotePage(q, s.companyName, s.currency));
    return;
  }
  const status = action === "accept" ? "accepted" : "declined";
  const [row] = await db.update(quotesTable).set({ status, respondedAt: new Date() }).where(eq(quotesTable.id, q.id)).returning();
  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
  if (deal) {
    if (status === "accepted" && !isClosed(deal.stage) && STAGES.indexOf(deal.stage as Stage) < STAGES.indexOf("negotiation")) {
      await db.update(dealsTable).set({ stage: "negotiation", probability: STAGE_PROBABILITY.negotiation, amount: Math.round(q.total), stageChangedAt: new Date(), updatedAt: new Date() }).where(eq(dealsTable.id, deal.id));
    }
    await logActivity({ type: `quote_${status}`, description: `Quote ${q.number} ${status} for ${deal.name}`, leadId: deal.leadId, dealId: deal.id });
    await createTask({
      title: status === "accepted" ? `Quote ${q.number} accepted: send the contract and close ${deal.name}` : `Quote ${q.number} declined: ask what would work for ${deal.name}`,
      leadId: deal.leadId,
      dealId: deal.id,
      dueAt: new Date(),
      source: "follow_up",
    });
  }
  res.send(quotePage(row!, s.companyName, s.currency, status === "accepted" ? "Thanks, we've received your acceptance and will be in touch shortly." : "Thanks for letting us know."));
});

export default router;
