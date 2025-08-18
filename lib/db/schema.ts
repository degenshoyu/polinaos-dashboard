// lib/db/schema.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * ⚠️ One-time extension (handled by migration):
 *   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
 */
export const _enablePgcrypto = sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`;

/* ===================== users ===================== */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  walletAddress: text("wallet_address").notNull().unique(), // lowercase
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  searches: many(searches),
}));

/* ===================== searches ===================== */
export const searches = pgTable(
  "searches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    anonSessionId: text("anon_session_id"),
    queryJson: jsonb("query_json").notNull(),
    jobId: text("job_id").notNull(),
    source: text("source").default("ctsearch"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byUserCreated: index("idx_searches_user_created").on(t.userId, t.createdAt),
    byAnonCreated: index("idx_searches_anon_created").on(
      t.anonSessionId,
      t.createdAt,
    ),
    byJob: index("idx_searches_job").on(t.jobId),
  }),
);

export const searchesRelations = relations(searches, ({ one, many }) => ({
  user: one(users, {
    fields: [searches.userId],
    references: [users.id],
  }),
  aiUnderstands: many(aiUnderstandings),
}));

/* ===================== ai_understandings ===================== */
export const aiUnderstandings = pgTable("ai_understandings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  searchId: uuid("search_id")
    .notNull()
    .references(() => searches.id, { onDelete: "cascade" }),
  model: text("model").default("gemini-1.5-pro"),
  resultJson: jsonb("result_json").notNull(),
  summaryText: text("summary_text"),
  tokensInput: integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const aiRelations = relations(aiUnderstandings, ({ one }) => ({
  search: one(searches, {
    fields: [aiUnderstandings.searchId],
    references: [searches.id],
  }),
}));

/* ===================== Inferred Types ===================== */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;

export type AIUnderstanding = typeof aiUnderstandings.$inferSelect;
export type NewAIUnderstanding = typeof aiUnderstandings.$inferInsert;
