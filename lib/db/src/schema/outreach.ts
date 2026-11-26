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
