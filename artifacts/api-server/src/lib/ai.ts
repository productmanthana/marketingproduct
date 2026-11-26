import { openai } from "@workspace/integrations-openai-ai-server";
import type {
  CampaignRow,
  LeadRow,
  MessageRow,
  SettingsRow,
} from "@workspace/db";

const MODEL = "gpt-5.6-terra";

async function jsonCompletion<T>(system: string, user: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty response");
  return JSON.parse(content) as T;
}

function leadProfile(lead: LeadRow): string {
  return [
    `Name: ${lead.firstName} ${lead.lastName}`.trim(),
    lead.title && `Title: ${lead.title}`,
    lead.company && `Company: ${lead.company}`,
    lead.industry && `Industry: ${lead.industry}`,
    lead.notes && `Notes: ${lead.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function senderContext(settings: SettingsRow, campaign: CampaignRow | null): string {
  return [
    `Sender: ${settings.senderName} from ${settings.companyName}`,
    campaign && `Campaign goal: ${campaign.goal}`,
    campaign?.productPitch && `What we offer: ${campaign.productPitch}`,
    campaign?.meetingLink && `Meeting booking link: ${campaign.meetingLink}`,
    `Tone: ${campaign?.replyTone || settings.defaultTone}`,
    settings.signature && `Email signature:\n${settings.signature}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CHANNEL_RULES: Record<string, string> = {
  email:
    "Channel: cold email. Short subject line (under 8 words, lowercase is fine). Body under 120 words, plain text, one clear call to action. Include the signature at the end if provided.",
  linkedin:
    "Channel: LinkedIn message. No subject. Under 70 words, conversational, no signature, no links unless it is the meeting link.",
  call: "Channel: phone call.",
};

export function fillTemplate(template: string, lead: LeadRow): string {
  return template
    .replace(/\{\{\s*firstName\s*\}\}/g, lead.firstName)
    .replace(/\{\{\s*lastName\s*\}\}/g, lead.lastName)
    .replace(/\{\{\s*company\s*\}\}/g, lead.company ?? "your company")
    .replace(/\{\{\s*title\s*\}\}/g, lead.title ?? "");
}

export async function personalizeMessage(args: {
  lead: LeadRow;
  campaign: CampaignRow;
  settings: SettingsRow;
  channel: string;
  subject: string | null;
  template: string;
  stepNumber: number;
}): Promise<{ subject: string | null; body: string }> {
  const result = await jsonCompletion<{ subject?: string; body: string }>(
    `You are an expert SDR writing personalized outbound messages. Rewrite the template for this specific prospect so it feels hand-written, keeping its intent. Never invent facts about the prospect. ${CHANNEL_RULES[args.channel] ?? ""} Respond as JSON: {"subject": string or null, "body": string}.`,
    `${senderContext(args.settings, args.campaign)}\n\nProspect:\n${leadProfile(args.lead)}\n\nThis is step ${args.stepNumber} of the sequence.\nTemplate subject: ${args.subject ?? "(none)"}\nTemplate:\n${fillTemplate(args.template, args.lead)}`,
  );
  return {
    subject: args.channel === "email" ? (result.subject ?? args.subject ?? null) : null,
    body: result.body,
  };
}

export async function generateSequence(
  campaign: CampaignRow,
  settings: SettingsRow,
): Promise<
  Array<{ channel: "email" | "linkedin" | "call"; delayDays: number; subject: string | null; template: string }>
> {
  const result = await jsonCompletion<{
    steps: Array<{ channel: string; delayDays: number; subject?: string | null; template: string }>;
  }>(
    `You design high-converting multichannel B2B outreach sequences mixing cold email, LinkedIn messages and cold calls. Produce 5-7 steps. Use placeholders {{firstName}}, {{company}}, {{title}}. For call steps, the template is the call objective and key talking points. delayDays is days to wait after the previous step (first step 0). Respond as JSON: {"steps": [{"channel": "email"|"linkedin"|"call", "delayDays": number, "subject": string|null, "template": string}]}.`,
    `${senderContext(settings, campaign)}\nCampaign name: ${campaign.name}\n${campaign.description ?? ""}`,
  );
  return result.steps
    .filter((s) => ["email", "linkedin", "call"].includes(s.channel))
    .map((s, i) => ({
      channel: s.channel as "email" | "linkedin" | "call",
      delayDays: i === 0 ? 0 : Math.max(0, Math.round(s.delayDays ?? 2)),
      subject: s.channel === "email" ? (s.subject ?? null) : null,
      template: s.template,
    }));
}

export async function writePitch(args: {
  campaign: CampaignRow;
  settings: SettingsRow;
  notes: string;
  goal: string;
}): Promise<string> {
  const r = await jsonCompletion<{ pitch: string }>(
    `You help a non-technical business owner describe their offer for cold outreach. Write 2-3 plain, specific sentences: what they sell, who it is for, and the concrete result or benefit (use numbers only if the notes give them; never invent statistics or facts). No hype, no buzzwords, no bullet points. Respond as JSON: {"pitch": string}.`,
    [
      `Company: ${args.settings.companyName}`,
      `Campaign name: ${args.campaign.name}`,
      args.goal && `What they want prospects to do: ${args.goal}`,
      args.notes ? `Their rough notes: ${args.notes}` : "They gave no notes; write a sensible draft from the company and campaign name that they can edit.",
    ].filter(Boolean).join("\n"),
  );
  return (r.pitch ?? "").trim();
}

export type Sentiment =
  | "positive"
  | "neutral"
  | "negative"
  | "objection"
  | "out_of_office"
  | "unsubscribe"
  | "not_now"
  | "referral";

/** Someone the prospect pointed us to instead of themselves. */
export type Referral = { firstName: string; lastName?: string | null; email?: string | null; title?: string | null };

export type ReplyAnalysis = {
  sentiment: Sentiment;
  leadStatus: "replied" | "interested" | "meeting_booked" | "not_interested" | "unsubscribed" | "nurture";
  shouldReply: boolean;
  subject: string | null;
  body: string;
  reasoning: string;
  /** Set when a person must decide or supply something before this reply can go out. */
  needsHuman: string | null;
  /** "YYYY-MM-DD HH:MM" of the free calendar slot the prospect agreed to, when the AI should book it. */
  bookSlot: string | null;
  /** out_of_office: the day they are back. */
  returnDate?: string | null;
  /** not_now: days until reconnecting. */
  followUpDays?: number | null;
  referral?: Referral | null;
  /** The reply follows an answer from the objection library. */
  usedApprovedAnswer?: boolean;
};

/** Free slots on the connected Google Calendar; canBook=false means offer times but never confirm a booking. */
export type CalendarContext = { timezone: string; summary: string; minutes: number; canBook: boolean; inviteNote?: string };

function calendarRules(c: CalendarContext | null | undefined): string {
  if (!c) return "";
  const now = new Date().toLocaleString("en-US", { timeZone: c.timezone, dateStyle: "full", timeStyle: "short" });
  const booking = c.canBook
    ? `If the prospect named a day/time that matches a free slot, or said any time works, set bookSlot to that slot as "YYYY-MM-DD HH:MM" (for "any time" pick the earliest slot) and set leadStatus to meeting_booked; the body confirms the exact day, date and time with the time zone and says ${c.inviteNote ?? "a calendar invite with the meeting link is on its way"}. `
    : `Never confirm a booking; set bookSlot null. `;
  return ` A calendar is connected, so you can schedule ${c.minutes}-minute meetings yourself and do NOT need a booking link. Now it is ${now} (${c.timezone}). Free slots (${c.timezone}):\n${c.summary || "none in the next week"}\n${booking}If they want to meet but gave no time, or their time is not free, offer 2-3 specific free slots (with time zone) and set bookSlot null. Only use the listed slots. Do not set needsHuman just because there is no booking link.`;
}

/** Bracketed fill-ins like "[meeting link]" or "[your product]" that must never reach a prospect. */
export const hasPlaceholder = (text: string) => /\[[^\]\n]{2,60}\]|\{\{[^}]+\}\}/.test(text);

