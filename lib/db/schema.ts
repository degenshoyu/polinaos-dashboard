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
  boolean,
  bigint,
  pgEnum,
  uniqueIndex,
  primaryKey, // ✅ 新增：用于命名主键
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

/* ===================== KOL Leaderboard — enums ===================== */
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

    // helpful extras for ranking / filters
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
    tokenKey: text("token_key").notNull(), // canonical key (contract or normalized ticker, e.g. "usduc")
    tokenDisplay: text("token_display"), // for UI ($USDUC or short addr)
    confidence: integer("confidence").notNull().default(100), // 0..100
    source: mentionSource("source").notNull(), // ca|ticker|phrase|hashtag|upper|llm
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqTweetToken: uniqueIndex("uniq_tweet_token").on(t.tweetId, t.tokenKey),
    byToken: index("idx_mentions_token").on(t.tokenKey),
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

/* ===================== Inferred Types (new) ===================== */
export type Kol = typeof kols.$inferSelect;
export type NewKol = typeof kols.$inferInsert;

export type KolTweet = typeof kolTweets.$inferSelect;
export type NewKolTweet = typeof kolTweets.$inferInsert;

export type TweetTokenMention = typeof tweetTokenMentions.$inferSelect;
export type NewTweetTokenMention = typeof tweetTokenMentions.$inferInsert;
