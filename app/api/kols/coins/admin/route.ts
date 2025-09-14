// app/api/kols/coins/admin/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Threshold kept for legacy "topKolsOnly", but you will now prefer explicit KOL list.
const TOP_MIN = Number(process.env.TOP_KOLS_MIN_FOLLOWERS ?? "100000");
// How many KOLs to show in "Top KOLs" per coin
const TOP_KOLS_PER_COIN = Number(process.env.TOP_KOLS_PER_COIN ?? "5");

// Accept NEW + OLD query names for backward compatibility
const Query = z.object({
  // time range (inclusive from, exclusive to)
  from: z.string().optional(),
  to: z.string().optional(),

  // paging (legacy: pageSize + order)
  page: z.coerce.number().int().min(1).optional().default(1),
  size: z.coerce.number().int().min(1).max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(), // old

  // sort (legacy "order" vs new "asc")
  sort: z
    .enum([
      "ticker",
      "ca",
      "tweets",
      "views",
      "engs",
      "er",
      "kols",
      "followers",
    ])
    .optional()
    .default("tweets"),
  asc: z.coerce.boolean().optional(),
  order: z.enum(["asc", "desc"]).optional(), // old

  // filters
  q: z.string().optional(),
  // NEW: comma-separated twitter_username list, case-insensitive
  kols: z.string().optional(),
  // kept only for back-compat; ignored when `kols` is provided
  topKolsOnly: z.coerce.boolean().optional().default(false),
  coins: z.enum(["all", "no-price"]).optional(),
});

// Map UI sort keys -> SQL column names (safe list)
function sortExpr(key: string): string {
  switch (key) {
    case "ticker":
      return "ticker";
    case "ca":
      return "ca";
    case "tweets":
      return "total_tweets";
    case "views":
      return "total_views";
    case "engs":
      return "total_engs";
    case "er":
      return "er";
    case "kols":
      return "total_kols";
    case "followers":
      return "total_followers";
    default:
      return "total_tweets";
  }
}