export async function analyzeAndDraftReply(args: {
  lead: LeadRow;
  campaign: CampaignRow | null;
  settings: SettingsRow;
  channel: string;
  history: MessageRow[];
  calendar?: CalendarContext | null;
  objections?: { objection: string; answer: string }[];
}): Promise<ReplyAnalysis> {
  const library = args.objections?.length
    ? ` Approved answers to common objections (when the prospect raises one of these, base your reply on the approved answer, adapted to them, and set usedApprovedAnswer true):\n${args.objections.map((o, i) => `${i + 1}. Objection: ${o.objection}\n   Answer: ${o.answer}`).join("\n")}\n`
    : "";
  const transcript = args.history
    .map(
      (m) =>
        `[${m.direction === "inbound" ? "PROSPECT" : "US"}]${m.subject ? ` (subject: ${m.subject})` : ""}\n${m.body}`,
    )
    .join("\n\n");
  const result = await jsonCompletion<ReplyAnalysis>(
    `You are an autonomous SDR handling replies to outbound outreach. Read the conversation and the prospect's latest message. Classify sentiment as one of: positive, neutral, negative, objection, out_of_office (auto-reply saying they are away), unsubscribe, not_now (interested in principle but asks to reconnect later), referral (says someone else is the right person). Choose leadStatus: replied (generic), interested, meeting_booked (only if they confirmed a time), not_interested, unsubscribed, nurture (for not_now). For out_of_office set returnDate to the date they are back as "YYYY-MM-DD" if stated, else null, and set shouldReply false. For not_now set followUpDays to when to reconnect (e.g. "next quarter" = 90, "next month" = 30; default 90) and reply with a short gracious note. For referral set referral to the person they named {"firstName","lastName","email","title"} (only what they wrote; null fields if unknown) and thank them briefly. Then write the best next reply that moves toward the campaign goal: answer questions directly, handle objections with empathy and one concrete point, propose the meeting link when they show interest, but only if a "Meeting booking link" is given in the context. Never write placeholders or bracketed fill-ins such as [meeting link], [time], [your company]; only use facts from the context. Set needsHuman to a short reason (e.g. "Prospect wants to meet but no booking link is set", "Asked about pricing") whenever the right reply needs something you do not have: a booking link, specific times or dates to offer, pricing, contracts, or any commitment by the team; otherwise set needsHuman null. When needsHuman is set, still write your best draft for the team to edit.${calendarRules(args.calendar)} ${library}If they asked to stop or unsubscribe, set shouldReply false and body to a one-line polite confirmation. Never invent pricing, customers or features that are not in the context; if you lack info, offer to cover it on a call. ${CHANNEL_RULES[args.channel] ?? ""} Respond as JSON: {"sentiment": string, "leadStatus": string, "shouldReply": boolean, "subject": string|null, "body": string, "reasoning": string (one sentence explaining the classification and approach), "needsHuman": string|null, "bookSlot": string|null, "returnDate": string|null, "followUpDays": number|null, "referral": object|null, "usedApprovedAnswer": boolean}.`,
    `${senderContext(args.settings, args.campaign)}\n\nProspect:\n${leadProfile(args.lead)}\n\nConversation so far:\n${transcript}`,
  );
  const placeholder = hasPlaceholder(`${result.subject ?? ""}\n${result.body}`);
  return {
    ...result,
    bookSlot: args.calendar?.canBook ? (result.bookSlot ?? null) : null,
    needsHuman: result.needsHuman || (placeholder ? "Draft contains a placeholder that needs your real details" : null),
    subject: args.channel === "email" ? (result.subject ?? null) : null,
  };
}

