import { pgTable, text, serial, integer, bigint, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { leadsTable } from "./outreach";
import { dealsTable } from "./crm";

/** Approved answers the AI uses when a prospect pushes back (price, timing, competitor...). */
export const objectionsTable = pgTable("objections", {
  id: serial("id").primaryKey(),
  objection: text("objection").notNull(),
  answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Do-not-contact list across every channel. kind: email | domain | phone | linkedin */
export const suppressionsTable = pgTable("suppressions", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  value: text("value").notNull().unique(),
  reason: text("reason").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** People on the team. role: admin | member */
export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Meetings with prospects: booked by the AI (Google/Cal.com) or logged by hand. status: scheduled | completed | canceled | no_show */
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
  dealId: integer("deal_id"),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  minutes: integer("minutes").notNull().default(30),
  link: text("link"),
  provider: text("provider").notNull().default("manual"),
  externalId: text("external_id"),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  followUpSubject: text("follow_up_subject"),
  followUpBody: text("follow_up_body"),
  followUpSentAt: timestamp("follow_up_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteItem = { name: string; quantity: number; unitPrice: number };

/** Price quotes sent from a deal. status: draft | sent | accepted | declined */
export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  title: text("title").notNull(),
  items: jsonb("items").$type<QuoteItem[]>().notNull().default([]),
  discountPercent: integer("discount_percent").notNull().default(0),
  taxPercent: integer("tax_percent").notNull().default(0),
  total: bigint("total", { mode: "number" }).notNull().default(0),
  notes: text("notes"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  status: text("status").notNull().default("draft"),
  publicToken: text("public_token").notNull().default(sql`gen_random_uuid()::text`),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ObjectionRow = typeof objectionsTable.$inferSelect;
export type SuppressionRow = typeof suppressionsTable.$inferSelect;
export type TeamMemberRow = typeof teamMembersTable.$inferSelect;
export type MeetingRow = typeof meetingsTable.$inferSelect;
export type QuoteRow = typeof quotesTable.$inferSelect;
