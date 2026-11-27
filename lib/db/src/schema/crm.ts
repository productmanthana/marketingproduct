import { pgTable, text, serial, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { leadsTable } from "./outreach";

/** Companies. Leads link to an account through `leads.account_id` (the account's contacts). */
export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  industry: text("industry"),
  size: text("size"),
  location: text("location"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  type: text("type").notNull().default("prospect"),
  annualRevenue: bigint("annual_revenue", { mode: "number" }),
  ownerName: text("owner_name"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Opportunities moving through the sales pipeline. */
export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
  leadId: integer("lead_id").references(() => leadsTable.id, { onDelete: "set null" }),
  stage: text("stage").notNull().default("prospecting"),
  amount: bigint("amount", { mode: "number" }).notNull().default(0),
  probability: integer("probability").notNull().default(10),
  closeDate: timestamp("close_date", { withTimezone: true }),
  ownerName: text("owner_name"),
  nextStep: text("next_step"),
  lostReason: text("lost_reason"),
  description: text("description"),
  source: text("source").notNull().default("manual"),
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "cascade" }),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AccountRow = typeof accountsTable.$inferSelect;
export type DealRow = typeof dealsTable.$inferSelect;
export type NoteRow = typeof notesTable.$inferSelect;