export async function generateCallScript(args: {
  lead: LeadRow;
  campaign: CampaignRow | null;
  settings: SettingsRow;
  objective: string | null;
  priorContext: string;
}): Promise<string> {
  const result = await jsonCompletion<{ script: string }>(
    `You write cold call scripts for SDRs. Structure: Opener (permission-based, under 15 seconds), Reason for calling (tailored to the prospect's role), 2-3 discovery questions, Value statement, Ask (book the meeting), and an Objection handling section with 4 common objections and short responses. Use plain text with section headings in caps. Respond as JSON: {"script": string}.`,
    `${senderContext(args.settings, args.campaign)}\n\nProspect:\n${leadProfile(args.lead)}\n\nCall objective: ${args.objective ?? args.campaign?.goal ?? "Book a meeting"}\n\nPrior touchpoints:\n${args.priorContext || "None"}`,
  );
  return result.script;
}

export async function summarizeCall(args: {
  lead: LeadRow;
  campaign: CampaignRow | null;
  settings: SettingsRow;
  notes: string;
  outcome: string | null;
}): Promise<{
  summary: string;
  nextStep: string;
  outcome: string;
  leadStatus: "contacted" | "interested" | "meeting_booked" | "not_interested";
  followUpSubject: string;
  followUpEmail: string;
}> {
  return jsonCompletion(
    `You summarize sales calls. From the rep's notes produce: summary (3-5 bullet lines starting with "- "), outcome (short phrase), nextStep (one sentence), leadStatus (contacted | interested | meeting_booked | not_interested), and a short follow-up email (followUpSubject, followUpEmail) recapping the call, written from the sender, including the signature if provided. Respond as JSON with exactly those keys.`,
    `${senderContext(args.settings, args.campaign)}\n\nProspect:\n${leadProfile(args.lead)}\n\nRep's logged outcome: ${args.outcome ?? "(none)"}\nCall notes:\n${args.notes}`,
  );
}

