// app/api/kols/coins/tweets/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    ticker: z.string().optional(),
    ca: z.string().optional(),
    source: z.enum(["ca", "ticker", "phrase"]).optional(),
  })
  .refine((v) => !!v.ticker || !!v.ca, { message: "ticker or ca required" });

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = Q.parse({
      from: url.searchParams.get("from") ?? new Date(0).toISOString(),
      to: url.searchParams.get("to") ?? new Date().toISOString(),
      page: url.searchParams.get("page") ?? "1",
      pageSize: url.searchParams.get("pageSize") ?? "50",
      ticker: url.searchParams.get("ticker") ?? undefined,
      ca: url.searchParams.get("ca") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
    });

    const timeFilter = and(
      gte(kolTweets.publishDate, new Date(q.from)),
      lte(kolTweets.publishDate, new Date(q.to)),
    );

    const filters = [timeFilter] as any[];

    if (q.ca) {
      filters.push(eq(tweetTokenMentions.tokenKey, q.ca.trim()));
    } else if (q.ticker) {
      const norm = q.ticker.replace(/^\$/, "").trim().toUpperCase();
      filters.push(
        sql`upper(trim(both ' $' from ${tweetTokenMentions.tokenDisplay})) = ${norm}`,
      );
    }
    if (q.source) {
      filters.push(eq(tweetTokenMentions.source, q.source));
    }

    // Count (distinct tweets)
    const totalRows = await db
      .select({
        c: sql<number>`count(distinct ${kolTweets.tweetId})`,
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(tweetTokenMentions.tweetId, kolTweets.tweetId))
      .where(and(...filters));

    const total = Number(totalRows?.[0]?.c ?? 0);
    const offset = (q.page - 1) * q.pageSize;

    // Items + aggregated price for this scope
    const items = await db
      .select({
        tweetId: kolTweets.tweetId,
        username: kolTweets.twitterUsername,
        views: kolTweets.views,
        engs: sql<number>`(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies})::int`,
        publish: kolTweets.publishDate,
        // Aggregate price for any mention of this scope within the tweet
        priceUsdAt: sql<
          string | null
        >`max((${tweetTokenMentions.priceUsdAt})::numeric)`,
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(tweetTokenMentions.tweetId, kolTweets.tweetId))
      .where(and(...filters))
      .groupBy(
        kolTweets.tweetId,
        kolTweets.twitterUsername,
        kolTweets.views,
        kolTweets.likes,
        kolTweets.retweets,
        kolTweets.replies,
        kolTweets.publishDate,
      )
      .orderBy(sql`${kolTweets.publishDate} desc`)
      .limit(q.pageSize)
      .offset(offset);

    // Top KOLs for this scope
    const topKols = await db
      .select({
        username: kolTweets.twitterUsername,
        cnt: sql<number>`count(distinct ${kolTweets.tweetId})`,
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(tweetTokenMentions.tweetId, kolTweets.tweetId))
      .where(and(...filters))
      .groupBy(kolTweets.twitterUsername)
      .orderBy(sql`count(distinct ${kolTweets.tweetId}) desc`)
      .limit(20);

    return NextResponse.json({
      ok: true,
      total,
      items: items.map((x) => ({
        tweetId: x.tweetId,
        username: x.username,
        views: Number(x.views ?? 0),
        engagements: Number(x.engs ?? 0),
        publish: x.publish,
        priceUsdAt: x.priceUsdAt, // string | null
      })),
      topKols: topKols.map((x) => ({
        username: x.username,
        count: Number(x.cnt || 0),
      })),
      scope: { ticker: q.ticker ?? null, ca: q.ca ?? null },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
