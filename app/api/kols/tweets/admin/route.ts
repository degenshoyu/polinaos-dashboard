// app/api/kols/tweets/admin/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client"; // ← 若你的 db 客户端路径不同，改这里
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema"; // ← 若表名/路径不同，改这里
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Params ----
const Q = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  sort: z
    .enum([
      "username",
      "tweet_id",
      "views",
      "likes",
      "retweets",
      "replies",
      "engagements",
      "publish_date_time",
      "last_seen_at",
      "coins",
    ])
    .default("publish_date_time"),
  order: z.enum(["asc", "desc"]).default("desc"),
  // NEW: full-dataset source filter
  // "any" = All coins (exists any mention)
  // "ca" | "ticker" | "phrase" = filter by mention source
  source: z.enum(["any", "ca", "ticker", "phrase"]).optional(),

  // Back-compat: keep old flag. If true, it's equivalent to source=any
  onlyCoin: z
    .union([
      z.literal("1"),
      z.literal("true"),
      z.literal("0"),
      z.literal("false"),
    ])
    .optional(),

  handle: z.string().optional(), // optional twitter handle filter (username without @)
});

type CoinPair = {
  ticker?: string | null;
  ca?: string | null;
  source?: string | null; // 'ca' | 'ticker' | 'phrase' | 'hashtag' | 'upper' | 'llm'
  triggerText?: string | null; // raw trigger text
  tokenKey?: string | null;
  tokenDisplay?: string | null;
  confidence?: number | null;
};

const looksLikeCA = (s?: string | null) =>
  !!s && typeof s === "string" && s.length >= 32 && s.length <= 64;

