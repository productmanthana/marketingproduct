import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

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
  currentStep: integer("current_step").notNull().default(0),
  nextStepAt: timestamp("next_step_at", { withTimezone: true }),
  notes: text("notes"),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
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
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  channel: text("channel"),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
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
});

export type CampaignRow = typeof campaignsTable.$inferSelect;
export type LeadRow = typeof leadsTable.$inferSelect;
export type SequenceStepRow = typeof sequenceStepsTable.$inferSelect;
export type ConversationRow = typeof outreachConversationsTable.$inferSelect;
export type MessageRow = typeof outreachMessagesTable.$inferSelect;
export type CallRow = typeof callsTable.$inferSelect;
export type SettingsRow = typeof settingsTable.$inferSelect;
