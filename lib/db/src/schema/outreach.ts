import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  goal: text("goal").notNull(),
  productPitch: text("product_pitch"),
  autoReply: boolean("auto_reply").notNull().default(true),
  replyTone: text("reply_tone").notNull().default("friendly and concise"),
  meetingLink: text("meeting_link"),
  sendGapMinutes: integer("send_gap_minutes").notNull().default(0),
  /** Total spend on this campaign (data, tools, ads), in the CRM currency; used for cost per meeting. */
  cost: integer("cost").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sequenceStepsTable = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaignsTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  channel: text("channel").notNull(),
  delayDays: integer("delay_days").notNull().default(0),
  delayHours: integer("delay_hours").notNull().default(0),
  subject: text("subject"),
  template: text("template").notNull(),
  /** A/B test: version B of the subject and message. Null means no test. */
  variantSubject: text("variant_subject"),
  variantTemplate: text("variant_template"),
  /** "a" or "b" once a winner is picked; afterwards everyone gets the winner. */
  abWinner: text("ab_winner"),
});

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  company: text("company"),
  title: text("title"),
  industry: text("industry"),
  status: text("status").notNull().default("new"),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, {
    onDelete: "set null",
  }),
  /** CRM account (company) this lead is a contact of. No FK to avoid a schema import cycle; cleared on account delete. */
  accountId: integer("account_id"),
  currentStep: integer("current_step").notNull().default(0),
  nextStepAt: timestamp("next_step_at", { withTimezone: true }),
  /** Hours this person waits for message 1 after Start; null follows the campaign's group pace. */
  firstWaitHours: integer("first_wait_hours"),
  notes: text("notes"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  website: text("website"),
  fitScore: integer("fit_score"),
  fitReason: text("fit_reason"),
  companySize: text("company_size"),
  companyLocation: text("company_location"),
  companyLinkedinUrl: text("company_linkedin_url"),
  apolloId: text("apollo_id"),
  linkedinProviderId: text("linkedin_provider_id"),
  /** Team member who owns this lead and its inbox threads. */
  ownerId: integer("owner_id"),
  /** valid | risky | invalid | bounced | null (not checked yet) */
  emailStatus: text("email_status"),
  emailCheckedAt: timestamp("email_checked_at", { withTimezone: true }),
  /** IANA time zone of the person, used to send inside their own working hours. */
  timezone: text("timezone"),
  /** Buying signals found by the AI (hiring, funding, launches...), one per line. */
  signals: text("signals"),
  signalsAt: timestamp("signals_at", { withTimezone: true }),
  unsubscribeToken: text("unsubscribe_token").notNull().default(sql`gen_random_uuid()::text`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outreachConversationsTable = pgTable("outreach_conversations", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, {
    onDelete: "set null",
  }),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("open"),
  sentiment: text("sentiment"),
  subject: text("subject"),
  unread: boolean("unread").notNull().default(false),
  mailboxId: integer("mailbox_id"),
  externalThreadId: text("external_thread_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outreachMessagesTable = pgTable("outreach_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => outreachConversationsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  author: text("author").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("recorded"),
  deliveryError: text("delivery_error"),
  externalId: text("external_id"),
  trackingToken: text("tracking_token").notNull().default(sql`gen_random_uuid()::text`),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  clickCount: integer("click_count").notNull().default(0),
  /** Sequence step and A/B version that produced this message (null for replies and manual sends). */
  stepOrder: integer("step_order"),
  variant: text("variant"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leadsTable.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => campaignsTable.id, {
    onDelete: "set null",
  }),
  objective: text("objective"),
  status: text("status").notNull().default("scheduled"),
  outcome: text("outcome"),
  script: text("script"),
  notes: text("notes"),
  summary: text("summary"),
  nextStep: text("next_step"),
  durationSeconds: integer("duration_seconds"),
  mode: text("mode").notNull().default("manual"),
  providerCallId: text("provider_call_id"),
  transcript: text("transcript"),
  recordingUrl: text("recording_url"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  /** 1 for the first try, 2 for the automatic retry after no answer. */
  attempt: integer("attempt").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  channel: text("channel"),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  accountId: integer("account_id"),
  dealId: integer("deal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingsTable = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  senderName: text("sender_name").notNull().default("Alex"),
  companyName: text("company_name").notNull().default("Your Company"),
  signature: text("signature").notNull().default(""),
  defaultTone: text("default_tone").notNull().default("friendly and concise"),
  globalAutoReply: boolean("global_auto_reply").notNull().default(true),
  escalateNegative: boolean("escalate_negative").notNull().default(true),
  icpDescription: text("icp_description").notNull().default(""),
  publicBaseUrl: text("public_base_url").notNull().default(""),
  trackOpens: boolean("track_opens").notNull().default(true),
  unsubscribeFooter: boolean("unsubscribe_footer").notNull().default(true),
  sendWindowStart: integer("send_window_start").notNull().default(8),
  sendWindowEnd: integer("send_window_end").notNull().default(18),
  sendWeekdaysOnly: boolean("send_weekdays_only").notNull().default(true),
  timezone: text("timezone").notNull().default("UTC"),
  unipileDsn: text("unipile_dsn").notNull().default(""),
  unipileApiKey: text("unipile_api_key").notNull().default(""),
  unipileAccountId: text("unipile_account_id").notNull().default(""),
  linkedinDailyLimit: integer("linkedin_daily_limit").notNull().default(25),
  voiceApiBaseUrl: text("voice_api_base_url").notNull().default("https://api.vapi.ai"),
  voiceApiKey: text("voice_api_key").notNull().default(""),
  voicePhoneNumberId: text("voice_phone_number_id").notNull().default(""),
  voiceName: text("voice_name").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  // Google Calendar auto-scheduling
  googleRefreshToken: text("google_refresh_token").notNull().default(""),
  googleEmail: text("google_email").notNull().default(""),
  meetingStartHour: integer("meeting_start_hour").notNull().default(10),
  meetingEndHour: integer("meeting_end_hour").notNull().default(18),
  meetingMinutes: integer("meeting_minutes").notNull().default(20),
  // Cal.com scheduling (used instead of Google when an API key is set)
  calcomApiKey: text("calcom_api_key").notNull().default(""),
  calcomEventTypeId: integer("calcom_event_type_id"),
  calcomEventLength: integer("calcom_event_length"),
  /** Send each person's sequence steps inside the send window of their own time zone. */
  sendInLeadTimezone: boolean("send_in_lead_timezone").notNull().default(true),
  /** Pause a campaign automatically when this share of its emails bounce (percent, 0 = never). */
  bouncePausePercent: integer("bounce_pause_percent").notNull().default(5),
  /** Hours before a meeting to email the prospect a reminder (0 = off). */
  meetingReminderHours: integer("meeting_reminder_hours").notNull().default(2),
  /** Warm-up emails each mailbox sends per day to your other mailboxes. */
  warmupPerDay: integer("warmup_per_day").notNull().default(10),
  /** Dial queued calls automatically with the AI voice agent inside the send window. */
  autoDialEnabled: boolean("auto_dial_enabled").notNull().default(false),
  /** Maximum AI calls started per day. */
  callDailyLimit: integer("call_daily_limit").notNull().default(100),
  /** AI calls allowed to run at the same time. */
  callConcurrency: integer("call_concurrency").notNull().default(3),
});

export const mailboxesTable = pgTable("mailboxes", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user").notNull(),
  smtpPass: text("smtp_pass").notNull(),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port").notNull().default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  imapUser: text("imap_user"),
  imapPass: text("imap_pass"),
  dailyLimit: integer("daily_limit").notNull().default(50),
  warmupEnabled: boolean("warmup_enabled").notNull().default(true),
  warmupStart: integer("warmup_start").notNull().default(5),
  warmupIncrement: integer("warmup_increment").notNull().default(3),
  sentToday: integer("sent_today").notNull().default(0),
  sentDate: text("sent_date"),
  warmupSentToday: integer("warmup_sent_today").notNull().default(0),
  warmupDate: text("warmup_date"),
  /** Warm-up emails received by this mailbox: total, and how many had landed in spam (and were rescued). */
  warmupReceived: integer("warmup_received").notNull().default(0),
  warmupSpam: integer("warmup_spam").notNull().default(0),
  active: boolean("active").notNull().default(true),
  lastUid: integer("last_uid"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  done: boolean("done").notNull().default(false),
  source: text("source").notNull().default("manual"),
  dealId: integer("deal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageCountersTable = pgTable("usage_counters", {
  key: text("key").primaryKey(),
  day: text("day").notNull(),
  count: integer("count").notNull().default(0),
});

export type CampaignRow = typeof campaignsTable.$inferSelect;
export type LeadRow = typeof leadsTable.$inferSelect;
export type SequenceStepRow = typeof sequenceStepsTable.$inferSelect;
export type ConversationRow = typeof outreachConversationsTable.$inferSelect;
export type MessageRow = typeof outreachMessagesTable.$inferSelect;
export type CallRow = typeof callsTable.$inferSelect;
export type SettingsRow = typeof settingsTable.$inferSelect;
export type MailboxRow = typeof mailboxesTable.$inferSelect;
export type TaskRow = typeof tasksTable.$inferSelect;