export async function GET(req: NextRequest) {
  try {
    // ---- parse ----
    const url = new URL(req.url);
    const parsed = Q.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: parsed.error.message },
        { status: 400 },
      );
    }

    const { page, pageSize, sort, order } = parsed.data;

    // Back-compat: onlyCoin → treat as source=any
    const onlyCoin =
      parsed.data.onlyCoin === "1" || parsed.data.onlyCoin === "true"
        ? true
        : false;

    const sourceParam =
      (parsed.data.source as "any" | "ca" | "ticker" | "phrase" | undefined) ??
      (onlyCoin ? "any" : undefined);

    const now = new Date();
    const to = parsed.data.to ? new Date(parsed.data.to) : now;
    const from = parsed.data.from
      ? new Date(parsed.data.from)
      : new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const handle = parsed.data.handle?.trim()?.replace(/^@/, "");

    // ---- WHERE (full-dataset) ----
    const whereClauses: any[] = [
      gte(kolTweets.publishDate, from),
      lte(kolTweets.publishDate, to),
    ];
    if (handle) whereClauses.push(eq(kolTweets.twitterUsername, handle));

    // Source-aware filtering (applies BEFORE pagination/count)
    if (sourceParam === "any") {
      // All coins → exists any mention
      whereClauses.push(
        sql`EXISTS (SELECT 1 FROM ${tweetTokenMentions} ttm WHERE ttm.tweet_id = ${kolTweets.tweetId})`,
      );
    } else if (
      sourceParam === "ca" ||
      sourceParam === "ticker" ||
      sourceParam === "phrase"
    ) {
      // Specific source
      whereClauses.push(
        sql`EXISTS (
          SELECT 1
          FROM ${tweetTokenMentions} ttm
          WHERE ttm.tweet_id = ${kolTweets.tweetId}
            AND ttm.source = ${sourceParam}
        )`,
      );
    }
    const whereFinal = and(...whereClauses);

    // ---- total ----
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(kolTweets)
      .where(whereFinal);
    const total = Number(count || 0);
    if (total === 0) {
      return Response.json({ ok: true, items: [], total: 0, page, pageSize });
    }

    // ---- sorting ----
    const engagementsExpr = sql<number>`
      (COALESCE(${kolTweets.likes},0)
     + COALESCE(${kolTweets.retweets},0)
     + COALESCE(${kolTweets.replies},0))
    `;

    let orderExpr: any;
    switch (sort) {
      case "username":
        orderExpr = kolTweets.twitterUsername;
        break;
      case "tweet_id":
        orderExpr = kolTweets.tweetId;
        break;
      case "views":
        orderExpr = kolTweets.views;
        break;
      case "likes":
        orderExpr = kolTweets.likes;
        break;
      case "retweets":
        orderExpr = kolTweets.retweets;
        break;
      case "replies":
        orderExpr = kolTweets.replies;
        break;
      case "engagements":
        orderExpr = engagementsExpr;
        break;
      case "publish_date_time":
        orderExpr = kolTweets.publishDate;
        break;
      case "last_seen_at":
        orderExpr = kolTweets.lastSeenAt;
        break;
      case "coins":
        // Source-aware proxy sort:
        // - if source=ca|ticker|phrase → order by existence of that source
        // - else (including any/undefined) → order by existence of any mention
        if (
          sourceParam === "ca" ||
          sourceParam === "ticker" ||
          sourceParam === "phrase"
        ) {
          orderExpr = sql<number>`
            (CASE WHEN EXISTS (
              SELECT 1 FROM ${tweetTokenMentions} ttm
              WHERE ttm.tweet_id = ${kolTweets.tweetId}
                AND ttm.source = ${sourceParam}
            ) THEN 1 ELSE 0 END)
          `;
        } else {
          orderExpr = sql<number>`
            (CASE WHEN EXISTS (
              SELECT 1 FROM ${tweetTokenMentions} ttm
              WHERE ttm.tweet_id = ${kolTweets.tweetId}
            ) THEN 1 ELSE 0 END)
          `;
        }
        break;
      default:
        orderExpr = kolTweets.publishDate;
    }
    const direction = order === "asc" ? sql`ASC` : sql`DESC`;

    // ---- page rows ----
    const rows = await db
      .select({
        twitter_username: kolTweets.twitterUsername,
        tweet_id: kolTweets.tweetId,
        views: kolTweets.views, // bigint
        likes: kolTweets.likes,
        retweets: kolTweets.retweets,
        replies: kolTweets.replies,
        engagements: engagementsExpr.as("engagements"),
        publish_date_time: kolTweets.publishDate,
        last_seen_at: kolTweets.lastSeenAt,
      })
      .from(kolTweets)
      .where(whereFinal)
      .orderBy(sql`${orderExpr} ${direction}`, desc(kolTweets.publishDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    if (rows.length === 0) {
      return Response.json({ ok: true, items: [], total, page, pageSize });
    }

    // ---- mentions for tweets on this page ----
    const tweetIds = rows.map((r) => r.tweet_id);

    const mentionRows = await db
      .select({
        tweet_id: tweetTokenMentions.tweetId,
        token_key: tweetTokenMentions.tokenKey,
        token_display: tweetTokenMentions.tokenDisplay,
        source: tweetTokenMentions.source,
        trigger_text: tweetTokenMentions.triggerText,
        confidence: tweetTokenMentions.confidence,
      })
      .from(tweetTokenMentions)
      .where(inArray(tweetTokenMentions.tweetId, tweetIds));

    const coinsByTweet = new Map<string, CoinPair[]>();

    for (const m of mentionRows) {
      const arr = coinsByTweet.get(m.tweet_id) ?? [];
      const tokenKey = m.token_key ?? null;
      const display = m.token_display ?? null;

      const base: CoinPair = {
        source: m.source ?? null,
        triggerText: m.trigger_text ?? null,
        tokenKey,
        tokenDisplay: display,
        confidence:
          typeof m.confidence === "number"
            ? m.confidence
            : ((m.confidence as any) ?? null),
      };

      if (m.source === "ca") {
        // identified by contract address
        arr.push({ ...base, ca: tokenKey, ticker: display ?? null });
      } else if (m.source === "ticker") {
        // identified by ticker; may also carry a CA in tokenKey if it looks like one
        arr.push({
          ...base,
          ticker: display ?? tokenKey,
          ca: looksLikeCA(tokenKey) ? tokenKey : null,
        });
      } else {
        // phrase / hashtag / upper / llm ...
        if (looksLikeCA(tokenKey)) {
          arr.push({ ...base, ca: tokenKey, ticker: display ?? null });
        } else {
          arr.push({ ...base, ticker: display ?? tokenKey ?? null, ca: null });
        }
      }
      coinsByTweet.set(m.tweet_id, arr);
    }

    // ---- assemble items (dedupe per row) ----
    const items = rows.map((r) => {
      const list = coinsByTweet.get(r.tweet_id) ?? [];
      const seen = new Set<string>();
      const coins: CoinPair[] = [];
      for (const c of list) {
        const key = `${(c.ticker ?? "").toLowerCase()}|${c.ca ?? ""}|${(c.source ?? "").toLowerCase()}|${c.triggerText ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        coins.push(c);
      }

      return {
        twitter_username: r.twitter_username,
        tweet_id: r.tweet_id,
        views: r.views != null ? Number(r.views) : 0,
        likes: r.likes ?? 0,
        retweets: r.retweets ?? 0,
        replies: r.replies ?? 0,
        engagements:
          typeof (r as any).engagements === "number"
            ? (r as any).engagements
            : Number((r as any).engagements ?? 0),
        publish_date_time:
          r.publish_date_time instanceof Date
            ? r.publish_date_time.toISOString()
            : String(r.publish_date_time),
        last_seen_at:
          r.last_seen_at instanceof Date
            ? r.last_seen_at.toISOString()
            : String(r.last_seen_at),
        coins,
      };
    });

    return Response.json({ ok: true, items, total, page, pageSize });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "server error" },
      { status: 500 },
    );
  }
}
