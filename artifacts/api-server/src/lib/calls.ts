import { and, asc, eq, notInArray } from "drizzle-orm";
import {
  db,
  callsTable,
  campaignsTable,
  dealsTable,
  leadsTable,
  notesTable,
  outreachConversationsTable,
  outreachMessagesTable,
  type CallRow,
  type SettingsRow,
} from "@workspace/db";
import { generateCallScript, summarizeCall, voiceAgentPrompt } from "./ai";
import { queueRetryIfUnanswered } from "./auto-dialer";
import { createTask, getOrCreateConversation, getSettings, leadName, logActivity, recordOutbound } from "./outreach";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadCallContext(call: CallRow) {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, call.leadId));
  const campaignId = call.campaignId ?? lead!.campaignId;
  const campaign = campaignId
    ? ((await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId)))[0] ?? null)
    : null;
  return { lead: lead!, campaign, settings: await getSettings() };
}

/** Writes (and stores) an AI call script that references the lead's prior written touchpoints. */
export async function writeScript(call: CallRow): Promise<string> {
  const ctx = await loadCallContext(call);
  const prior = await db
    .select({ channel: outreachMessagesTable.channel, direction: outreachMessagesTable.direction, body: outreachMessagesTable.body })
    .from(outreachMessagesTable)
    .innerJoin(outreachConversationsTable, eq(outreachMessagesTable.conversationId, outreachConversationsTable.id))
    .where(eq(outreachConversationsTable.leadId, call.leadId))
    .orderBy(asc(outreachMessagesTable.createdAt))
    .limit(10);
  const script = await generateCallScript({
    ...ctx,
    objective: call.objective,
    priorContext: prior.map((p) => `${p.direction === "inbound" ? "Prospect" : "Us"} via ${p.channel}: ${p.body.slice(0, 300)}`).join("\n"),
  });
  await db.update(callsTable).set({ script }).where(eq(callsTable.id, call.id));
  return script;
}

/**
 * AI summary of the call notes (or transcript): sets outcome and next step, updates the lead,
 * creates a follow-up task and sends a recap email when the lead has an address.
 */
export async function summarizeAndFollowUp(call: CallRow): Promise<CallRow> {
  const ctx = await loadCallContext(call);
  const notes = call.notes?.trim() || call.transcript?.trim() || "";
  const result = await summarizeCall({ ...ctx, notes, outcome: call.outcome });
  const [updated] = await db
    .update(callsTable)
    .set({
      summary: result.summary,
      nextStep: result.nextStep,
      outcome: call.outcome ?? result.outcome,
      status: "completed",
    })
    .where(eq(callsTable.id, call.id))
    .returning();
  await db
    .update(leadsTable)
    .set({ status: result.leadStatus, lastContactedAt: new Date(), nextStepAt: null })
    .where(eq(leadsTable.id, ctx.lead.id));

  if (ctx.lead.email && result.followUpEmail) {
    const conv = await getOrCreateConversation(ctx.lead, "email", ctx.campaign?.id ?? null, result.followUpSubject);
    await recordOutbound({
      conversation: conv,
      lead: { ...ctx.lead, status: result.leadStatus },
      body: result.followUpEmail,
      subject: result.followUpSubject,
      author: "ai",
    });
    await logActivity({
      type: "ai_reply",
      description: `AI sent call recap email to ${leadName(ctx.lead)}`,
      channel: "email",
      leadId: ctx.lead.id,
    });
  }
  // Save the summary on the lead's open deal so the CRM has the full picture.
  const [deal] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(and(eq(dealsTable.leadId, ctx.lead.id), notInArray(dealsTable.stage, ["closed_won", "closed_lost"])))
    .limit(1);
  if (deal) {
    await db.insert(notesTable).values({ dealId: deal.id, body: `Call summary (${new Date().toISOString().slice(0, 10)}): ${result.outcome}\n${result.summary}${result.nextStep ? `\nNext step: ${result.nextStep}` : ""}` });
    if (result.nextStep) await db.update(dealsTable).set({ nextStep: result.nextStep, updatedAt: new Date() }).where(eq(dealsTable.id, deal.id));
  }
  if (result.nextStep && result.leadStatus !== "not_interested") {
    await createTask({ title: result.nextStep, leadId: ctx.lead.id, dueAt: new Date(Date.now() + 2 * DAY_MS), source: "call_summary" });
  }
  await logActivity({
    type: "call_completed",
    description: `Call with ${leadName(ctx.lead)} summarized: ${result.outcome}`,
    channel: "call",
    leadId: ctx.lead.id,
  });
  return updated!;
}

