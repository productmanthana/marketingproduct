import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, mailboxesTable, type MailboxRow } from "@workspace/db";
import {
  CreateMailboxBody,
  DeleteMailboxParams,
  ListMailboxesResponse,
  SyncMailboxesResponse,
  TestIntegrationBody,
  TestMailboxParams,
  UpdateMailboxBody,
  UpdateMailboxParams,
  UpdateMailboxResponse,
} from "@workspace/api-zod";
import { sentTodayOf, todayLimit, unipileConfigured, unipileFetch, verifySmtp } from "../lib/delivery";
import { syncAllMailboxes, verifyImap } from "../lib/inbox-sync";
import { voiceFetch } from "../lib/calls";
import { getSettings } from "../lib/outreach";

const router: IRouter = Router();

/** Passwords never leave the server. */
function serialize(m: MailboxRow) {
  const { smtpPass, imapPass, ...rest } = m;
  return { ...rest, sentToday: sentTodayOf(m), todayLimit: todayLimit(m) };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

router.get("/mailboxes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(mailboxesTable).orderBy(asc(mailboxesTable.id));
  res.json(ListMailboxesResponse.parse(rows.map(serialize)));
});

router.post("/mailboxes", async (req, res): Promise<void> => {
  const parsed = CreateMailboxBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(mailboxesTable)
    .values({ ...parsed.data, imapHost: parsed.data.imapHost || null })
    .returning();
  res.status(201).json(serialize(row!));
});

router.post("/mailboxes/sync", async (_req, res): Promise<void> => {
  res.json(SyncMailboxesResponse.parse(await syncAllMailboxes()));
});

router.patch("/mailboxes/:id", async (req, res): Promise<void> => {
  const params = UpdateMailboxParams.safeParse(req.params);
  const parsed = UpdateMailboxBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const changes = { ...parsed.data };
  // Empty password fields mean "keep the stored one".
  if (!changes.smtpPass) delete changes.smtpPass;
  if (!changes.imapPass) delete changes.imapPass;
  const [row] = await db.update(mailboxesTable).set(changes).where(eq(mailboxesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Mailbox not found" });
    return;
  }
  res.json(UpdateMailboxResponse.parse(serialize(row)));
});

router.delete("/mailboxes/:id", async (req, res): Promise<void> => {
  const params = DeleteMailboxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(mailboxesTable).where(eq(mailboxesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/mailboxes/:id/test", async (req, res): Promise<void> => {
  const params = TestMailboxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [m] = await db.select().from(mailboxesTable).where(eq(mailboxesTable.id, params.data.id));
  if (!m) {
    res.status(404).json({ error: "Mailbox not found" });
    return;
  }
  try {
    await verifySmtp(m);
  } catch (err) {
    res.json({ ok: false, message: `SMTP: ${errorMessage(err)}` });
    return;
  }
  if (m.imapHost) {
    try {
      await verifyImap(m);
    } catch (err) {
      res.json({ ok: false, message: `SMTP works, IMAP failed: ${errorMessage(err)}` });
      return;
    }
  }
  await db.update(mailboxesTable).set({ lastError: null }).where(eq(mailboxesTable.id, m.id));
  res.json({ ok: true, message: m.imapHost ? "SMTP and IMAP connected" : "SMTP connected (add IMAP to detect replies)" });
});

router.post("/integrations/test", async (req, res): Promise<void> => {
  const parsed = TestIntegrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const s = await getSettings();
  try {
    if (parsed.data.provider === "linkedin") {
      if (!unipileConfigured(s)) {
        res.json({ ok: false, message: "Add the Unipile DSN, API key and account id first" });
        return;
      }
      const acc = await unipileFetch(s, `/api/v1/accounts/${encodeURIComponent(s.unipileAccountId)}`);
      res.json({ ok: true, message: `Connected to ${acc.name ?? "LinkedIn account"} (${acc.type ?? "LINKEDIN"})` });
      return;
    }
    if (!s.voiceApiKey || !s.voicePhoneNumberId) {
      res.json({ ok: false, message: "Add the voice API key and phone number id first" });
      return;
    }
    const num = await voiceFetch(s, `/phone-number/${encodeURIComponent(s.voicePhoneNumberId)}`);
    res.json({ ok: true, message: `Voice agent ready on ${num.number ?? num.name ?? s.voicePhoneNumberId}` });
  } catch (err) {
    res.json({ ok: false, message: errorMessage(err) });
  }
});

export default router;
