// lib/db/schema.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  serial,
  integer,
  numeric,
  index,
  boolean,
  bigint,
  pgEnum,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * One-time extension (handled by migration):
 *   CREATE EXTENSION IF NOT EXISTS "pgcrypto";
 */
export const _enablePgcrypto = sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`;

/* ========== Common timestamps ========== */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/* ===================== users ===================== */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  walletAddress: text("wallet_address").notNull().unique(), // lowercase
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
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
    ...timestamps,
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
  user: one(users, { fields: [searches.userId], references: [users.id] }),
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
  ...timestamps,
});

export const aiRelations = relations(aiUnderstandings, ({ one }) => ({
  search: one(searches, {
    fields: [aiUnderstandings.searchId],
    references: [searches.id],
  }),
}));

/* ===================== Enums (KOL) ===================== */
export const tweetType = pgEnum("tweet_type", [
  "tweet",
  "retweet",
  "quote",
  "reply",
]);
export const mentionSource = pgEnum("mention_source", [
  "ca",
  "ticker",
  "phrase",
  "hashtag",
  "upper",
  "llm",
]);

/* ===================== token_resolution_issues ===================== */
export const tokenResolutionIssues = pgTable(
  "token_resolution_issues",
  {
    id: serial("id").primaryKey(),
    // reuse mentionSource enum for kind (ticker/phrase)
    kind: mentionSource("kind").notNull(),
    // normalized key: e.g. "WIF" for ticker, "dogwifhat" for phrase
    normKey: text("norm_key").notNull(),
    // human-readable last sample (raw trigger text / phrase)
    sample: text("sample"),
    // last error & reason (e.g. "resolver_miss", "missing_meta")
    lastReason: text("last_reason"),
    lastError: text("last_error"),
    // last sighting
    lastTweetId: text("last_tweet_id"),
    lastTriggerKey: text("last_trigger_key"),
    // how many times we have seen this unresolved key
    seenCount: integer("seen_count").notNull().default(1),
    // optional candidates snapshot for debugging (addr list, metrics, etc.)
    candidates: jsonb("candidates"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("res_issue_kind_key_uniq").on(t.kind, t.normKey),
    idxUpdated: index("res_issue_updated_idx").on(t.updatedAt),
  }),
);

/* ===================== coin_ca_ticker ===================== */
// Knowledge base for mapping Ticker <-> Contract Address (Solana-first).
export const coinCaTicker = pgTable(
  "coin_ca_ticker",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    // Core mapping
    tokenTicker: text("token_ticker").notNull(), // e.g. "BONK"
    contractAddress: text("contract_address").notNull(), // Solana mint (base58)
    tokenName: text("token_name"), // e.g. "Bonk"

    // Pricing / liquidity hints (optional, can be backfilled later)
    primaryPoolAddress: text("primary_pool_address"),

    // On-chain provenance (optional)
    mintAuthority: text("mint_authority"),
    updateAuthority: text("update_authority"),
    mintAt: timestamp("mint_at", { withTimezone: true }),
    creatorAddress: text("creator_address"),
    hasMintAuth: boolean("has_mint_auth"),
    hasFreezeAuth: boolean("has_freeze_auth"),

    // Metadata / socials (optional)
    tokenMetadata: jsonb("token_metadata"), // JSON blob
    websiteUrl: text("website_url"),
    telegramUrl: text("telegram_url"),
    twitterUrl: text("twitter_url"),

    // Manual disambiguation knob: higher wins when same ticker has multiple CAs
    priority: integer("priority"), // NULL = unknown

    ...timestamps,
  },
  (t) => ({
    uniqTickerCa: uniqueIndex("uniq_coin_ca_ticker_ticker_ca").on(
      t.tokenTicker,
      t.contractAddress,
    ),
    byTicker: index("idx_coin_ca_ticker_ticker").on(t.tokenTicker),
    byCa: index("idx_coin_ca_ticker_ca").on(t.contractAddress),
    byPriority: index("idx_coin_ca_ticker_priority").on(t.priority),
    byUpdateAuthority: index("idx_coin_ca_ticker_update_authority").on(
      t.updateAuthority,
    ),
  }),
);

/* ===================== kols ===================== */
export const kols = pgTable(
  "kols",
  {
    twitterUid: text("twitter_uid").primaryKey(),
    twitterUsername: text("twitter_username").notNull().unique(),
    displayName: text("display_name"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    accountCreationDate: timestamp("account_creation_date", {
      withTimezone: true,
    }),
    followers: integer("followers").notNull().default(0),
    following: integer("following").notNull().default(0),
    bio: text("bio"),
    profileImgUrl: text("profile_img_url"),
    ...timestamps,
  },
  (t) => ({
    byFollowers: index("idx_kols_followers").on(t.followers),
  }),
);

export const kolsRelations = relations(kols, ({ many }) => ({
  tweets: many(kolTweets),
}));

/* ===================== kol_tweets ===================== */
export const kolTweets = pgTable(
  "kol_tweets",
  {
    tweetId: text("tweet_id").notNull(),
    twitterUid: text("twitter_uid")
      .notNull()
      .references(() => kols.twitterUid, { onUpdate: "cascade" }),
    twitterUsername: text("twitter_username").notNull(),

    type: tweetType("type").notNull().default("tweet"),
    textContent: text("text_content"),

    views: bigint("views", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    likes: integer("likes").notNull().default(0),
    retweets: integer("retweets").notNull().default(0),
    replies: integer("replies").notNull().default(0),

    publishDate: timestamp("publish_date", { withTimezone: true }).notNull(),
    statusLink: text("status_link"),

    // extras
    authorIsVerified: boolean("author_is_verified"),
    lang: text("lang"),

    replyToTweetId: text("reply_to_tweet_id"),
    quotedTweetId: text("quoted_tweet_id"),
    retweetedTweetId: text("retweeted_tweet_id"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    rawJson: jsonb("raw_json"),
    // --- Detect-mentions pipeline resolution flag ---
    resolved: boolean("resolved").notNull().default(false),
    // --- Manually exclude this tweet from detection & UI/analytics ---
    excluded: boolean("excluded").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    pkTweetId: primaryKey({
      name: "pk_kol_tweets_tweet_id",
      columns: [t.tweetId],
    }),
    byPublish: index("idx_kol_tweets_pub").on(t.publishDate),
    byUidPublish: index("idx_kol_tweets_uid_pub").on(
      t.twitterUid,
      t.publishDate,
    ),
    byExcluded: index("idx_kol_tweets_excluded").on(t.excluded, t.publishDate),
  }),
);

export const kolTweetsRelations = relations(kolTweets, ({ one, many }) => ({
  kol: one(kols, {
    fields: [kolTweets.twitterUid],
    references: [kols.twitterUid],
  }),
  mentions: many(tweetTokenMentions),
}));

/* ===================== tweet_token_mentions ===================== */
export const tweetTokenMentions = pgTable(
  "tweet_token_mentions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    tweetId: text("tweet_id")
      .notNull()
      .references(() => kolTweets.tweetId, { onDelete: "cascade" }),

    tokenKey: text("token_key").notNull(),
    tokenDisplay: text("token_display"),
    confidence: integer("confidence").notNull().default(100),
    source: mentionSource("source").notNull(),

    triggerKey: text("trigger_key"),
    triggerText: text("trigger_text"),
    priceUsdAt: numeric("price_usd_at", { precision: 18, scale: 8 }).$type<
      string | null
    >(),
    // Hide this mention from UI/analytics without deleting data.
    excluded: boolean("excluded").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    uniqTweetTrigger: uniqueIndex("uniq_tweet_trigger").on(
      t.tweetId,
      t.triggerKey,
    ),
    byToken: index("idx_mentions_token").on(t.tokenKey),
    byTrigger: index("idx_mentions_trigger").on(t.triggerKey),
    byTriggerText: index("idx_mentions_trigger_text").on(t.triggerText),
    byMentionExcluded: index("idx_mentions_excluded").on(
      t.excluded,
      t.createdAt,
    ),
  }),
);

export const tweetTokenMentionsRelations = relations(
  tweetTokenMentions,
  ({ one }) => ({
    tweet: one(kolTweets, {
      fields: [tweetTokenMentions.tweetId],
      references: [kolTweets.tweetId],
    }),
  }),
);

/* ===================== Inferred Types ===================== */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;

export type AIUnderstanding = typeof aiUnderstandings.$inferSelect;
export type NewAIUnderstanding = typeof aiUnderstandings.$inferInsert;

export type Kol = typeof kols.$inferSelect;
export type NewKol = typeof kols.$inferInsert;

export type KolTweet = typeof kolTweets.$inferSelect;
export type NewKolTweet = typeof kolTweets.$inferInsert;

export type TweetTokenMention = typeof tweetTokenMentions.$inferSelect;
export type NewTweetTokenMention = typeof tweetTokenMentions.$inferInsert;

export type CoinCaTicker = typeof coinCaTicker.$inferSelect;
export type NewCoinCaTicker = typeof coinCaTicker.$inferInsert;
