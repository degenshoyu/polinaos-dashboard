// Server component: Dashboard (unified days filter + 3 cards)
// - Global "?days=7|30" param drives ALL 3 cards.
// - Mentions windowed by kol_tweets.publish_date via tweet_id join.
// - Contract address resolved from coin_ca_ticker by:
//     LOWER(token_key) = LOWER(token_ticker)
//   OR LOWER(REPLACE(token_display, '$','')) = LOWER(token_ticker)
//   (fallback: if token_key looks like a CA, use it)

import TopTokensByMentions, { type TokenMentionsItem } from "@/components/dashboard/TopTokensByMentions";
import DaysSwitch from "@/components/dashboard/DaysSwitch";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetTokenMentions, coinCaTicker } from "@/lib/db/schema";
import { and, eq, gte, lt, desc, sql } from "drizzle-orm";
import { Calendar, Users, MessageSquare, Coins, CheckCheck, TrendingUp, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

// ---------- small utils ----------
type SearchParams = Record<string, string | string[] | undefined>;
type Numish = number | bigint | null;
const toNum = (x: Numish) => (typeof x === "bigint" ? Number(x) : Number(x ?? 0));
// compact numbers like 10.5M
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
  const evm = /^0x[a-fA-F0-9]{38,}$/;          // rough EVM check
  const b58 = /^[1-9A-HJ-NP-Za-km-z]{32,}$/;   // rough Solana check
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
    coinShills: toNum(mentions?.c), // wording aligned
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

  const [veAll] = await db
    .select({
      views: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      engs: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}), 0)`,
    })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)));

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
    .limit(10); // Top 10

  const totalViews = toNum(veAll?.views ?? 0);
  const totalEngs = toNum(veAll?.engs ?? 0);
  const coinsViews = toNum(veCoins?.views ?? 0);
  const coinsEngs = toNum(veCoins?.engs ?? 0);

  return {
    lastNd: {
      totalTweets: toNum(tw?.c),
      coinShills: toNum(shills?.c),
      activeKOLs: activeKOLs.length,
      totalViews,
      totalEngs,
      avgER: totalViews > 0 ? totalEngs / totalViews : 0,
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

  // Mentions -> Tweets (window by publishDate), then LEFT JOIN ticker->CA mapping.
  // Join condition supports both token_key and token_display (without '$').
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
    .limit(10); // Top 10

  // fallback CA: if mapping is null but tokenKey looks like a CA, use tokenKey
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

// ---------- Page ----------
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const days = toDays(sp.days ?? 7); // one global param controls all cards

  const [hero, windowStats, tokenRows] = await Promise.all([
    getHeroStats(),
    getWindowStats(days),
    getTopTokensByMentions(days),
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
      {/* Header + global days switch (affects ALL 3 cards) */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Dashboard - KOLs Overview</h1>
        <DaysSwitch days={days} />
      </div>

      {/* Hero counters (global, compact numbers) */}
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

      {/* 3 cards row — unified style */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Last Nd (compact numbers) */}
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
          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Total Tweets" value={fmtCompact(windowStats.lastNd.totalTweets)} />
            <Stat label="Coins shills" value={fmtCompact(windowStats.lastNd.coinShills)} />
            <Stat label="Active KOLs" value={fmtCompact(windowStats.lastNd.activeKOLs)} />
            <Stat label="Total Views" value={fmtCompact(windowStats.lastNd.totalViews)} />
            <Stat label="Total Engs." value={fmtCompact(windowStats.lastNd.totalEngs)} />
            <Stat label="Avg. Eng. Rate" value={fmtPct(windowStats.lastNd.avgER)} />
            <Stat label="Coins Views" value={fmtCompact(windowStats.lastNd.coinsViews)} />
            <Stat label="Coins Engs." value={fmtCompact(windowStats.lastNd.coinsEngs)} />
            <Stat label="Coins Eng. Rate" value={fmtPct(windowStats.lastNd.coinsER)} />
          </div>
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
                  {/* Use the same pill style as the token ticker to match row height */}
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

        {/* Top Tokens by Mentions (Nd) — exact same style, wording = "shills" */}
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