// ---------- AI voice agent (Vapi-compatible API: Vapi, OpenRing, ...) ----------

function voiceUrl(s: SettingsRow, path: string): string {
  return `${(s.voiceApiBaseUrl || "https://api.vapi.ai").replace(/\/+$/, "")}${path}`;
}

export async function voiceFetch(s: SettingsRow, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(voiceUrl(s, path), {
    ...init,
    headers: { authorization: `Bearer ${s.voiceApiKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Voice API ${res.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

export async function startAiCall(call: CallRow): Promise<CallRow> {
  const ctx = await loadCallContext(call);
  const s = ctx.settings;
  if (!s.voiceApiKey || !s.voicePhoneNumberId) throw new Error("Connect an AI voice provider in Settings first");
  if (!ctx.lead.phone) throw new Error("This lead has no phone number");
  const phone = ctx.lead.phone.replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error("Phone number must be in international format, e.g. +14155550142");
  const base = s.publicBaseUrl.replace(/\/+$/, "");
  if (!base) throw new Error("Set the public app URL in Settings so the call result can reach this app");
  const script = call.script ?? (await writeScript(call));

  const created = await voiceFetch(s, "/call", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: s.voicePhoneNumberId,
      customer: { number: phone, name: leadName(ctx.lead) },
      metadata: { outreachCallId: call.id },
      assistant: {
        name: `${s.senderName} (${s.companyName})`.slice(0, 40),
        firstMessage: `Hi ${ctx.lead.firstName}, this is ${s.senderName} from ${s.companyName}. Did I catch you at a bad time?`,
        model: {
          provider: "openai",
          model: "gpt-4o",
          messages: [{ role: "system", content: voiceAgentPrompt({ ...ctx, objective: call.objective, script }) }],
        },
        ...(s.voiceName ? { voice: { provider: "vapi", voiceId: s.voiceName } } : {}),
        endCallFunctionEnabled: true,
        serverUrl: `${base}/api/webhooks/voice`,
        serverMessages: ["end-of-call-report", "status-update"],
      },
    }),
  });
  const [updated] = await db
    .update(callsTable)
    .set({ mode: "ai", providerCallId: created.id ?? null, status: "in_progress", script })
    .where(eq(callsTable.id, call.id))
    .returning();
  await logActivity({ type: "call_scheduled", description: `AI agent is calling ${leadName(ctx.lead)}`, channel: "call", leadId: ctx.lead.id });
  return updated!;
}

const NO_ANSWER = /no-answer|did-not-answer|busy|voicemail|failed-to-connect|not-found/i;

/** Handles the provider's server messages; the end-of-call report carries transcript, recording and duration. */
export async function handleVoiceEvent(body: any): Promise<void> {
  const msg = body?.message ?? body;
  const providerId: string | undefined = msg?.call?.id;
  const localId = Number(msg?.call?.metadata?.outreachCallId ?? msg?.call?.assistant?.metadata?.outreachCallId);
  const [call] = providerId
    ? await db.select().from(callsTable).where(eq(callsTable.providerCallId, providerId))
    : Number.isFinite(localId)
      ? await db.select().from(callsTable).where(eq(callsTable.id, localId))
      : [];
  if (!call) return;

  if (msg.type === "status-update" && msg.status === "in-progress") {
    await db.update(callsTable).set({ status: "in_progress" }).where(eq(callsTable.id, call.id));
    return;
  }
  if (msg.type !== "end-of-call-report") return;

  const transcript: string = msg.transcript ?? msg.artifact?.transcript ?? "";
  const recordingUrl: string | null = msg.recordingUrl ?? msg.artifact?.recordingUrl ?? null;
  const duration = Math.round(Number(msg.durationSeconds ?? msg.call?.duration ?? 0)) || null;
  const reason: string = msg.endedReason ?? "";
  const unanswered = NO_ANSWER.test(reason) || !transcript.trim();
  const [updated] = await db
    .update(callsTable)
    .set({
      transcript: transcript || null,
      recordingUrl,
      durationSeconds: duration,
      status: unanswered ? "no_answer" : "completed",
      outcome: unanswered ? `No answer (${reason || "no conversation"})` : call.outcome,
    })
    .where(eq(callsTable.id, call.id))
    .returning();
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, call.leadId));
  if (unanswered) {
    await logActivity({ type: "call_completed", description: `AI call to ${lead ? leadName(lead) : "lead"}: no answer`, channel: "call", leadId: call.leadId });
    await queueRetryIfUnanswered(updated!);
    return;
  }
  await summarizeAndFollowUp(updated!);
}
