import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import {
  db,
  campaignsTable,
  leadsTable,
  objectionsTable,
  outreachConversationsTable,
  outreachMessagesTable,
} from "@workspace/db";
import {
  DraftAiReplyParams,
  DraftAiReplyResponse,
  GetConversationParams,
  GetConversationResponse,
  InboundWebhookBody,
  ListConversationsQueryParams,
  ListConversationsResponse,
  ReceiveInboundBody,
  ReceiveInboundParams,
  SendMessageBody,
  SendMessageParams,
  UpdateConversationBody,
  UpdateConversationParams,
} from "@workspace/api-zod";
import { analyzeAndDraftReply } from "../lib/ai";
import { calendarContext, schedulerFor } from "../lib/scheduling";
import {
  getConversationDetail,
  getOrCreateConversation,
  getSettings,
  leadName,
  logActivity,
  processInbound,
  recordOutbound,
  serializeConversations,
} from "../lib/outreach";

const router: IRouter = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  const q = ListConversationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds: SQL[] = [];
  if (q.data.channel) conds.push(eq(outreachConversationsTable.channel, q.data.channel));
  if (q.data.status) conds.push(eq(outreachConversationsTable.status, q.data.status));
  if (q.data.ownerId) {
    conds.push(inArray(outreachConversationsTable.leadId, db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.ownerId, q.data.ownerId))));
  }
  const rows = await db
    .select()
    .from(outreachConversationsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(outreachConversationsTable.lastMessageAt));
  res.json(ListConversationsResponse.parse(await serializeConversations(rows)));
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await getConversationDetail(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json(GetConversationResponse.parse(detail));
});

router.patch("/conversations/:id", async (req, res): Promise<void> => {
  const params = UpdateConversationParams.safeParse(req.params);
  const parsed = UpdateConversationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [conv] = await db
    .update(outreachConversationsTable)
    .set(parsed.data)
    .where(eq(outreachConversationsTable.id, params.data.id))
    .returning();
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const [out] = await serializeConversations([conv]);
  res.json(out);
});

router.post("/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = SendMessageParams.safeParse(req.params);
  const parsed = SendMessageBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const [conv] = await db
    .select()
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
  const message = await recordOutbound({
    conversation: conv,
    lead: lead!,
    body: parsed.data.body,
    subject: parsed.data.subject ?? null,
    author: "user",
  });
  await db
    .update(outreachConversationsTable)
    .set({ status: "open" })
    .where(eq(outreachConversationsTable.id, conv.id));
  await logActivity({
    type: "message_sent",
    description: `You replied to ${leadName(lead!)}`,
    channel: conv.channel,
    leadId: lead!.id,
  });
  res.status(201).json(message);
});

router.post("/conversations/:id/inbound", async (req, res): Promise<void> => {
  const params = ReceiveInboundParams.safeParse(req.params);
  const parsed = ReceiveInboundBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const exists = await getConversationDetail(params.data.id);
  if (!exists) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  await processInbound(params.data.id, parsed.data);
  res.json(GetConversationResponse.parse(await getConversationDetail(params.data.id)));
});

router.post("/conversations/:id/ai-draft", async (req, res): Promise<void> => {
  const params = DraftAiReplyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conv] = await db
    .select()
    .from(outreachConversationsTable)
    .where(eq(outreachConversationsTable.id, params.data.id));
  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, conv.leadId));
  const campaignId = conv.campaignId ?? lead!.campaignId;
  const campaign = campaignId
    ? ((await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)))[0] ?? null)
    : null;
  const history = await db
    .select()
    .from(outreachMessagesTable)
    .where(eq(outreachMessagesTable.conversationId, conv.id))
    .orderBy(asc(outreachMessagesTable.createdAt), asc(outreachMessagesTable.id));
  const settings = await getSettings();
  const scheduler = schedulerFor(settings);
  const free = scheduler ? await scheduler.findFreeSlots().catch(() => null) : null;
  const draft = await analyzeAndDraftReply({
    lead: lead!,
    campaign,
    settings,
    channel: conv.channel,
    history,
    objections: await db.select().from(objectionsTable),
    calendar: free && scheduler && { ...(await calendarContext(lead!, free, scheduler)), canBook: false },
  });
  res.json(
    DraftAiReplyResponse.parse({
      subject: draft.subject,
      body: draft.body,
      sentiment: draft.sentiment,
      reasoning: draft.reasoning,
      needsHuman: draft.needsHuman,
    }),
  );
});

router.post("/webhooks/inbound", async (req, res): Promise<void> => {
  const parsed = InboundWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { channel, fromEmail, fromLinkedinUrl, fromPhone } = parsed.data;
  let match: SQL | undefined;
  if (fromEmail) match = ilike(leadsTable.email, fromEmail.trim());
  else if (fromLinkedinUrl) match = ilike(leadsTable.linkedinUrl, `%${fromLinkedinUrl.replace(/\/$/, "").split("/").pop()}%`);
  else if (fromPhone) match = eq(leadsTable.phone, fromPhone.trim());
  const [lead] = match ? await db.select().from(leadsTable).where(match).limit(1) : [];
  if (!lead) {
    res.status(404).json({ error: "No lead matches the sender" });
    return;
  }
  const conv = await getOrCreateConversation(lead, channel, lead.campaignId, parsed.data.subject ?? null);
  await processInbound(conv.id, { body: parsed.data.body, subject: parsed.data.subject });
  res.json(GetConversationResponse.parse(await getConversationDetail(conv.id)));
});

export default router;
