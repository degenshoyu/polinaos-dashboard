// components/admin/coins/types.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, kols } from "@/lib/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  sort: z
    .enum([
      "ticker",
      "ca",
      "tweets",
      "views",
      "engs",
      "er",
      "kols",
      "followers",
    ])
    .default("views"),
  order: z.enum(["asc", "desc"]).default("desc"),
  q: z.string().max(64).optional(),
});

type SourceKey = "ca" | "ticker" | "phrase" | "hashtag" | "upper" | "llm";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = Q.parse({
      from: url.searchParams.get("from") ?? new Date(0).toISOString(),
      to: url.searchParams.get("to") ?? new Date().toISOString(),
      page: url.searchParams.get("page") ?? "1",
      pageSize: url.searchParams.get("pageSize") ?? "20",
      sort: url.searchParams.get("sort") ?? "views",
      order: url.searchParams.get("order") ?? "desc",
      q: url.searchParams.get("q") ?? undefined,
    });

    const timeFilter = and(
      gte(kolTweets.publishDate, new Date(q.from)),
      lte(kolTweets.publishDate, new Date(q.to)),
    );

    // Detail rows within time window
    const rows = await db
      .select({
        tweetId: kolTweets.tweetId,
        username: kolTweets.twitterUsername,
        followers: kols.followers,
        views: kolTweets.views,
        engs: sql<number>`(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies})::int`,
        tokenKey: tweetTokenMentions.tokenKey, // CA (original case)
        tokenDisplay: tweetTokenMentions.tokenDisplay, // Ticker (can be null)
        source: tweetTokenMentions.source,
        priceUsdAt: tweetTokenMentions.priceUsdAt, // string | null
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(tweetTokenMentions.tweetId, kolTweets.tweetId))
      .leftJoin(kols, eq(kolTweets.twitterUid, kols.twitterUid))
      .where(timeFilter);

    // Bucket by CA
    type Bucket = {
      ca: string;
      tickerCounts: Map<string, number>;
      ticker?: string | null;
      totalTweets: number;
      totalViews: number;
      totalEngs: number;
      totalKols: number;
      totalFollowers: number;
      topKols: Map<string, { count: number; followers?: number | null }>;
      sources: Record<SourceKey, number>;
      kolSeen: Set<string>;
      tweetSeen: Set<string>;
      // --- pricing stats per tweet for this CA ---
      pricedTweets: Set<string>; // tweets that have at least one priced mention for this CA
      nullPriceTweets: Set<string>; // tweets currently with no priced mention for this CA
    };

    const buckets = new Map<string, Bucket>();
    const sourcesInit: Record<SourceKey, number> = {
      ca: 0,
      ticker: 0,
      phrase: 0,
      hashtag: 0,
      upper: 0,
      llm: 0,
    };

    for (const r of rows) {
      const caRaw = (r.tokenKey ?? "").trim();
      if (!caRaw) continue; // only group when CA exists
      const ca = caRaw; // keep original case for URL/link correctness
      const ticker =
        (r.tokenDisplay ?? "").replace(/^\$/, "").trim().toUpperCase() || null;
      const src = (r.source ?? "ticker") as SourceKey;
      const tweetId = String(r.tweetId);

      let b = buckets.get(ca);
      if (!b) {
        b = {
          ca,
          tickerCounts: new Map(),
          ticker: null,
          totalTweets: 0,
          totalViews: 0,
          totalEngs: 0,
          totalKols: 0,
          totalFollowers: 0,
          topKols: new Map(),
          sources: { ...sourcesInit },
          kolSeen: new Set(),
          tweetSeen: new Set(),
          pricedTweets: new Set(),
          nullPriceTweets: new Set(),
        };
        buckets.set(ca, b);
      }

      // count sources distribution
      b.sources[src] = (b.sources[src] ?? 0) + 1;

      // count ticker candidates
      if (ticker)
        b.tickerCounts.set(ticker, (b.tickerCounts.get(ticker) ?? 0) + 1);

      // tweet-level aggregates (unique)
      if (!b.tweetSeen.has(tweetId)) {
        b.tweetSeen.add(tweetId);
        b.totalTweets += 1;
        b.totalViews += Number(r.views ?? 0);
        b.totalEngs += Number(r.engs ?? 0);
      }

      // kol-level (unique)
      if (r.username && !b.kolSeen.has(r.username)) {
        b.kolSeen.add(r.username);
        b.totalKols += 1;
        b.totalFollowers += Number(r.followers ?? 0);
      }

      // top KOLs by mention count for this CA
      if (r.username) {
        const cur = b.topKols.get(r.username) ?? {
          count: 0,
          followers: r.followers ?? null,
        };
        cur.count += 1;
        b.topKols.set(r.username, cur);
      }

      // --- price coverage per tweet ---
      // If we see a priced mention for this tweet+CA, ensure it's marked priced and removed from "null".
      if (r.priceUsdAt != null) {
        b.pricedTweets.add(tweetId);
        b.nullPriceTweets.delete(tweetId);
      } else {
        // Only add to null if we haven't already confirmed a priced mention for this tweet+CA
        if (!b.pricedTweets.has(tweetId)) {
          b.nullPriceTweets.add(tweetId);
        }
      }
    }

    // Build output items
    let items = Array.from(buckets.values()).map((b) => {
      const topTicker =
        Array.from(b.tickerCounts.entries()).sort(
          (a, c) => c[1] - a[1],
        )[0]?.[0] ?? null;

      const er = b.totalViews > 0 ? b.totalEngs / b.totalViews : 0;
      const topKols = Array.from(b.topKols.entries())
        .sort((a, c) => c[1].count - a[1].count)
        .slice(0, 3)
        .map(([username, v]) => ({
          username,
          count: v.count,
          followers: v.followers,
        }));

      const totalSources =
        (b.sources.ca ?? 0) +
        (b.sources.ticker ?? 0) +
        (b.sources.phrase ?? 0) +
        (b.sources.hashtag ?? 0) +
        (b.sources.upper ?? 0) +
        (b.sources.llm ?? 0);

      return {
        ticker: topTicker,
        ca: b.ca,
        totalTweets: b.totalTweets,
        noPriceTweets: b.nullPriceTweets.size, // 👈 NEW: tweets lacking price for this CA
        totalViews: b.totalViews,
        totalEngagements: b.totalEngs,
        er,
        totalKols: b.totalKols,
        totalFollowers: b.totalFollowers,
        topKols,
        sources: { ...b.sources, total: totalSources },
        gmgn: `https://gmgn.ai/sol/token/${b.ca}`,
      };
    });

    // Search (q) — match ca or ticker (case-insensitive)
    if (q.q && q.q.trim()) {
      const needle = q.q.trim().toLowerCase();
      items = items.filter(
        (it) =>
          (it.ca ?? "").toLowerCase().includes(needle) ||
          (it.ticker ?? "").toLowerCase().includes(needle),
      );
    }

    // Sorting
    const keyForSort = (it: any) => {
      switch (q.sort) {
        case "ticker":
          return it.ticker ?? "";
        case "ca":
          return it.ca ?? "";
        case "tweets":
          return it.totalTweets;
        case "views":
          return it.totalViews;
        case "engs":
          return it.totalEngagements;
        case "er":
          return it.er;
        case "kols":
          return it.totalKols;
        case "followers":
          return it.totalFollowers;
      }
    };
    const cmp = (a: any, b: any) => {
      const da = keyForSort(a);
      const db = keyForSort(b);
      if (typeof da === "number" && typeof db === "number") {
        return da - db;
      }
      return String(da).localeCompare(String(db), undefined, {
        sensitivity: "base",
      });
    };
    items.sort((a, b) => (q.order === "asc" ? cmp(a, b) : -cmp(a, b)));

    // Pagination
    const total = items.length;
    const start = (q.page - 1) * q.pageSize;
    const end = start + q.pageSize;

    return NextResponse.json({
      ok: true,
      items: items.slice(start, end),
      total,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
