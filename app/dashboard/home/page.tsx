// app/dashboard/home/page.tsx
import TopTokensByMentions, { type TopCoinRow } from "@/components/dashboard/TopTokensByMentions";
import DaysSwitch from "@/components/dashboard/DaysSwitch";
import TopKolsCard from "@/components/dashboard/TopKolsCard";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetType, tweetTokenMentions, coinCaTicker, coinPrice } from "@/lib/db/schema";
import { and, eq, gte, lt, desc, sql } from "drizzle-orm";
import { BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const dynamic = "force-dynamic";

/* ---------- utils ---------- */
type SearchParams = Record<string, string | string[] | undefined>;
type Numish = number | bigint | null | undefined;
const toNum = (x: Numish) => (typeof x === "bigint" ? Number(x) : Number(x ?? 0));
const fmtCompact = (n: number | null | undefined) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n ?? 0));
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const toDays = (v: unknown): 7 | 30 => (Number(Array.isArray(v) ? v[0] : v) === 30 ? 30 : 7);

function makeWindow(days: 7 | 30) {
  const until = new Date();
  const since = new Date(until.getTime() - days * 864e5);
  const prevUntil = since;
  const prevSince = new Date(prevUntil.getTime() - days * 864e5);
  return { since, until, prevSince, prevUntil };
}

/* ---------- window stats with deltas ---------- */
async function getWindowStats(days: 7 | 30) {
  const { since, until, prevSince, prevUntil } = makeWindow(days);

  const sumAllViews = async (a: Date, b: Date) => {
    const [r] = await db.select({ v: sql<number>`COALESCE(SUM(${kolTweets.views}),0)` }).from(kolTweets).where(and(gte(kolTweets.publishDate, a), lt(kolTweets.publishDate, b)));
    return toNum(r?.v);
  };

  const sumAllEngs = async (a: Date, b: Date) => {
    const [r] = await db
      .select({ e: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)` })
      .from(kolTweets)
      .where(and(gte(kolTweets.publishDate, a), lt(kolTweets.publishDate, b)));
    return toNum(r?.e);
  };

  const sumCoinViewsEngs = async (a: Date, b: Date) => {
    const [r] = await db
      .select({
        views: sql<number>`COALESCE(SUM(${kolTweets.views}),0)`,
        engs: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)`,
      })
      .from(kolTweets)
      .where(
        and(
          gte(kolTweets.publishDate, a),
          lt(kolTweets.publishDate, b),
          sql`EXISTS (
            SELECT 1 FROM ${tweetTokenMentions} m
            WHERE m.tweet_id = ${kolTweets.tweetId}
              AND m.source IN ('ticker','phrase','ca')
              AND m.excluded = false
          )`,
        ),
      );
    return { views: toNum(r?.views), engs: toNum(r?.engs) };
  };

  const countActiveKols = async (a: Date, b: Date) => {
    const rows = await db
      .select({ u: kolTweets.twitterUid })
      .from(kolTweets)
      .where(and(gte(kolTweets.publishDate, a), lt(kolTweets.publishDate, b)))
      .groupBy(kolTweets.twitterUid);
    return rows.length;
  };

  const countTweets = async (a: Date, b: Date) => {
    const [r] = await db.select({ c: sql<number>`COUNT(${kolTweets.tweetId})` }).from(kolTweets).where(and(gte(kolTweets.publishDate, a), lt(kolTweets.publishDate, b)));
    return toNum(r?.c);
  };

  const countShills = async (a: Date, b: Date) => {
    const [r] = await db
      .select({ c: sql<number>`COUNT(${tweetTokenMentions.id})` })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
      .where(
        and(
          gte(kolTweets.publishDate, a),
          lt(kolTweets.publishDate, b),
          sql`${tweetTokenMentions.source} IN ('ticker','phrase','ca')`,
          eq(tweetTokenMentions.excluded, false),
        ),
      );
    return toNum(r?.c);
  };

  // current window
  const [activeKOLs, totalTweets, coinShills, totalViews, totalEngs, ve] = await Promise.all([
    countActiveKols(since, until),
    countTweets(since, until),
    countShills(since, until),
    sumAllViews(since, until),
    sumAllEngs(since, until),
    sumCoinViewsEngs(since, until),
  ]);
  const coinsViews = ve.views;
  const coinsEngs = ve.engs;

  // previous window
  const [pActiveKOLs, pTotalTweets, pCoinShills, pTotalViews, pTotalEngs, pve] = await Promise.all([
    countActiveKols(prevSince, prevUntil),
    countTweets(prevSince, prevUntil),
    countShills(prevSince, prevUntil),
    sumAllViews(prevSince, prevUntil),
    sumAllEngs(prevSince, prevUntil),
    sumCoinViewsEngs(prevSince, prevUntil),
  ]);

  const pct = (cur: number, prev: number) => (prev ? cur / prev - 1 : 0);

  return {
    current: { activeKOLs, totalTweets, coinShills, totalViews, totalEngs, coinsViews, coinsEngs },
    delta: {
      activeKOLs: pct(activeKOLs, pActiveKOLs),
      totalTweets: pct(totalTweets, pTotalTweets),
      coinShills: pct(coinShills, pCoinShills),
      totalViews: pct(Number(totalViews), Number(pTotalViews)),
      totalEngs: pct(Number(totalEngs), Number(pTotalEngs)),
      coinsViews: pct(Number(coinsViews), Number(pve.views)),
      coinsEngs: pct(Number(coinsEngs), Number(pve.engs)),
    },
  };
}

