import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, leadsTable, outreachConversationsTable, outreachMessagesTable } from "@workspace/db";
import { handleVoiceEvent } from "../lib/calls";
import { getOrCreateConversation, getSettings, leadName, logActivity, processInbound } from "../lib/outreach";
import { linkedinIdentifier } from "../lib/delivery";
import { logger } from "../lib/logger";

/** Endpoints reached by recipients and providers: open pixel, unsubscribe page, voice and LinkedIn webhooks. */
const router: IRouter = Router();

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

router.get("/t/:token.gif", async (req, res): Promise<void> => {
  const [msg] = await db
    .select()
    .from(outreachMessagesTable)
    .where(eq(outreachMessagesTable.trackingToken, req.params.token))
    .limit(1);
  if (msg && !msg.openedAt && msg.direction === "outbound") {
    await db.update(outreachMessagesTable).set({ openedAt: new Date() }).where(eq(outreachMessagesTable.id, msg.id));
    const [conv] = await db.select().from(outreachConversationsTable).where(eq(outreachConversationsTable.id, msg.conversationId));
    const [lead] = conv ? await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId)) : [];
    if (lead) {
      await logActivity({ type: "email_opened", description: `${leadName(lead)} opened "${msg.subject ?? "your email"}"`, channel: "email", leadId: lead.id });
    }
  }
  res.set({ "content-type": "image/gif", "cache-control": "no-store, max-age=0" }).send(PIXEL);
});

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#f6f5f2;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;padding:32px 40px;border-radius:12px;max-width:420px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.08)"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#555;margin:0">${body}</p></div></body></html>`;

router.get("/unsubscribe/:token", async (req, res): Promise<void> => {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.unsubscribeToken, req.params.token)).limit(1);
  if (!lead) {
    res.status(404).send(page("Link not recognised", "This unsubscribe link is invalid or has expired."));
    return;
  }
  if (lead.status !== "unsubscribed") {
    await db.update(leadsTable).set({ status: "unsubscribed", nextStepAt: null }).where(eq(leadsTable.id, lead.id));
    await logActivity({ type: "unsubscribed", description: `${leadName(lead)} unsubscribed via email link`, channel: "email", leadId: lead.id });
  }
  const settings = await getSettings();
  res.send(page("You're unsubscribed", `You won't receive further messages from ${settings.companyName}.`));
});

// One-click unsubscribe (RFC 8058) posts to the same URL.
router.post("/unsubscribe/:token", async (req, res): Promise<void> => {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.unsubscribeToken, req.params.token)).limit(1);
  if (lead && lead.status !== "unsubscribed") {
    await db.update(leadsTable).set({ status: "unsubscribed", nextStepAt: null }).where(eq(leadsTable.id, lead.id));
    await logActivity({ type: "unsubscribed", description: `${leadName(lead)} unsubscribed`, channel: "email", leadId: lead.id });
  }
  res.sendStatus(200);
});

router.post("/webhooks/voice", async (req, res): Promise<void> => {
  // Answer right away; the end-of-call report triggers an AI summary that takes a few seconds.
  res.json({ ok: true });
  handleVoiceEvent(req.body).catch((err) => logger.error({ err }, "Voice webhook failed"));
});

/** Unipile "message_received" webhook: LinkedIn replies flow into the same AI reply loop as email. */
router.post("/webhooks/unipile", async (req, res): Promise<void> => {
  res.json({ ok: true });
  try {
    const b = req.body ?? {};
    if (b.event && b.event !== "message_received") return;
    const sender = b.sender ?? {};
    const ownId = b.account_info?.user_id;
    if (!sender.attendee_provider_id || sender.attendee_provider_id === ownId || b.is_sender) return;
    const ident = sender.attendee_profile_url ? linkedinIdentifier(sender.attendee_profile_url) : null;
    const [lead] = await db
      .select()
      .from(leadsTable)
      .where(
        or(
          eq(leadsTable.linkedinProviderId, sender.attendee_provider_id),
          ...(ident ? [ilike(leadsTable.linkedinUrl, `%/in/${ident}%`)] : []),
        ),
      )
      .limit(1);
    const text: string = b.message ?? b.text ?? "";
    if (!lead || !text.trim()) return;
    if (b.message_id) {
      const [dupe] = await db.select({ id: outreachMessagesTable.id }).from(outreachMessagesTable).where(eq(outreachMessagesTable.externalId, b.message_id)).limit(1);
      if (dupe) return;
    }
    const conv = await getOrCreateConversation(lead, "linkedin", lead.campaignId, null);
    await processInbound(conv.id, { body: text, externalId: b.message_id ?? null });
  } catch (err) {
    logger.error({ err }, "Unipile webhook failed");
  }
});

export default router;
