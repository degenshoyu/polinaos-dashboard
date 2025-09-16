// app/api/kols/aggregate-shills/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const Q = z.object({
  screen_name: z.string().min(1),
  days: z.coerce.number().int().min(1).max(30).optional().default(7),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (!isAdmin)
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );

  const url = new URL(req.url);
  const { screen_name, days } = Q.parse({
    screen_name: url.searchParams.get("screen_name"),
    days: url.searchParams.get("days") ?? "7",
  });
  const handle = screen_name.trim().replace(/^@+/, "").toLowerCase();

  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  const totals = await db
    .select({
      totalShills: sql<number>`COUNT(DISTINCT ${kolTweets.tweetId})`,
      shillsViews: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      shillsEngs: sql<number>`COALESCE(SUM(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies}), 0)`,
    })
    .from(kolTweets)
    .innerJoin(
      tweetTokenMentions,
      eq(kolTweets.tweetId, tweetTokenMentions.tweetId),
    )
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    );

  const coins = await db
    .select({
      tokenKey: tweetTokenMentions.tokenKey,
      tokenDisplay: tweetTokenMentions.tokenDisplay,
      count: sql<number>`COUNT(*)`,
    })
    .from(tweetTokenMentions)
    .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    )
    .groupBy(tweetTokenMentions.tokenKey, tweetTokenMentions.tokenDisplay)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(50);

  return NextResponse.json({
    ok: true,
    handle,
    days,
    totals: totals?.[0] ?? { totalShills: 0, shillsViews: 0, shillsEngs: 0 },
    coins,
  });
}
