/* Project Leaderboard API
 * - Universe-first: coin_ca_ticker -> preferred CA per ticker (keep original CA casing).
 * - Metrics: tweet_token_mentions (token_key = contract_address) + kol_tweets (views/likes/retweets/replies/username).
 * - Join by CA (exact, case-sensitive). Ticker only used for display and optional query.
 * - Attention score: views/vpt/shillers heavy; robust minmax (constant>0 -> all ones; all zeros -> all zeros).
 * - No price/mcap enrichment here; frontend enriches.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@vercel/postgres";

/** ---------------- Query shape ---------------- */
const Query = z.object({
  preset: z.enum(["7d", "30d"]).default("7d"),
  q: z.string().optional().default(""),
  sort: z
    .enum(["attention", "views", "shillers", "mentions"])
    .default("attention"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(10),
  onlyActive: z.coerce.number().int().min(0).max(1).optional().default(0), // 1 => require any metric > 0
  debug: z.coerce.boolean().optional().default(false),
});
type QueryShape = z.infer<typeof Query>;

/** ---------------- Types ---------------- */
type ProjectType = "unknown";

type ItemOut = {
  rank: number;
  ticker: string;
  ca: string;
  image: string | null;
  price_usd: number | null;
  mcap_usd: number | null;
  price_change_1h_pct: number | null;
  price_change_24h_pct: number | null;
  social_score: number | null;
  type: ProjectType;
  attention_score: number;
  top_shillers: Array<{
    handle: string;
    views: number;
    avatar: string | null;
    followers: number | null;
  }>;
  // debug metrics (helpful in curl + jq)
  mentions: number;
  shillers: number;
  views: number;
  engs: number;
};

/** ---------------- Utils ---------------- */
const sanitize = (s: any) =>
  typeof s === "string" ? s.replace(/[\uD800-\uDFFF]/g, "") : s;
function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return sanitize(value) as unknown as T;
  if (Array.isArray(value))
    return value.map((v) => deepSanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = deepSanitize(v);
    return out as T;
  }
  return value;
}
const toTicker = (s: string) =>
  (s || "").replace(/^\$+/, "").trim().toUpperCase();
const shortHandle = (h: string) => (h?.startsWith("@") ? h.slice(1) : h || "");
const safeNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Attention with robust minmax */
function computeAttention(
  rows: Array<{
    token_key_norm: string; // from universe
    token_ticker: string;
    contract_address: string;
    mentions: number;
    shillers: number;
    views: number;
    engs: number;
  }>,
) {
  if (!rows.length)
    return { sorted: [] as typeof rows, scoreOf: {} as Record<string, number> };

  const xs = rows.map((r) => {
    const mentions = safeNum(r.mentions);
    const views = safeNum(r.views);
    const shillers = safeNum(r.shillers);
    const engs = safeNum(r.engs);
    const vpt = mentions > 0 ? views / mentions : 0;
    const er = views > 0 ? engs / views : 0;
    const velocity = 0;
    return { r, mentions, views, shillers, engs, vpt, er, velocity };
  });

  const log1p = (v: number) => Math.log1p(Math.max(0, v));
  const minmax = (arr: number[]) => {
    if (!arr.length) return arr;
    const min = Math.min(...arr),
      max = Math.max(...arr);
    if (!isFinite(min) || !isFinite(max)) return arr.map(() => 0);
    if (max === min) return min === 0 ? arr.map(() => 0) : arr.map(() => 1);
    const d = max - min;
    return arr.map((v) => (v - min) / d);
  };

  const n_views = minmax(xs.map((x) => log1p(x.views)));
  const n_vpt = minmax(xs.map((x) => log1p(x.vpt)));
  const n_shillers = minmax(xs.map((x) => log1p(x.shillers)));
  const n_mentions = minmax(xs.map((x) => log1p(x.mentions)));
  const n_engs = minmax(xs.map((x) => log1p(x.engs)));
  const n_er = minmax(xs.map((x) => Math.max(0, Math.min(1, x.er))));
  const n_velocity = minmax(xs.map((x) => log1p(x.velocity)));

  const W = {
    views: 0.35,
    vpt: 0.35,
    shillers: 0.2,
    mentions: 0.025,
    engs: 0.025,
    er: 0.025,
    velocity: 0.025,
  };

  const ranked = xs
    .map((x, i) => ({
      row: x.r,
      score:
        W.views * n_views[i] +
        W.vpt * n_vpt[i] +
        W.shillers * n_shillers[i] +
        W.mentions * n_mentions[i] +
        W.engs * n_engs[i] +
        W.er * n_er[i] +
        W.velocity * n_velocity[i],
      id: `${x.r.token_key_norm}::${x.r.contract_address}`,
    }))
    .sort((a, b) => b.score - a.score);

  const sorted = ranked.map((k) => k.row);
  const scoreOf = Object.fromEntries(ranked.map((k) => [k.id, k.score]));
  return { sorted, scoreOf };
}