export async function qualifyLead(args: {
  lead: LeadRow;
  icp: string;
  settings: SettingsRow;
}): Promise<{ score: number; reason: string }> {
  const result = await jsonCompletion<{ score: number; reason: string }>(
    `You qualify B2B leads against an ideal customer profile (ICP). Score fit from 0 (no fit) to 100 (perfect fit) using only the facts given; missing data lowers confidence, not necessarily the score. Give a one or two sentence reason naming the decisive factors. Respond as JSON: {"score": number, "reason": string}.`,
    `Seller: ${args.settings.companyName}\nIdeal customer profile:\n${args.icp}\n\nLead:\n${leadProfile(args.lead)}`,
  );
  return { score: Math.max(0, Math.min(100, Math.round(Number(result.score) || 0))), reason: result.reason };
}

export async function researchCompany(args: {
  lead: LeadRow;
  website: string;
  pageText: string;
}): Promise<{ industry: string | null; summary: string; hooks: string[] }> {
  const result = await jsonCompletion<{ industry?: string | null; summary: string; hooks?: string[] }>(
    `You research prospects for sales outreach. From the company's website text, return: industry (2-4 words), summary (2 sentences on what the company does and for whom), and hooks (2-3 short, specific personalization angles a rep could open with). Only use facts present in the text. Respond as JSON: {"industry": string|null, "summary": string, "hooks": string[]}.`,
    `Prospect:\n${leadProfile(args.lead)}\nWebsite: ${args.website}\n\nWebsite text:\n${args.pageText}`,
  );
  return { industry: result.industry ?? null, summary: result.summary, hooks: (result.hooks ?? []).slice(0, 3) };
}

