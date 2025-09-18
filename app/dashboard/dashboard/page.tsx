// Server component: Dashboard (days-scoped cards + ROI leaderboard)
// Layout:
//   - Header + DaysSwitch + Hero counters
//   - Row 2: Last {days} Days (2 rows × 3 stats)
//   - Row 3: Top KOLs by ROIs (Nd) | Top KOLs by Coins Views (Nd) | Top Tokens by Mentions (Nd)

import TopTokensByMentions, { type TokenMentionsItem } from "@/components/dashboard/TopTokensByMentions";
import DaysSwitch from "@/components/dashboard/DaysSwitch";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetTokenMentions, coinCaTicker, coinPrice } from "@/lib/db/schema";
import { and, eq, gte, lt, desc, sql } from "drizzle-orm";
import { Calendar, Users, MessageSquare, Coins, CheckCheck, TrendingUp, Trophy, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

// ---------- small utils ----------
type SearchParams = Record<string, string | string[] | undefined>;
type Numish = number | bigint | null;
const toNum = (x: Numish) => (typeof x === "bigint" ? Number(x) : Number(x ?? 0));
const fmtCompact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtDateOnly = (d?: Date | null) => (d ? new Date(d).toLocaleDateString() : "—");
const rankBadge = (rank: number) =>
  rank === 0 ? "text-yellow-300" : rank === 1 ? "text-gray-300" : rank === 2 ? "text-amber-700" : "text-gray-500";
const toDays = (v: unknown): 7 | 30 => (Number(Array.isArray(v) ? v[0] : v) === 30 ? 30 : 7);

// Strict rolling window: [now - days*24h, now)
function makeWindow(days: 7 | 30) {
  const until = new Date();
  const since = new Date(Date.now() - days * 864e5);
  return { since, until };
}

// quick CA heuristics for fallback if mapping is missing
function looksLikeCA(s?: string | null) {
  if (!s) return false;
  const v = String(s).trim();
  const evm = /^0x[a-fA-F0-9]{38,}$/;
  const b58 = /^[1-9A-HJ-NP-Za-km-z]{32,}$/;
  return evm.test(v) || b58.test(v);
}

// ---------- Hero (global counters, not windowed) ----------
async function getHeroStats() {
  const [earliest] = await db.select({ d: sql<Date>`MIN(${kolTweets.publishDate})` }).from(kolTweets);
  const [kCount] = await db.select({ c: sql<number>`COUNT(*)` }).from(kols);
  const [tCount] = await db.select({ c: sql<number>`COUNT(*)` }).from(kolTweets);
  const [mentions] = await db.select({ c: sql<number>`COUNT(*)` }).from(tweetTokenMentions);
  const [resolved] = await db.select({ c: sql<number>`COUNT(*)` }).from(coinCaTicker);

  return {
    earliestDate: earliest?.d ?? null,
    totalKOLs: toNum(kCount?.c),
    totalTweets: toNum(tCount?.c),
    coinShills: toNum(mentions?.c),
    coinsResolved: toNum(resolved?.c),
  };
}

// ---------- Last N Days + Top KOLs by Coins Views (Nd) ----------
async function getWindowStats(days: 7 | 30) {
  const { since, until } = makeWindow(days);

  const [tw] = await db
    .select({ c: sql<number>`COUNT(${kolTweets.tweetId})` })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)));

  const [shills] = await db
    .select({ c: sql<number>`COUNT(${tweetTokenMentions.id})` })
    .from(tweetTokenMentions)
    .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`${tweetTokenMentions.source} IN ('ticker','phrase','ca')`,
        eq(tweetTokenMentions.excluded, false),
      ),
    );

  const activeKOLs = await db
    .select({ u: kolTweets.twitterUid })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)))
    .groupBy(kolTweets.twitterUid);

  const [veCoins] = await db
    .select({
      views: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      engs: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}), 0)`,
    })
    .from(kolTweets)
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`EXISTS (
          SELECT 1
          FROM ${tweetTokenMentions} m
          WHERE m.tweet_id = ${kolTweets.tweetId}
            AND m.source IN ('ticker','phrase','ca')
            AND m.excluded = false
        )`,
      ),
    );

  const topKOLsByCoinsViews = await db
    .select({
      handle: kolTweets.twitterUsername,
      views: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      tweets: sql<number>`COUNT(${kolTweets.tweetId})`,
    })
    .from(kolTweets)
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`EXISTS (
          SELECT 1
          FROM ${tweetTokenMentions} m
          WHERE m.tweet_id = ${kolTweets.tweetId}
            AND m.source IN ('ticker','phrase','ca')
            AND m.excluded = false
        )`,
      ),
    )
    .groupBy(kolTweets.twitterUsername)
    .orderBy(desc(sql`COALESCE(SUM(${kolTweets.views}), 0)`))
    .limit(10);

  const coinsViews = toNum(veCoins?.views ?? 0);
  const coinsEngs = toNum(veCoins?.engs ?? 0);

  return {
    lastNd: {
      activeKOLs: activeKOLs.length,
      totalTweets: toNum(tw?.c),
      coinShills: toNum(shills?.c),
      coinsViews,
      coinsEngs,
      coinsER: coinsViews > 0 ? coinsEngs / coinsViews : 0,
    },
    topKOLsByCoinsViews: topKOLsByCoinsViews.map((r) => ({
      handle: r.handle,
      views: toNum(r.views),
      tweets: toNum(r.tweets),
    })),
  };
}

// ---------- Top Tokens by Mentions (Nd) ----------
async function getTopTokensByMentions(days: 7 | 30): Promise<TokenMentionsItem[]> {
  const { since, until } = makeWindow(days);

  const rows = await db
    .select({
      tokenKey: tweetTokenMentions.tokenKey,
      tokenDisplay: tweetTokenMentions.tokenDisplay,
      mappedCA: coinCaTicker.contractAddress,
      mentions: sql<number>`COUNT(${tweetTokenMentions.id})`,
    })
    .from(tweetTokenMentions)
    .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
    .leftJoin(
      coinCaTicker,
      sql`
        LOWER(${coinCaTicker.tokenTicker}) = LOWER(${tweetTokenMentions.tokenKey})
        OR LOWER(${coinCaTicker.tokenTicker}) = LOWER(REPLACE(${tweetTokenMentions.tokenDisplay}, '$',''))
      `,
    )
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`${tweetTokenMentions.source} IN ('ticker','phrase','ca')`,
        eq(tweetTokenMentions.excluded, false),
      ),
    )
    .groupBy(
      tweetTokenMentions.tokenKey,
      tweetTokenMentions.tokenDisplay,
      coinCaTicker.contractAddress,
    )
    .orderBy(desc(sql`COUNT(${tweetTokenMentions.id})`))
    .limit(10);

  return rows.map((r) => {
    const key = String(r.tokenKey ?? "");
    const ca = r.mappedCA ?? (looksLikeCA(key) ? key : null);
    return {
      tokenKey: key.toLowerCase(),
      tokenDisplay: r.tokenDisplay ?? key.toUpperCase(),
      contractAddress: ca,
      mentions: Number(r.mentions ?? 0),
    };
  });
}

// ---------- Top KOLs by ROIs (Nd) with LOWEST basis ----------
type KolRoiRow = { handle: string; avgRoi: number; shills: number };

async function getTopKolsByRoi(days: 7 | 30): Promise<KolRoiRow[]> {
  const { since, until } = makeWindow(days);

  // m_raw: raw mentions in window with resolved CA (source='ca' uses raw token_key)
  // m:     aggregate per (handle, ca) taking LOWEST price_usd_at as basis
  // latest: latest price per CA
  // samples: ROI for each (handle, ca) using lowest basis
  // roi:   avg ROI per handle + join total shills count (from m_raw)
  const res = await db.execute(sql`
    WITH m_raw AS (
      SELECT
        kt.twitter_username AS handle,
        CASE
          WHEN tm.source = 'ca' THEN tm.token_key
          ELSE cct.contract_address
        END AS ca,
        (tm.price_usd_at)::numeric AS price_at
      FROM ${tweetTokenMentions} tm
      INNER JOIN ${kolTweets} kt ON kt.tweet_id = tm.tweet_id
      LEFT JOIN ${coinCaTicker} cct
        ON LOWER(cct.token_ticker) = LOWER(tm.token_key)
        OR LOWER(cct.token_ticker) = LOWER(REPLACE(tm.token_display, '$',''))
      WHERE kt.publish_date >= ${since}
        AND kt.publish_date < ${until}
        AND tm.source IN ('ticker','phrase','ca')
        AND tm.excluded = false
    ),
    shills_count AS (
      SELECT handle, COUNT(*) AS shills
      FROM m_raw
      GROUP BY handle
    ),
    m AS (
      SELECT handle, ca, MIN(price_at) AS price_at
      FROM m_raw
      WHERE ca IS NOT NULL AND price_at IS NOT NULL
      GROUP BY handle, ca
    ),
    latest AS (
      SELECT DISTINCT ON (cp.contract_address)
        cp.contract_address,
        (cp.price_usd)::numeric AS price_latest
      FROM ${coinPrice} cp
      ORDER BY cp.contract_address, cp.price_at DESC
    ),
    samples AS (
      SELECT
        m.handle,
        m.ca,
        m.price_at,
        l.price_latest,
        CASE
          WHEN m.price_at > 0 AND l.price_latest > 0
          THEN (l.price_latest / m.price_at) - 1
          ELSE NULL
        END AS roi
      FROM m
      LEFT JOIN latest l ON l.contract_address = m.ca
    ),
    roi AS (
      SELECT
        handle,
        AVG(roi) AS avg_roi
      FROM samples
      WHERE roi IS NOT NULL
      GROUP BY handle
    )
    SELECT
      r.handle,
      r.avg_roi,
      COALESCE(s.shills, 0) AS shills
    FROM roi r
    LEFT JOIN shills_count s ON s.handle = r.handle
    ORDER BY r.avg_roi DESC
    LIMIT 10;
  `);

  const rows = (res as any)?.rows ?? [];
  return rows.map((r: any) => ({
    handle: String(r.handle),
    avgRoi: Number(r.avg_roi ?? 0),
    shills: Number(r.shills ?? 0),
  }));
}

// ---------- Page ----------
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const days = toDays(sp.days ?? 7); // one global param controls all cards

  const [hero, windowStats, tokenRows, roiRows] = await Promise.all([
    getHeroStats(),
    getWindowStats(days),
    getTopTokensByMentions(days),
    getTopKolsByRoi(days),
  ]);

  const cards = [
    { label: "First Tweet", value: fmtDateOnly(hero.earliestDate), Icon: Calendar },
    { label: "Total KOLs", value: fmtCompact(hero.totalKOLs), Icon: Users },
    { label: "Total Tweets", value: fmtCompact(hero.totalTweets), Icon: MessageSquare },
    { label: "Coins shills", value: fmtCompact(hero.coinShills), Icon: Coins },
    { label: "Coins resolved", value: fmtCompact(hero.coinsResolved), Icon: CheckCheck },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header + global days switch (affects ALL cards) */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Dashboard - KOLs Overview</h1>
        <DaysSwitch days={days} />
      </div>

      {/* Hero counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="group relative rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-4
                       transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                       hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              style={{
                background:
                  "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
              }}
              aria-hidden
            />
            <div className="relative flex items-center gap-3">
              <div className="rounded-xl border border-white/10 p-2 bg-black/40">
                <Icon size={18} className="text-emerald-300" />
              </div>
              <div>
                <div className="text-xs text-gray-400">{label}</div>
                <div className="mt-0.5 text-xl font-semibold">{value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2 — Last Nd (2 rows × 3 stats) */}
      <div
        className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                   transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                   hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background:
              "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-2 mb-3">
          <TrendingUp size={18} className="text-emerald-300" />
          <div className="font-medium">Last {days} Days</div>
        </div>

        {/* 2 rows × 3 cols */}
        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          {/* Row 1 */}
          <Stat label="Active KOLs" value={fmtCompact(windowStats.lastNd.activeKOLs)} />
          <Stat label="Total Tweets" value={fmtCompact(windowStats.lastNd.totalTweets)} />
          <Stat label="Coins shills" value={fmtCompact(windowStats.lastNd.coinShills)} />
          {/* Row 2 */}
          <Stat label="Coins Views" value={fmtCompact(windowStats.lastNd.coinsViews)} />
          <Stat label="Coins Engs." value={fmtCompact(windowStats.lastNd.coinsEngs)} />
          <Stat label="Coins Eng. Rate" value={fmtPct(windowStats.lastNd.coinsER)} />
        </div>
      </div>

      {/* Row 3 — ROI | Coins Views | Tokens by Mentions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Top KOLs by ROIs (Nd) */}
        <div
          className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                     transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                     hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center gap-2 mb-3">
            <BarChart3 size={18} className="text-emerald-300" />
            <div className="font-medium">Top KOLs by ROIs ({days}d)</div>
          </div>

          {roiRows.length === 0 ? (
            <div className="text-sm text-gray-400">No ROI samples in this range.</div>
          ) : (
            <ul className="relative space-y-2 text-sm">
              {roiRows.map((r, idx) => (
                <li
                  key={r.handle}
                  className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30
                             transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                             hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Trophy size={16} className={rankBadge(idx)} aria-hidden />
                    <a
                      href={`https://x.com/${r.handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/90
                                 hover:border-white/20 hover:bg-white/10"
                      title={`@${r.handle}`}
                    >
                      @{r.handle}
                    </a>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <div className={`tabular-nums ${r.avgRoi >= 0 ? "text-emerald-300" : "text-rose-300"} font-semibold`}>
                      {fmtPct(r.avgRoi)}
                    </div>
                    <span
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300"
                      title="Total shill mentions in range"
                    >
                      shills {fmtCompact(r.shills)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top KOLs by Coins Views (Nd) */}
        <div
          className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                     transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                     hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center gap-2 mb-3">
            <Trophy size={18} className="text-emerald-300" />
            <div className="font-medium">Top KOLs by Coins Views ({days}d)</div>
          </div>
          <ul className="relative space-y-2 text-sm">
            {windowStats.topKOLsByCoinsViews.map((k, idx) => (
              <li
                key={k.handle}
                className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30
                           transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                           hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Trophy size={16} className={rankBadge(idx)} aria-hidden />
                  <a
                    href={`https://x.com/${k.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`@${k.handle}`}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1
                               text-xs font-semibold text-white/90 truncate
                               hover:border-white/20 hover:bg-white/10
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
                  >
                    @{k.handle}
                  </a>
                </div>
                <span className="tabular-nums text-gray-300">{fmtCompact(k.views)} views</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Top Tokens by Mentions (Nd) */}
        <TopTokensByMentions rows={tokenRows} days={days} title="Top Tokens by Mentions" />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl border border-white/10 p-3 transition-colors duration-200
                 hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="text-gray-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
