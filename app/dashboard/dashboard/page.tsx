// app/dashboard/dashboard/page.tsx
import { db } from "@/lib/db/client";
import {
  kols,
  kolTweets,
  tweetTokenMentions,
  coinCaTicker,
} from "@/lib/db/schema";
import { sql, and, gte, lt, desc } from "drizzle-orm";
import {
  Calendar,
  Users,
  MessageSquare,
  Coins,
  CheckCheck,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { formatNumber } from "@/lib/utils/formatNumber";

export const dynamic = "force-dynamic";

type Numish = number | bigint | null;
const toNum = (x: Numish) => (typeof x === "bigint" ? Number(x) : Number(x ?? 0));
const fmtInt = (n: number) => n.toLocaleString();
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtDateOnly = (d?: Date | null) => (d ? new Date(d).toLocaleDateString() : "—");

// Compact contract address (e.g. 4wTV...axnjf)
function maskKey(s?: string | null): string {
  const str = (s ?? "").trim();
  if (str.length >= 12 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(str)) {
    return `${str.slice(0, 4)}...${str.slice(-4)}`;
  }
  return str || "—";
}

async function getHeroStats() {
  const [earliest] = await db
    .select({ d: sql<Date>`MIN(${kolTweets.publishDate})` })
    .from(kolTweets);

  const [kCount] = await db.select({ c: sql<number>`COUNT(*)` }).from(kols);
  const [tCount] = await db.select({ c: sql<number>`COUNT(*)` }).from(kolTweets);
  const [mentions] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tweetTokenMentions);
  const [resolved] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(coinCaTicker);

  return {
    earliestDate: earliest?.d ?? null,
    totalKols: toNum(kCount?.c),
    totalTweets: toNum(tCount?.c),
    coinMentions: toNum(mentions?.c),
    coinsResolved: toNum(resolved?.c),
  };
}