/** System prompt for the AI voice agent that places the call. */
export function voiceAgentPrompt(args: {
  lead: LeadRow;
  campaign: CampaignRow | null;
  settings: SettingsRow;
  objective: string | null;
  script: string;
}): string {
  return [
    `You are ${args.settings.senderName}, calling on behalf of ${args.settings.companyName}. You are on a live phone call with ${args.lead.firstName}${args.lead.company ? ` at ${args.lead.company}` : ""}.`,
    `Objective: ${args.objective ?? args.campaign?.goal ?? "Book a meeting"}.`,
    args.campaign?.productPitch && `What we offer: ${args.campaign.productPitch}`,
    `Speak naturally in short sentences, one question at a time, and listen. Be honest that you are an AI assistant if asked. If they are busy, offer a better time. If they ask not to be called, apologise, confirm and end the call. Never invent prices, customers or features.`,
    `Follow this call plan loosely:\n${args.script}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function dealInsight(args: {
  deal: { name: string; stage: string; amount: number; probability: number; closeDate: Date | null; nextStep: string | null; description: string | null; createdAt: Date; stageChangedAt: Date };
  currency: string;
  accountName: string | null;
  lead: LeadRow | null;
  notes: string[];
  activity: string[];
  settings: SettingsRow;
}): Promise<{ summary: string; risks: string[]; nextActions: string[]; winLikelihood: number }> {
  const d = args.deal;
  const days = (from: Date) => Math.round((Date.now() - from.getTime()) / 86_400_000);
  const result = await jsonCompletion<{ summary: string; risks?: string[]; nextActions?: string[]; winLikelihood?: number }>(
    `You are a sales manager reviewing one B2B opportunity. Using only the facts given, return: summary (2 sentences on where the deal stands), risks (0-3 short, specific risks such as a stale stage, missing close date, no recent contact, no decision maker), nextActions (2-3 concrete next steps the rep should take this week), winLikelihood (0-100). Respond as JSON: {"summary": string, "risks": string[], "nextActions": string[], "winLikelihood": number}.`,
    [
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Seller: ${args.settings.companyName}`,
      `Deal: ${d.name}`,
      `Stage: ${d.stage} (for ${days(d.stageChangedAt)} days), open ${days(d.createdAt)} days`,
      `Amount: ${d.amount} ${args.currency}, rep probability ${d.probability}%`,
      `Close date: ${d.closeDate ? d.closeDate.toISOString().slice(0, 10) : "not set"}`,
      d.nextStep && `Next step: ${d.nextStep}`,
      d.description && `Description: ${d.description}`,
      args.accountName && `Account: ${args.accountName}`,
      args.lead && `Primary contact:\n${leadProfile(args.lead)}\nLead status: ${args.lead.status}`,
      args.notes.length && `Notes:\n${args.notes.join("\n")}`,
      args.activity.length && `Recent activity (newest first):\n${args.activity.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    summary: result.summary,
    risks: (result.risks ?? []).slice(0, 3),
    nextActions: (result.nextActions ?? []).slice(0, 3),
    winLikelihood: Math.max(0, Math.min(100, Math.round(Number(result.winLikelihood) || 0))),
  };
}

export async function meetingFollowUp(args: {
  lead: LeadRow;
  campaign: CampaignRow | null;
  settings: SettingsRow;
  meetingTitle: string;
  when: string;
  notes: string | null;
}): Promise<{ subject: string; body: string }> {
  const r = await jsonCompletion<{ subject: string; body: string }>(
    `You write the follow-up email a salesperson sends right after a meeting with a prospect. Thank them for their time, recap what was discussed (only from the notes; if there are no notes keep the recap general and do not invent details), and propose one clear next step toward the campaign goal. Under 130 words, plain text, warm and professional, include the signature if provided. Never use placeholders or brackets. Respond as JSON: {"subject": string, "body": string}.`,
    `${senderContext(args.settings, args.campaign)}\n\nProspect:\n${leadProfile(args.lead)}\n\nMeeting: ${args.meetingTitle} on ${args.when}\nMeeting notes:\n${args.notes?.trim() || "(none)"}`,
  );
  return { subject: r.subject, body: r.body };
}

export async function detectSignals(args: { lead: LeadRow; pages: { url: string; text: string }[] }): Promise<string[]> {
  const r = await jsonCompletion<{ signals?: string[] }>(
    `You look for buying signals on a company's website for B2B sales: hiring (name the roles), recent funding or investment, new product or service launches, expansion (new offices, markets, locations), new leadership, partnerships or awards. Use only facts clearly stated in the text, and include the date when the text gives one. Return at most 4 short signals (under 15 words each), most recent and relevant first. Return an empty list when there are none. Respond as JSON: {"signals": string[]}.`,
    `Company: ${args.lead.company ?? "(unknown)"}\n\n${args.pages.map((p) => `Page ${p.url}:\n${p.text}`).join("\n\n")}`,
  );
  return (r.signals ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
}
