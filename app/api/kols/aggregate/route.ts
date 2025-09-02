// app/api/kols/aggregate/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets } from "@/lib/db/schema";
import { eq, sql, and, gte, lt } from "drizzle-orm";

const Q = z.object({
  screen_name: z.string().min(1),
  days: z.coerce.number().int().min(1).max(30).optional().default(7),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (!isAdmin) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

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

  const agg = await db
    .select({
      totalTweets: sql<number>`COUNT(*)`,
      totalViews: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      totalEngs: sql<number>`
        COALESCE(SUM(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies}), 0)
      `,
    })
    .from(kolTweets)
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    );

  return NextResponse.json({
    ok: true,
    handle,
    days,
    totals: agg?.[0] ?? { totalTweets: 0, totalViews: 0, totalEngs: 0 },
  });
}