// Old behavior: default to full window [Epoch, Now)
function legacyFullRange() {
  return { from: new Date(0).toISOString(), to: new Date().toISOString() };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = Query.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      size: url.searchParams.get("size") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      asc: url.searchParams.get("asc") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      kols: url.searchParams.get("kols") ?? undefined,
      topKolsOnly: url.searchParams.get("topKolsOnly") ?? undefined,
      coins: url.searchParams.get("coins") ?? undefined,
    });

    // ---------- Back-compat normalization ----------
    const range =
      parsed.from && parsed.to
        ? { from: parsed.from, to: parsed.to }
        : legacyFullRange(); // old default: full range

    const page = parsed.page ?? 1;
    const size = parsed.size ?? parsed.pageSize ?? 50; // honor old `pageSize`
    const offset = (page - 1) * size;

    // asc/desc normalization
    const asc =
      typeof parsed.asc === "boolean"
        ? parsed.asc
        : parsed.order
          ? parsed.order === "asc"
          : false;
    const orderDir = asc ? "ASC" : "DESC";
    const sortCol = sortExpr(parsed.sort!);
    const onlyNoPrice = parsed.coins === "no-price";

    // ---------- WHERE filters (parameterized) ----------
    const filters: any[] = [];
    // time window
    filters.push(
      sql`t.publish_date >= ${range.from} AND t.publish_date < ${range.to}`,
    );
    // manual exclusions
    filters.push(sql`t.excluded = false`);
    filters.push(sql`m.excluded = false`);

    // NEW: explicit KOL usernames (comma-separated)
    const kolNames = (parsed.kols ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^@+/, "").toLowerCase())
      .filter(Boolean);

    if (kolNames.length) {
      // Filter by kol_tweets.twitter_username (case-insensitive)
      filters.push(
        sql`LOWER(t.twitter_username) IN (${sql.join(
          kolNames.map((n) => sql`${n}`),
          sql`, `,
        )})`,
      );
    } else if (parsed.topKolsOnly) {
      // Legacy: only when kols is not provided
      filters.push(sql`COALESCE(k.followers, 0) >= ${TOP_MIN}`);
    }

    // search over ticker / ca / token_name
    if (parsed.q && parsed.q.trim()) {
      const q = parsed.q.trim();
      const likeUpper = `%${q.replace(/^\$/, "").toUpperCase()}%`;
      filters.push(
        sql`(
          UPPER(COALESCE(c.token_ticker, '')) LIKE ${likeUpper}
          OR UPPER(COALESCE(m.token_key, '')) LIKE ${likeUpper}
          OR UPPER(COALESCE(c.token_name, '')) LIKE ${likeUpper}
        )`,
      );
    }

    const whereSql = filters.length ? sql.join(filters, sql` AND `) : sql`true`;

    // ---------- CTEs ----------
    const baseCte = sql`
      WITH base AS (
        SELECT
          m.token_key AS ca,
          c.token_ticker AS ticker,
          c.token_name AS token_name,
          c.update_authority AS update_authority,
          m.source,
          (m.price_usd_at IS NULL) AS no_price,
          t.tweet_id,
          t.views::numeric AS views,
          (t.likes + t.retweets + t.replies)::numeric AS engs,
          t.twitter_uid,
          t.twitter_username,
          k.display_name AS display_name,
          COALESCE(k.followers, 0) AS followers
        FROM tweet_token_mentions m
        JOIN kol_tweets t ON t.tweet_id = m.tweet_id
        LEFT JOIN kols k ON k.twitter_uid = t.twitter_uid
        LEFT JOIN coin_ca_ticker c ON c.contract_address = m.token_key
        WHERE ${whereSql}
      ),
      agg AS (
        SELECT
          ca,
          MAX(ticker) AS ticker,
          MAX(token_name) AS token_name,
          MAX(update_authority) AS update_authority,
          COUNT(*)::bigint AS total_tweets,
          SUM(CASE WHEN no_price THEN 1 ELSE 0 END)::bigint AS no_price_tweets,
          SUM(views)::numeric AS total_views,
          SUM(engs)::numeric AS total_engs,
          SUM(CASE WHEN source = 'ca' THEN 1 ELSE 0 END)::bigint AS src_ca,
          SUM(CASE WHEN source = 'ticker' THEN 1 ELSE 0 END)::bigint AS src_ticker,
          SUM(CASE WHEN source = 'phrase' THEN 1 ELSE 0 END)::bigint AS src_phrase,
          COUNT(DISTINCT twitter_uid)::bigint AS total_kols
        FROM base
        GROUP BY ca
      ),
      fol AS (
        -- Sum followers per unique KOL per token (avoid double-counting)
        SELECT ca, SUM(followers)::bigint AS total_followers
        FROM (
          SELECT DISTINCT ca, twitter_uid, followers FROM base
        ) d
        GROUP BY ca
      ),
      per_kol AS (
        -- Aggregate per (coin, KOL)
        SELECT
          ca,
          twitter_uid,
          twitter_username,
          MAX(display_name) AS display_name,
          MAX(followers) AS followers,
          COUNT(*) AS mentions
        FROM base
        GROUP BY ca, twitter_uid, twitter_username
      ),
      ranked AS (
        SELECT
          ca, twitter_uid, twitter_username, display_name, followers, mentions,
          ROW_NUMBER() OVER (PARTITION BY ca ORDER BY followers DESC, mentions DESC, twitter_username ASC) AS rn
        FROM per_kol
      ),
      topk AS (
        SELECT
          ca,
          jsonb_agg(
            jsonb_build_object(
              'username', twitter_username,
              'displayName', display_name,
              'followers', followers,
              'mentions', mentions
            )
            ORDER BY followers DESC, mentions DESC, twitter_username ASC
          ) AS top_kols
        FROM ranked
        WHERE rn <= ${TOP_KOLS_PER_COIN}
        GROUP BY ca
      )
    `;

    const countSql = sql`
      ${baseCte}
      SELECT COUNT(*)::bigint AS total
      FROM agg
      ${onlyNoPrice ? sql`WHERE no_price_tweets > 0` : sql``}
    `;
    const countRes = await db.execute(countSql);
    const total = Number((countRes.rows?.[0] as any)?.total ?? 0);

    const rowsSql = sql`
      ${baseCte}
      SELECT
        a.ca,
        a.ticker,
        a.token_name,
        a.update_authority,
        a.total_tweets,
        a.no_price_tweets,
        a.total_views,
        a.total_engs,
        CASE WHEN a.total_views > 0 THEN (a.total_engs / a.total_views) ELSE 0 END AS er,
        a.total_kols,
        COALESCE(f.total_followers, 0) AS total_followers,
        jsonb_build_object(
          'ca', a.src_ca,
          'ticker', a.src_ticker,
          'phrase', a.src_phrase
        ) AS sources,
        tk.top_kols
      FROM agg a
      LEFT JOIN fol f ON f.ca = a.ca
      LEFT JOIN topk tk ON tk.ca = a.ca
      ${onlyNoPrice ? sql`WHERE a.no_price_tweets > 0` : sql``}
      ORDER BY ${sql.raw(sortExpr(parsed.sort!))} ${sql.raw(orderDir)} NULLS LAST
      LIMIT ${size} OFFSET ${offset}
    `;
    const res = await db.execute(rowsSql);

    const rows = (res.rows ?? []).map((r: any) => {
      const topKols = Array.isArray(r.top_kols) ? r.top_kols : [];
      // Build a short label like: "@alice, @bob, @carol +2"
      const label =
        topKols.length === 0
          ? ""
          : topKols
              .slice(0, 3)
              .map((k: any) => `@${k.username}`)
              .join(", ") +
            (topKols.length > 3 ? ` +${topKols.length - 3}` : "");

      return {
        ca: r.ca,
        ticker: r.ticker,
        tokenName: r.token_name,
        updateAuthority: r.update_authority,
        totalTweets: Number(r.total_tweets ?? 0),
        noPriceTweets: Number(r.no_price_tweets ?? 0),
        totalViews: Number(r.total_views ?? 0),
        totalEngagements: Number(r.total_engs ?? 0),
        er: Number(r.er ?? 0),
        totalKols: Number(r.total_kols ?? 0),
        totalFollowers: Number(r.total_followers ?? 0),
        sources: r.sources ?? { ca: 0, ticker: 0, phrase: 0 },
        topKols, // array of { username, displayName, followers, mentions }
        topKolsLabel: label, // short text label (for legacy UI)
      };
    });

    return NextResponse.json({
      ok: true,
      total,
      page,
      size,
      rows,
      items: rows, // legacy alias for old UI
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 400 },
    );
  }
}