/* ---------- Top KOLs (multiple metrics) ---------- */
type KolRow = { handle: string; avatarUrl: string | null; followers: number; value: number };

async function getTopKols(days: 7 | 30) {
  const { since, until } = makeWindow(days);

  const baseWhere = and(
    gte(kolTweets.publishDate, since),
    lt(kolTweets.publishDate, until),
    sql`EXISTS (
      SELECT 1 FROM ${tweetTokenMentions} m
      WHERE m.tweet_id = ${kolTweets.tweetId}
        AND m.source IN ('ticker','phrase','ca')
        AND m.excluded = false
    )`,
  );

  const coinsViews = await db
    .select({ handle: kolTweets.twitterUsername, value: sql<number>`COALESCE(SUM(${kolTweets.views}),0)` })
    .from(kolTweets)
    .where(baseWhere)
    .groupBy(kolTweets.twitterUsername)
    .orderBy(desc(sql`COALESCE(SUM(${kolTweets.views}),0)`))
    .limit(10);

  const coinsEngs = await db
    .select({ handle: kolTweets.twitterUsername, value: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)` })
    .from(kolTweets)
    .where(baseWhere)
    .groupBy(kolTweets.twitterUsername)
    .orderBy(desc(sql`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)`))
    .limit(10);

  const coinShills = await db
    .select({ handle: kolTweets.twitterUsername, value: sql<number>`COUNT(${tweetTokenMentions.id})` })
    .from(kolTweets)
    .innerJoin(tweetTokenMentions, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
    .where(and(baseWhere, eq(tweetTokenMentions.excluded, false)))
    .groupBy(kolTweets.twitterUsername)
    .orderBy(desc(sql`COUNT(${tweetTokenMentions.id})`))
    .limit(10);

  const resRoi = await db.execute(sql`
  WITH m_raw AS (
    SELECT
      kt.twitter_username AS handle,
      CASE WHEN tm.source='ca' THEN tm.token_key ELSE cct.contract_address END AS ca,
      kt.publish_date AS pub_at,
      (tm.price_usd_at)::numeric              AS price_at,
      (tm.max_price_since_mention)::numeric   AS max_px
    FROM ${tweetTokenMentions} tm
    JOIN ${kolTweets} kt ON kt.tweet_id = tm.tweet_id
    LEFT JOIN ${coinCaTicker} cct
      ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
      OR LOWER(cct.token_ticker) = LOWER(REPLACE(COALESCE(tm.token_display,''),'$',''))
    WHERE kt.publish_date >= ${since}
      AND kt.publish_date <  ${until}
      AND tm.source IN ('ticker','phrase','ca')
      AND tm.excluded = false
      AND (CASE WHEN tm.source='ca' THEN tm.token_key IS NOT NULL ELSE cct.contract_address IS NOT NULL END)
  ),
  m_pick AS (
    SELECT DISTINCT ON (handle, ca)
      handle, ca, price_at, max_px
    FROM m_raw
    WHERE price_at > 0 AND max_px IS NOT NULL
    ORDER BY handle, ca, pub_at ASC
  ),
  samples AS (
    SELECT handle, (max_px / NULLIF(price_at,0) - 1) AS roi
    FROM m_pick
  )
  SELECT handle, AVG(roi) AS value
  FROM samples
  GROUP BY handle
  ORDER BY AVG(roi) DESC
  LIMIT 10;
`);
const avgRoi = ((resRoi as any).rows as Array<{ handle: string; value: number }>).map((r) => ({
  handle: r.handle,
  value: Number(r.value) || 0,
}));

  // 头像 + 粉丝 enrich（修复 IN 展开）
  const enrich = async (rows: Array<{ handle: string; value: number }>): Promise<KolRow[]> => {
    if (!rows.length) return [];
    const handles = Array.from(new Set(rows.map((r) => r.handle?.toLowerCase()).filter(Boolean)));
    if (!handles.length) return rows.map((r) => ({ handle: r.handle, value: r.value, followers: 0, avatarUrl: null }));

    const found = await db
      .select({ handle: kols.twitterUsername, followers: kols.followers, avatarUrl: kols.profileImgUrl })
      .from(kols)
      .where(sql`LOWER(${kols.twitterUsername}) IN (${sql.join(handles.map((h) => sql`${h}`), sql`, `)})`);

    const map = new Map(found.map((k) => [k.handle?.toLowerCase?.(), k]));
    return rows.map((r) => {
      const k = map.get(r.handle.toLowerCase());
      return { handle: r.handle, value: r.value, followers: toNum(k?.followers) || 0, avatarUrl: k?.avatarUrl ?? null };
    });
  };

  return {
    avgRoi: await enrich(avgRoi),
    coinShills: await enrich(coinShills.map((r) => ({ handle: r.handle, value: toNum(r.value) }))),
    coinsViews: await enrich(coinsViews.map((r) => ({ handle: r.handle, value: toNum(r.value) }))),
    coinsEngs: await enrich(coinsEngs.map((r) => ({ handle: r.handle, value: toNum(r.value) }))),
  };
}

/* ---------- Top Coins (Nd) — coverage × reach × resonance × velocity ---------- */
async function getTopCoins(days: 7 | 30): Promise<TopCoinRow[]> {
  const { since, until } = makeWindow(days);

  const res = await db.execute(sql`
    WITH m_raw AS (
      SELECT
        CASE WHEN tm.source='ca' THEN tm.token_key ELSE cct.contract_address END AS ca,
        COALESCE(NULLIF(tm.token_display,''), tm.token_key) AS token_display,
        tm.token_key AS token_key,
        kt.twitter_uid AS uid,
        kt.publish_date AS pub_at,
        (kt.views)::numeric AS views,
        (kt.likes + kt.retweets + kt.replies)::numeric AS engs
      FROM ${tweetTokenMentions} tm
      JOIN ${kolTweets} kt ON kt.tweet_id = tm.tweet_id
      LEFT JOIN ${coinCaTicker} cct
        ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
        OR LOWER(cct.token_ticker) = LOWER(REPLACE(COALESCE(tm.token_display,''),'$',''))
      WHERE kt.publish_date >= ${since}
        AND kt.publish_date <  ${until}
        AND tm.source IN ('ticker','phrase','ca')
        AND tm.excluded = false
        AND kt.type = ANY (ARRAY['tweet','quote']::tweet_type[])
        AND (CASE WHEN tm.source='ca' THEN tm.token_key IS NOT NULL ELSE cct.contract_address IS NOT NULL END)
    ),
    m_dedup AS (
      SELECT DISTINCT ON (ca, uid, date_trunc('day', pub_at))
        ca, token_display, token_key, uid, pub_at, views, engs
      FROM m_raw
      ORDER BY ca, uid, date_trunc('day', pub_at), pub_at DESC
    ),
    agg_all AS (
      SELECT
        ca,
        MIN(token_display) AS token_display,
        MIN(token_key)     AS token_key,
        COUNT(*)           AS mentions,
        COUNT(DISTINCT uid) AS shillers,
        SUM(views)         AS views,
        SUM(engs)          AS engs,
        CASE WHEN SUM(views) > 0 THEN SUM(engs)/SUM(views) ELSE 0 END AS er
      FROM m_dedup
      GROUP BY ca
    ),
    last24 AS (
      SELECT ca, COUNT(*) AS m_last24
      FROM m_dedup
      WHERE pub_at >= (${until}::timestamptz - INTERVAL '1 day') AND pub_at < ${until}
      GROUP BY ca
    ),
    prev AS (
      SELECT ca, COUNT(*) AS m_prev
      FROM m_dedup
      WHERE pub_at >= ${since} AND pub_at < (${until}::timestamptz - INTERVAL '1 day')
      GROUP BY ca
    )
    SELECT a.ca, a.token_display, a.token_key,
           a.mentions, a.shillers, a.views, a.engs, a.er,
           COALESCE(l.m_last24, 0) AS m_last24,
           COALESCE(p.m_prev,  0)  AS m_prev
    FROM agg_all a
    LEFT JOIN last24 l USING (ca)
    LEFT JOIN prev   p USING (ca)
    ORDER BY a.shillers DESC
    LIMIT 200;
  `);

  const rows = (res as any).rows as Array<{
    ca: string; token_display: string | null; token_key: string | null;
    mentions: string | number; shillers: string | number;
    views: string | number; engs: string | number; er: string | number;
    m_last24: string | number; m_prev: string | number;
  }>;

  const parsed = rows.map((r) => {
    const tokenDisplay = (r.token_display || r.token_key || "").replace(/^\$+/, ""); // 去掉多余 $
    const velocity = Number(r.m_prev) > 0 ? Number(r.m_last24) / Number(r.m_prev) : (Number(r.m_last24) ? 1 : 0);
    // 简单得分：覆盖×触达×共鸣×速度（已在组件中解释）
    const norm = (x: number) => x; // 排序只需相对量级
    const score = 0.4 * norm(Number(r.shillers)) + 0.2 * Math.log1p(Number(r.views)) + 0.15 * Math.log1p(Number(r.engs)) + 0.15 * Number(r.er) + 0.1 * Number(velocity);

    return {
      tokenKey: tokenDisplay.toUpperCase(),
      tokenDisplay: tokenDisplay,
      contractAddress: r.ca,
      mentions: Number(r.mentions),
      shillers: Number(r.shillers),
      views: Number(r.views),
      engs: Number(r.engs),
      er: Number(r.er),
      velocity,
      score,
    } satisfies TopCoinRow;
  });

  const cas = Array.from(new Set(parsed.map((p) => p.contractAddress).filter(Boolean))) as string[];
  let perCoinTopKols: Record<
    string,
    Array<{ handle: string; tweets: number; views: number; engs: number; followers?: number; profile_img_url?: string | null }>
  > = {};

  if (cas.length > 0) {
    const per = await db.execute(sql`
      WITH base AS (
        SELECT
          CASE WHEN tm.source='ca' THEN tm.token_key ELSE cct.contract_address END AS ca,
          kt.twitter_username AS handle,
          COUNT(*)                               AS t,          -- tweets
          SUM(kt.views)                          AS v,          -- views
          SUM(kt.likes + kt.retweets + kt.replies) AS e         -- engs
        FROM ${tweetTokenMentions} tm
        JOIN ${kolTweets} kt ON kt.tweet_id = tm.tweet_id
        LEFT JOIN ${coinCaTicker} cct
          ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
          OR LOWER(cct.token_ticker) = LOWER(REPLACE(COALESCE(tm.token_display,''),'$',''))
        WHERE kt.publish_date >= ${since}
          AND kt.publish_date <  ${until}
          AND tm.source IN ('ticker','phrase','ca')
          AND tm.excluded = false
          AND kt.type = ANY (ARRAY['tweet','quote']::tweet_type[])
        GROUP BY ca, handle
      )
      SELECT b.ca, b.handle,
             b.t::numeric  AS tweets,
             b.v::numeric  AS views,
             b.e::numeric  AS engs,
             k.followers,
             k.profile_img_url
      FROM base b
      LEFT JOIN ${kols} k ON LOWER(k.twitter_username) = LOWER(b.handle)
      WHERE b.ca IN (${sql.join(cas.map((ca) => sql`${ca}`), sql`, `)})
      ORDER BY b.ca, views DESC;
    `);

    for (const r of (per as any).rows as Array<{ ca: string; handle: string; tweets: number; views: number; engs: number; followers: number | null; profile_img_url: string | null }>) {
      (perCoinTopKols[r.ca] ||= []).push({
        handle: r.handle,
        tweets: Number(r.tweets) || 0,
        views: Number(r.views),
        engs: Number(r.engs) || 0,
        followers: toNum(r.followers) || 0,
        profile_img_url: r.profile_img_url,
      });
    }
  }

  const withKols = parsed.map((p) => {
    const raw = perCoinTopKols[p.contractAddress ?? ""] || [];
    const topKols = raw.slice(0, 10).map((k) => ({
      handle: k.handle,
      tweets: Number(k.tweets) || 0,
      views: Number(k.views) || 0,
      engs: Number(k.engs) || 0,
      followers: typeof k.followers === "number" ? k.followers : 0,
      avatarUrl: k.profile_img_url ?? null,
    }));
    return { ...p, topKols } as unknown as TopCoinRow;
  });

  return withKols;
}

/* ---------- Page ---------- */
export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const days = toDays(sp.days);
  const [{ current, delta }, topKols, topCoins] = await Promise.all([getWindowStats(days), getTopKols(days), getTopCoins(days)]);

  const fromLabel = days === 30 ? "from last month" : "from last week";
  /** Render a compact delta pair line like: "12.34% ↑ / 5.67% ↓ from last week" */
  function DeltaPair({ a, b, label }: { a: number; b: number; label: string }) {
    const AIcon = a >= 0 ? ArrowUpRight : ArrowDownRight;
    const BIcon = b >= 0 ? ArrowUpRight : ArrowDownRight;
    return (
      <div className="mt-1 text-[11px] text-gray-300 flex items-center gap-1">
        <span className="inline-flex items-center gap-1">
          {fmtPct(Math.abs(a))} <AIcon className={a >= 0 ? "h-3 w-3 text-emerald-300" : "h-3 w-3 text-red-300"} />
        </span>
        <span className="opacity-60">/</span>
        <span className="inline-flex items-center gap-1">
          {fmtPct(Math.abs(b))} <BIcon className={b >= 0 ? "h-3 w-3 text-emerald-300" : "h-3 w-3 text-red-300"} />
        </span>
        <span className="ml-1 opacity-80">{label}</span>
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-semibold tracking-tight">Overview</h1>
        <DaysSwitch days={days} />
      </div>

      {/* Row 2: four stats (as requested) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Active KOLs */}
        <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm text-gray-300">Active KOLs</div>
          <div className="mt-1 text-2xl font-semibold">{fmtCompact(current.activeKOLs)}</div>
          <div className="mt-1 text-xs text-emerald-300">
            {Math.sign(delta.activeKOLs) >= 0
              ? `${fmtPct(delta.activeKOLs)} Up ${fromLabel}`
              : `${fmtPct(Math.abs(delta.activeKOLs))} Down ${fromLabel}`}
          </div>
        </div>

        {/* 2. Total Tweets / Coin Shills */}
        <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm text-gray-300">Total Tweets / Coin Shills</div>
          <div className="mt-1 text-2xl font-semibold">
            {fmtCompact(current.totalTweets)} <span className="opacity-60">/</span> {fmtCompact(current.coinShills)}
          </div>
          {/* Compact dual-delta: left = Tweets, right = Shills */}
          <DeltaPair a={delta.totalTweets} b={delta.coinShills} label={fromLabel} />
        </div>

        {/* 3. Total Views / Coins Views */}
        <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm text-gray-300">Total Views / Coins Views</div>
          <div className="mt-1 text-2xl font-semibold">
            {fmtCompact(current.totalViews)} <span className="opacity-60">/</span> {fmtCompact(current.coinsViews)}
          </div>
          {/* Compact dual-delta: left = Total, right = Coins */}
          <DeltaPair a={delta.totalViews} b={delta.coinsViews} label={fromLabel} />
        </div>

        {/* 4. Total Engs / Coins Engs */}
        <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm text-gray-300">Total Engs / Coins Engs</div>
          <div className="mt-1 text-2xl font-semibold">
            {fmtCompact(current.totalEngs)} <span className="opacity-60">/</span> {fmtCompact(current.coinsEngs)}
          </div>
          {/* Compact dual-delta: left = Total, right = Coins */}
          <DeltaPair a={delta.totalEngs} b={delta.coinsEngs} label={fromLabel} />
        </div>
      </div>

      {/* Section: Leaderboards (side-by-side on xl+) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {/* Left: Top KOLs */}
        <TopKolsCard
          days={days}
          data={{
            avgRoi: topKols.avgRoi,
            coinShills: topKols.coinShills,
            coinsViews: topKols.coinsViews,
            coinsEngs: topKols.coinsEngs,
          }}
        />

        {/* Right: Top Coins */}
        <TopTokensByMentions rows={topCoins} days={days} />
      </div>
    </div>
  );
}
