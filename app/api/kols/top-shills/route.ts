// app/api/kols/top-shills/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

// ensure dynamic (no caching)
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  handle: z.string().min(1).max(50),
  days: z.union([z.literal("7"), z.literal("30")]).default("7"),
});

function makeWindow(days: 7 | 30) {
  const until = new Date();
  const since = new Date(until.getTime() - days * 864e5);
  return { since, until };
}

/**
 * Returns:
 * {
 *   items: [ { tokenKey, tokenDisplay, contractAddress, maxRoi, marketCapUsd } ],
 *   activity: { tweets, shillCoins, shillViews, shillEngs }
 * }
 *
 * Notes:
 * - Only counts kt.type IN ('tweet','quote') to exclude retweets/replies.
 * - Excludes rows where mapping to a contract address failed when computing ROI/shill coins.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    handle: (searchParams.get("handle") || "").trim(),
    days: searchParams.get("days") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const handle = parsed.data.handle;
  const days = parsed.data.days === "30" ? 30 : 7;
  const { since, until } = makeWindow(days);

  // ---------- ITEMS: per-coin MAX ROI (no mcap for now) ----------
  const itemsSQL = sql`
    WITH base AS (
      SELECT
        -- optional CA if resolvable; not mandatory
        CASE WHEN tm.source='ca' THEN tm.token_key ELSE cct.contract_address END AS ca,
        COALESCE(NULLIF(tm.token_display,''), tm.token_key) AS token_display,
        (tm.price_usd_at)::numeric            AS price_at,
        (tm.max_price_since_mention)::numeric AS max_px
      FROM tweet_token_mentions tm
      JOIN kol_tweets kt ON kt.tweet_id = tm.tweet_id
      LEFT JOIN coin_ca_ticker cct
        ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
        OR LOWER(cct.token_ticker) = LOWER(REPLACE(COALESCE(tm.token_display,''),'$',''))
      WHERE kt.publish_date >= ${since}
        AND kt.publish_date <  ${until}
        AND LOWER(kt.twitter_username) = LOWER(${handle})
        AND tm.source IN ('ticker','phrase','ca')
        AND tm.excluded = false
        AND kt.excluded = false
        AND kt.type IN ('tweet','quote')
        AND tm.price_usd_at IS NOT NULL
        AND tm.max_price_since_mention IS NOT NULL
        AND tm.price_usd_at > 0
    )
    SELECT
      -- group id prefers CA; fallback to normalized display so we still get a coin row
      COALESCE(base.ca, LOWER(base.token_display)) AS gid,
      MIN(base.token_display) AS token_display,
      MAX( (base.max_px / base.price_at) - 1 )::float8 AS max_roi,
      MAX(base.ca)                                 AS ca
    FROM base
    GROUP BY gid
    ORDER BY MAX( (base.max_px / base.price_at) - 1 ) DESC NULLS LAST
    LIMIT 10;
  `;

  // ---------- ACTIVITY: tweets, shillCoins, shillViews, shillEngs ----------
  const activitySQL = sql`
    WITH base AS (
      SELECT
        CASE WHEN tm.source='ca' THEN tm.token_key ELSE cct.contract_address END AS ca,
        kt.views AS v,
        (kt.likes + kt.retweets + kt.replies) AS e
      FROM tweet_token_mentions tm
      JOIN kol_tweets kt ON kt.tweet_id = tm.tweet_id
      LEFT JOIN coin_ca_ticker cct
        ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
        OR LOWER(cct.token_ticker) = LOWER(REPLACE(COALESCE(tm.token_display,''),'$',''))
      WHERE kt.publish_date >= ${since}
        AND kt.publish_date <  ${until}
        AND LOWER(kt.twitter_username) = LOWER(${handle})
        AND tm.source IN ('ticker','phrase','ca')
        AND tm.excluded = false
        AND kt.excluded = false
        AND kt.type = ANY (ARRAY['tweet','quote']::tweet_type[])
    )
    SELECT
      COUNT(*)::bigint                                     AS tweets,       -- treat as tweets≈shills
      COUNT(DISTINCT ca)::bigint                           AS shill_coins,  -- only coins that mapped to a CA
      COALESCE(SUM(v), 0)::bigint                          AS shill_views,
      COALESCE(SUM(e), 0)::bigint                          AS shill_engs
    FROM base;
  `;

  try {
    const [itemsRes, actRes] = await Promise.all([
      db.execute(itemsSQL),
      db.execute(activitySQL),
    ]);

    const rows = (itemsRes as any).rows as Array<{
      ca: string | null;
      token_display: string | null;
      max_roi: number | null;
    }>;
    const actRow = (actRes as any).rows?.[0] as
      | {
          tweets: number | null;
          shill_coins: number | null;
          shill_views: number | null;
          shill_engs: number | null;
        }
      | undefined;
    const toNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const items = rows.map((r) => ({
      tokenKey: (r.token_display || "").replace(/^\$+/, "") || "UNKNOWN",
      tokenDisplay: r.token_display,
      contractAddress: r.ca,
      maxRoi: toNum(r.max_roi),
      marketCapUsd: null, // temporarily disabled
    }));

    const activity = {
      tweets: Number(actRow?.tweets ?? 0),
      shillCoins: Number(actRow?.shill_coins ?? 0),
      shillViews: Number(actRow?.shill_views ?? 0),
      shillEngs: Number(actRow?.shill_engs ?? 0),
    };

    return NextResponse.json({ items, activity });
  } catch (err) {
    console.error("[/api/kols/top-shills] query failed:", err);
    return NextResponse.json({
      items: [],
      activity: { tweets: 0, shillCoins: 0, shillViews: 0, shillEngs: 0 },
    });
  }
}
