// app/dashboard/leaderboard/kols/page.tsx
import KolsLeaderboardClient from "@/components/leaderboard/KolsLeaderboardClient";
import type { KolRow } from "@/components/types";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

export const dynamic = "force-dynamic"; // always live

/** safe number */
function toNum(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "bigint") return Number(x);
  const n = Number(x as any);
  return Number.isFinite(n) ? n : 0;
}

type CoinStat = { tokenKey: string; tokenDisplay: string; count: number };

async function getInitialRowsFromDB(days: number): Promise<
  (KolRow & {
    totalShills?: number;
    shillViews?: number;
    shillEngagements?: number;
    coinsTop?: CoinStat[];
    coinsTopAll?: CoinStat[];
  })[]
> {
  const until = new Date(); // now
  const since = new Date(Date.now() - days * 864e5);

  // 1) Base totals windowed
  const base = await db
    .select({
      twitterUsername: kols.twitterUsername,
      displayName: kols.displayName,
      profileImgUrl: kols.profileImgUrl,
      followers: kols.followers,

      totalTweets: sql<number>`COUNT(${kolTweets.tweetId})`,
      totalViews: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      totalEngs: sql<number>`
        COALESCE(SUM(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies}), 0)
      `,
    })
    .from(kols)
    .leftJoin(
      kolTweets,
      and(
        eq(kolTweets.twitterUid, kols.twitterUid),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    )
    .groupBy(
      kols.twitterUsername,
      kols.displayName,
      kols.profileImgUrl,
      kols.followers,
    )
    .orderBy(
      desc(sql`COALESCE(SUM(${kolTweets.views}), 0)`),
      desc(sql`COUNT(${kolTweets.tweetId})`),
    );

  // 2) Shill counts
  const shillCounts = await db
    .select({
      handle: kolTweets.twitterUsername,
      totalShills: sql<number>`COUNT(${tweetTokenMentions.id})`,
    })
    .from(kolTweets)
    .innerJoin(
      tweetTokenMentions,
      eq(tweetTokenMentions.tweetId, kolTweets.tweetId),
    )
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)))
    .groupBy(kolTweets.twitterUsername);

  // 3) Shill Views/Engs (tweets that have mentions)
  const shillVE = await db
    .select({
      handle: kolTweets.twitterUsername,
      shillViews: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      shillEngs: sql<number>`
        COALESCE(SUM(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies}), 0)
      `,
    })
    .from(kolTweets)
    .where(
      and(
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
        sql`EXISTS (SELECT 1 FROM tweet_token_mentions m WHERE m.tweet_id = ${kolTweets.tweetId})`,
      ),
    )
    .groupBy(kolTweets.twitterUsername);

  // 4) Coins TopN
  const coinsAgg = await db
    .select({
      handle: kolTweets.twitterUsername,
      tokenKey: tweetTokenMentions.tokenKey,
      tokenDisplay: tweetTokenMentions.tokenDisplay,
      c: sql<number>`COUNT(${tweetTokenMentions.id})`,
    })
    .from(kolTweets)
    .innerJoin(
      tweetTokenMentions,
      eq(tweetTokenMentions.tweetId, kolTweets.tweetId),
    )
    .where(and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until)))
    .groupBy(
      kolTweets.twitterUsername,
      tweetTokenMentions.tokenKey,
      tweetTokenMentions.tokenDisplay,
    );

  const shillCountBy = new Map(shillCounts.map((r) => [r.handle, toNum(r.totalShills)]));
  const shillVEBy = new Map(
    shillVE.map((r) => [r.handle, { v: toNum(r.shillViews), e: toNum(r.shillEngs) }]),
  );
  const coinsByAll = new Map<string, CoinStat[]>();  // full list per handle
  const coinsByTop = new Map<string, CoinStat[]>();  // top N per handle
  for (const row of coinsAgg) {
    const key = row.handle;
     const list = coinsByAll.get(key) ?? [];
    list.push({
      tokenKey: String(row.tokenKey),
      tokenDisplay: row.tokenDisplay ?? String(row.tokenKey).toUpperCase(),
      count: toNum(row.c),
    });
    coinsByAll.set(key, list);
  }
  for (const [k, list] of coinsByAll) {
    const sorted = [...list].sort((a, b) => b.count - a.count);
    coinsByTop.set(k, sorted.slice(0, 6)); // keep Top6 only for display
    coinsByAll.set(k, sorted);             // keep full sorted list for filtering6
  }

  return base.map((r) => ({
    twitterUsername: r.twitterUsername,
    displayName: r.displayName ?? undefined,
    profileImgUrl: r.profileImgUrl ?? undefined,
    followers: r.followers ?? 0,

    totalTweets: toNum(r.totalTweets),
    totalViews: toNum(r.totalViews),
    totalEngs: toNum(r.totalEngs),

    totalShills: shillCountBy.get(r.twitterUsername) ?? 0,
    shillViews: shillVEBy.get(r.twitterUsername)?.v ?? 0,
    shillEngagements: shillVEBy.get(r.twitterUsername)?.e ?? 0,

    coinsTop: coinsByTop.get(r.twitterUsername) ?? [],
    coinsTopAll: coinsByAll.get(r.twitterUsername) ?? [],
  })) as any;
}

type SearchParams = { days?: string };

export default async function Page(props: { searchParams: Promise<SearchParams> }) {
  // Next.js 15+: searchParams is a Promise in RSC
  const sp = await props.searchParams;
  const days = Math.max(1, Math.min(30, Number(sp?.days ?? "7") || 7));
  const initialRows = await getInitialRowsFromDB(days);
  return <KolsLeaderboardClient initialRows={initialRows} />;
}