async function getFancyStats() {
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - 6);
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  const [tw7] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)));

  const [m7] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tweetTokenMentions)
    .where(and(gte(tweetTokenMentions.createdAt, since), lt(tweetTokenMentions.createdAt, until)));

  const activeKols7 = await db
    .select({ u: kolTweets.twitterUid })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)))
    .groupBy(kolTweets.twitterUid);
  const activeKolsCount = activeKols7.length;

  const [veAll] = await db
    .select({
      views: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      engs: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)`,
    })
    .from(kolTweets)
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)));

  const totalViews = toNum(veAll?.views ?? 0);
  const totalEngs = toNum(veAll?.engs ?? 0);
  const avgER = totalViews > 0 ? totalEngs / totalViews : 0;

  const [veCoins] = await db
    .select({
      views: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      engs: sql<number>`COALESCE(SUM(${kolTweets.likes}+${kolTweets.retweets}+${kolTweets.replies}),0)`,
    })
    .from(kolTweets)
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`EXISTS (SELECT 1 FROM tweet_token_mentions m WHERE m.tweet_id = ${kolTweets.tweetId})`,
      ),
    );

  const coinsViews = toNum(veCoins?.views ?? 0);
  const coinsEngs = toNum(veCoins?.engs ?? 0);
  const coinsER = coinsViews > 0 ? coinsEngs / coinsViews : 0;

  const topKolsByCoinsViews = await db
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
        sql`EXISTS (SELECT 1 FROM tweet_token_mentions m WHERE m.tweet_id = ${kolTweets.tweetId})`,
      ),
    )
    .groupBy(kolTweets.twitterUsername)
    .orderBy(desc(sql`COALESCE(SUM(${kolTweets.views}), 0)`))
    .limit(8);

  const topTokens = await db
    .select({
      tokenKey: tweetTokenMentions.tokenKey,
      tokenDisplay: tweetTokenMentions.tokenDisplay,
      c: sql<number>`COUNT(${tweetTokenMentions.id})`,
    })
    .from(tweetTokenMentions)
    .where(and(gte(tweetTokenMentions.createdAt, since), lt(tweetTokenMentions.createdAt, until)))
    .groupBy(tweetTokenMentions.tokenKey, tweetTokenMentions.tokenDisplay)
    .orderBy(desc(sql`COUNT(${tweetTokenMentions.id})`))
    .limit(8);

  return {
    last7d: {
      totalTweets: toNum(tw7?.c),
      coinMentions: toNum(m7?.c),
      activeKols: activeKolsCount,
      totalViews,
      totalEngs,
      avgER,
      coinsViews,
      coinsEngs,
      coinsER,
    },
    topKolsByCoinsViews: topKolsByCoinsViews.map((r) => ({
      handle: r.handle,
      views: toNum(r.views),
      tweets: toNum(r.tweets),
    })),
    topTokens: topTokens.map((r) => ({
      tokenKey: r.tokenKey,
      tokenDisplay: r.tokenDisplay ?? r.tokenKey.toUpperCase(),
      count: toNum(r.c),
    })),
  };
}

export default async function Page() {
  const [hero, fancy] = await Promise.all([getHeroStats(), getFancyStats()]);

  const cards = [
    { label: "First Tweet", value: fmtDateOnly(hero.earliestDate), Icon: Calendar },
    { label: "Total KOLs", value: fmtInt(hero.totalKols), Icon: Users },
    { label: "Total Tweets", value: fmtInt(hero.totalTweets), Icon: MessageSquare },
    { label: "Coins mentions", value: fmtInt(hero.coinMentions), Icon: Coins },
    { label: "Coins resolved", value: fmtInt(hero.coinsResolved), Icon: CheckCheck },
  ];

  const rankBadge = (rank: number) =>
    rank === 0 ? "text-yellow-300" : rank === 1 ? "text-gray-300" : rank === 2 ? "text-amber-700" : "text-gray-500";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Dashboard - KOLs Overview
        </h1>
      </div>

      {/* Hero */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="group relative rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-4
                       transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                       hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
          >
            {/* 极轻玻璃高光 */}
            <div
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200
                         group-hover:opacity-100"
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

      {/* 3 Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Last 7 Days */}
        <div
          className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                     transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                     hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200
                       group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center gap-2 mb-3">
            <TrendingUp size={18} className="text-emerald-300" />
            <div className="font-medium">Last 7 Days</div>
          </div>
          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Stat label="Total Tweets" value={formatNumber(fancy.last7d.totalTweets)} />
            <Stat label="Coins mentions" value={formatNumber(fancy.last7d.coinMentions)} />
            <Stat label="Active KOLs" value={fmtInt(fancy.last7d.activeKols)} />
            <Stat label="Total Views" value={formatNumber(fancy.last7d.totalViews)} />
            <Stat label="Total Engs." value={formatNumber(fancy.last7d.totalEngs)} />
            <Stat label="Avg. Eng. Rate" value={fmtPct(fancy.last7d.avgER)} />
            <Stat label="Coins Views" value={formatNumber(fancy.last7d.coinsViews)} />
            <Stat label="Coins Engs." value={formatNumber(fancy.last7d.coinsEngs)} />
            <Stat label="Coins Eng. Rate" value={fmtPct(fancy.last7d.coinsER)} />
          </div>
        </div>

        {/* Top KOLs */}
        <div
          className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                     transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                     hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200
                       group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center gap-2 mb-3">
            <Trophy size={18} className="text-emerald-300" />
            <div className="font-medium">Top KOLs by Coins Views (7d)</div>
          </div>
          <ul className="relative space-y-2 text-sm">
            {fancy.topKolsByCoinsViews.map((k, idx) => (
              <li
                key={k.handle}
                className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30
                           transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                           hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Trophy size={16} className={rankBadge(idx)} aria-hidden />
                  <a
                    className="truncate hover:underline focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-emerald-400/50 rounded-sm"
                    href={`https://x.com/${k.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`@${k.handle}`}
                  >
                    @{k.handle}
                  </a>
                </div>
                <span className="tabular-nums text-gray-300">{fmtInt(k.views)} views</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Top Tokens */}
        <div
          className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                     transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                     hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200
                       group-hover:opacity-100"
            style={{
              background:
                "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center gap-2 mb-3">
            <Coins size={18} className="text-emerald-300" />
            <div className="font-medium">Top Tokens by Mentions (7d)</div>
          </div>
          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-3">
            {fancy.topTokens.map((t) => (
              <div
                key={t.tokenKey}
                className="rounded-xl border border-white/10 p-3 bg-black/30
                           transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                           hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
                title={t.tokenKey}
              >
                <div className="text-xs text-gray-400 truncate">{maskKey(t.tokenKey)}</div>
                <div className="mt-0.5 text-base font-semibold truncate">{t.tokenDisplay}</div>
                <div className="mt-1 text-sm text-gray-300">{fmtInt(t.count)} mentions</div>
              </div>
            ))}
          </div>
        </div>
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