/** ---------------- DB aggregation (universe-first; JOIN by CA) ---------------- */
async function fetchBaseRows(days: 7 | 30, q: string, onlyActive: 0 | 1) {
  const now = new Date();
  const toISO = now.toISOString();
  const fromISO = new Date(now.getTime() - days * 86400000).toISOString();

  const qTrim = q.trim();
  const isTickerQ = qTrim
    ? qTrim.startsWith("$") || /^[a-zA-Z]{2,16}$/.test(qTrim)
    : false;
  const qTicker = toTicker(qTrim.replace(/^\$+/, ""));
  const qLike = `%${qTrim}%`;

  type BaseRow = {
    token_key_norm: string;
    token_ticker: string;
    contract_address: string;
    mentions: string;
    shillers: string;
    views: string;
    engs: string;
  };

  let baseRes: { rows: BaseRow[] };
  if (!qTrim) {
    baseRes = await sql<BaseRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
-- metrics keyed by contract_address (from tweet_token_mentions.token_key)
metrics AS (
  SELECT
    NULLIF(TRIM(ttm.token_key), '') AS contract_address,
    COUNT(*)::bigint AS mentions,
    COUNT(DISTINCT kt.twitter_uid)::int AS shillers,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    SUM(COALESCE(kt.likes,0) + COALESCE(kt.retweets,0) + COALESCE(kt.replies,0))::bigint AS engs
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
  GROUP BY 1
),
base AS (
  SELECT
    u.norm_ticker       AS token_key_norm,
    u.token_ticker      AS token_ticker,
    u.contract_address  AS contract_address,
    COALESCE(m.mentions,0) AS mentions,
    COALESCE(m.shillers,0) AS shillers,
    COALESCE(m.views,0)    AS views,
    COALESCE(m.engs,0)     AS engs
  FROM universe u
  LEFT JOIN metrics m
    ON m.contract_address = u.contract_address    -- JOIN by CA (exact, case-sensitive)
  WHERE (${onlyActive} = 0 OR (COALESCE(m.mentions,0)+COALESCE(m.shillers,0)+COALESCE(m.views,0)+COALESCE(m.engs,0)) > 0)
)
SELECT * FROM base
`;
  } else if (isTickerQ) {
    baseRes = await sql<BaseRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
metrics AS (
  SELECT
    NULLIF(TRIM(ttm.token_key), '') AS contract_address,
    COUNT(*)::bigint AS mentions,
    COUNT(DISTINCT kt.twitter_uid)::int AS shillers,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    SUM(COALESCE(kt.likes,0) + COALESCE(kt.retweets,0) + COALESCE(kt.replies,0))::bigint AS engs
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
  GROUP BY 1
),
base AS (
  SELECT
    u.norm_ticker       AS token_key_norm,
    u.token_ticker      AS token_ticker,
    u.contract_address  AS contract_address,
    COALESCE(m.mentions,0) AS mentions,
    COALESCE(m.shillers,0) AS shillers,
    COALESCE(m.views,0)    AS views,
    COALESCE(m.engs,0)     AS engs
  FROM universe u
  LEFT JOIN metrics m
    ON m.contract_address = u.contract_address
  WHERE u.norm_ticker = ${qTicker}
    AND (${onlyActive} = 0 OR (COALESCE(m.mentions,0)+COALESCE(m.shillers,0)+COALESCE(m.views,0)+COALESCE(m.engs,0)) > 0)
)
SELECT * FROM base
`;
  } else {
    // CA substring search (case-sensitive LIKE)
    baseRes = await sql<BaseRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
metrics AS (
  SELECT
    NULLIF(TRIM(ttm.token_key), '') AS contract_address,
    COUNT(*)::bigint AS mentions,
    COUNT(DISTINCT kt.twitter_uid)::int AS shillers,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    SUM(COALESCE(kt.likes,0) + COALESCE(kt.retweets,0) + COALESCE(kt.replies,0))::bigint AS engs
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
  GROUP BY 1
),
base AS (
  SELECT
    u.norm_ticker       AS token_key_norm,
    u.token_ticker      AS token_ticker,
    u.contract_address  AS contract_address,
    COALESCE(m.mentions,0) AS mentions,
    COALESCE(m.shillers,0) AS shillers,
    COALESCE(m.views,0)    AS views,
    COALESCE(m.engs,0)     AS engs
  FROM universe u
  LEFT JOIN metrics m
    ON m.contract_address = u.contract_address
  WHERE u.contract_address LIKE ${qLike}
    AND (${onlyActive} = 0 OR (COALESCE(m.mentions,0)+COALESCE(m.shillers,0)+COALESCE(m.views,0)+COALESCE(m.engs,0)) > 0)
)
SELECT * FROM base
`;
  }

  /** Top shillers (by CA) */
  type ShRow = {
    token_key_norm: string;
    contract_address: string;
    handle: string;
    views: string;
    followers: number | null;
    avatar: string | null;
  };

  let shRes: { rows: ShRow[] };
  if (!qTrim) {
    shRes = await sql<ShRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
per_kol AS (
  SELECT
    u.norm_ticker                 AS token_key_norm,
    u.contract_address            AS contract_address,
    LOWER(kt.twitter_username)    AS handle,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    MAX(k.followers)              AS followers,
    MAX(k.profile_img_url)        AS avatar
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  LEFT JOIN kols k ON k.twitter_uid = kt.twitter_uid
  JOIN universe u
    ON u.contract_address = NULLIF(TRIM(ttm.token_key), '')   -- JOIN by CA
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
  GROUP BY 1,2,3
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY token_key_norm, contract_address ORDER BY views DESC) AS rn
  FROM per_kol
)
SELECT token_key_norm, contract_address, handle, views, followers, avatar
FROM ranked
WHERE rn <= 3
`;
  } else if (isTickerQ) {
    shRes = await sql<ShRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
per_kol AS (
  SELECT
    u.norm_ticker                 AS token_key_norm,
    u.contract_address            AS contract_address,
    LOWER(kt.twitter_username)    AS handle,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    MAX(k.followers)              AS followers,
    MAX(k.profile_img_url)        AS avatar
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  LEFT JOIN kols k ON k.twitter_uid = kt.twitter_uid
  JOIN universe u
    ON u.contract_address = NULLIF(TRIM(ttm.token_key), '')   -- JOIN by CA
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
    AND u.norm_ticker = ${qTicker}
  GROUP BY 1,2,3
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY token_key_norm, contract_address ORDER BY views DESC) AS rn
  FROM per_kol
)
SELECT token_key_norm, contract_address, handle, views, followers, avatar
FROM ranked
WHERE rn <= 3
`;
  } else {
    shRes = await sql<ShRow>`
WITH universe AS (
  SELECT DISTINCT ON (norm_ticker)
         norm_ticker,
         token_ticker,
         contract_address
  FROM (
    SELECT
      UPPER(LTRIM(TRIM(token_ticker), '$')) AS norm_ticker,
      TRIM(token_ticker) AS token_ticker,
      NULLIF(TRIM(contract_address), '')   AS contract_address,
      priority,
      updated_at
    FROM coin_ca_ticker
  ) t
  WHERE contract_address IS NOT NULL
  ORDER BY norm_ticker, priority DESC NULLS LAST, updated_at DESC
),
per_kol AS (
  SELECT
    u.norm_ticker                 AS token_key_norm,
    u.contract_address            AS contract_address,
    LOWER(kt.twitter_username)    AS handle,
    SUM(COALESCE(kt.views,0))::bigint AS views,
    MAX(k.followers)              AS followers,
    MAX(k.profile_img_url)        AS avatar
  FROM tweet_token_mentions ttm
  JOIN kol_tweets kt ON kt.tweet_id = ttm.tweet_id
  LEFT JOIN kols k ON k.twitter_uid = kt.twitter_uid
  JOIN universe u
    ON u.contract_address = NULLIF(TRIM(ttm.token_key), '')   -- JOIN by CA
  WHERE COALESCE(kt.excluded, false) = false
    AND COALESCE(ttm.excluded, false) = false
    AND kt.publish_date >= ${fromISO}
    AND kt.publish_date <  ${toISO}
    AND u.contract_address LIKE ${qLike}
  GROUP BY 1,2,3
),
ranked AS (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY token_key_norm, contract_address ORDER BY views DESC) AS rn
  FROM per_kol
)
SELECT token_key_norm, contract_address, handle, views, followers, avatar
FROM ranked
WHERE rn <= 3
`;
  }

  // Map rows to JS
  const baseRows = baseRes.rows.map((r) => ({
    token_key_norm: r.token_key_norm,
    token_ticker: r.token_ticker,
    contract_address: r.contract_address,
    mentions: Number(r.mentions),
    shillers: Number(r.shillers),
    views: Number(r.views),
    engs: Number(r.engs),
  }));

  const shillers = shRes.rows.map((r) => ({
    token_key_norm: r.token_key_norm,
    contract_address: r.contract_address,
    handle: r.handle,
    views: Number(r.views),
    followers: typeof r.followers === "number" ? r.followers : null,
    avatar: r.avatar ?? null,
  }));

  return { baseRows, shillers, window: { fromISO, toISO } };
}

/** ---------------- Handler ---------------- */
export async function GET(req: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );

  const { preset, q, sort, order, page, pageSize, onlyActive, debug } =
    parsed.data as QueryShape;
  const days: 7 | 30 = preset === "30d" ? 30 : 7;

  const trace: any[] = [];
  const envInfo = {
    origin: req.nextUrl.origin,
    preset,
    q,
    sort,
    order,
    page,
    pageSize,
    onlyActive,
  };

  const { baseRows, shillers, window } = await fetchBaseRows(
    days,
    q ?? "",
    (onlyActive ?? 0) as 0 | 1,
  );

  if (!baseRows.length) {
    const body: any = { page, pageSize, total: 0, items: [] as ItemOut[] };
    if (debug) body.__debug = { env: envInfo, trace, window };
    return NextResponse.json(deepSanitize(body));
  }

  // Attention + shillers map
  const { sorted, scoreOf } = computeAttention(baseRows);
  const key = (norm: string, ca: string) => `${norm}::${ca}`;

  const topMap = new Map<
    string,
    Array<{
      handle: string;
      views: number;
      avatar: string | null;
      followers: number | null;
    }>
  >();
  for (const k of shillers) {
    const id = key(k.token_key_norm, k.contract_address);
    const arr = topMap.get(id) || [];
    arr.push({
      handle: shortHandle(k.handle),
      views: k.views,
      avatar: k.avatar,
      followers: k.followers,
    });
    topMap.set(id, arr);
  }
  for (const [id, arr] of topMap) {
    arr.sort((a, b) => b.views - a.views);
    topMap.set(id, arr.slice(0, 3));
  }

  // Build items
  const itemsAll: ItemOut[] = sorted.map((r, i) => {
    const id = key(r.token_key_norm, r.contract_address);
    const score = scoreOf[id] ?? 0;
    return {
      rank: i + 1,
      ticker: r.token_ticker || r.token_key_norm,
      ca: r.contract_address,
      image: null,
      price_usd: null,
      mcap_usd: null,
      price_change_1h_pct: null,
      price_change_24h_pct: null,
      social_score: null,
      type: "unknown",
      attention_score: Number.isFinite(score) ? Number(score.toFixed(4)) : 0,
      top_shillers: topMap.get(id) || [],
      mentions: r.mentions,
      shillers: r.shillers,
      views: r.views,
      engs: r.engs,
    };
  });

  // Sort
  const byNorm = new Map(
    sorted.map((r) => [key(r.token_key_norm, r.contract_address), r]),
  );
  const metricOf = (
    it: ItemOut,
    which: "attention" | "views" | "shillers" | "mentions",
  ) => {
    if (which === "attention") return it.attention_score;
    if (which === "views")
      return byNorm.get(key(toTicker(it.ticker), it.ca))?.views ?? 0;
    if (which === "shillers")
      return byNorm.get(key(toTicker(it.ticker), it.ca))?.shillers ?? 0;
    return byNorm.get(key(toTicker(it.ticker), it.ca))?.mentions ?? 0;
  };
  const sortKey: "attention" | "views" | "shillers" | "mentions" =
    sort === "views" || sort === "shillers" || sort === "mentions"
      ? sort
      : "attention";
  itemsAll.sort((a, b) => {
    const ak = metricOf(a, sortKey);
    const bk = metricOf(b, sortKey);
    return order === "asc" ? ak - bk : bk - ak;
  });

  // Pagination
  const total = itemsAll.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const pageSlice = itemsAll.slice(start, end);

  const body: any = { page, pageSize, total, items: pageSlice };
  if (debug)
    body.__debug = {
      env: envInfo,
      window,
      sample: itemsAll
        .slice(0, 3)
        .map((x) => ({ t: x.ticker, ca: x.ca, views: x.views })),
    };
  return NextResponse.json(deepSanitize(body));
}
