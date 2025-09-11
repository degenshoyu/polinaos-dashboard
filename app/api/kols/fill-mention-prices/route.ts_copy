// app/api/kols/fill-mention-prices/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  listTopPoolsByToken,
  priceAtTsWithFallbacks,
} from "@/lib/pricing/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  screen_name: z.string().trim().optional(),
  days: z.number().int().positive().default(7),
  limit: z.number().int().min(1).max(300).default(100),
  onlyCA: z.boolean().default(true),
  network: z.string().trim().default("solana"), // GeckoTerminal network key
  debug: z.boolean().default(false),
  tryPools: z.number().int().min(1).max(5).default(3),
  // 给 GT 少许索引缓冲，避免刚发推时还未建立蜡烛/池信息
  graceSeconds: z.number().int().min(0).max(600).default(90),
});

function looksLikeSolMint(s: string): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44;
}

export async function POST(req: Request) {
  const debugLog: any[] = [];
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const now = new Date();
    const since = new Date(now.getTime() - body.days * 24 * 60 * 60 * 1000);

    // 1) get tweets in window
    const tweets = await db
      .select({ id: kolTweets.tweetId, publishedAt: kolTweets.publishDate })
      .from(kolTweets)
      .where(
        and(
          body.screen_name
            ? eq(kolTweets.twitterUsername, body.screen_name.replace(/^@/, ""))
            : sql`true`,
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, now),
        ),
      );

    if (!tweets.length) {
      return NextResponse.json({
        ok: true,
        updated: 0,
        scanned: 0,
        reason: "no tweets in window",
      });
    }

    const timeById = new Map(tweets.map((t) => [t.id, t.publishedAt]));
    const tweetIds = tweets.map((t) => t.id);

    // 2) mentions missing price
    const mentions = await db
      .select({
        id: tweetTokenMentions.id,
        tweetId: tweetTokenMentions.tweetId,
        tokenKey: tweetTokenMentions.tokenKey,
        source: tweetTokenMentions.source,
      })
      .from(tweetTokenMentions)
      .where(
        and(
          inArray(tweetTokenMentions.tweetId, tweetIds),
          isNull(tweetTokenMentions.priceUsdAt),
          body.onlyCA ? eq(tweetTokenMentions.source, "ca") : sql`true`,
        ),
      )
      .limit(body.limit);

    if (!mentions.length) {
      return NextResponse.json({
        ok: true,
        updated: 0,
        scanned: 0,
        reason: "no empty prices",
      });
    }

    let updated = 0;

    // 3) fill prices
    for (const m of mentions) {
      const publishedAt = timeById.get(m.tweetId);
      if (!publishedAt) {
        if (body.debug) debugLog.push({ id: m.id, why: "no-publish-date" });
        continue;
      }
      if (body.onlyCA && !looksLikeSolMint(m.tokenKey)) {
        if (body.debug)
          debugLog.push({
            id: m.id,
            why: "not-solana-mint",
            tokenKey: m.tokenKey,
          });
        continue;
      }

      // 小宽限：避免“刚发推、GT 还没出蜡烛/池”
      const tweetSec = Math.floor(new Date(publishedAt).getTime() / 1000);
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - tweetSec < body.graceSeconds) {
        if (body.debug)
          debugLog.push({
            id: m.id,
            why: "too-fresh",
            wait: body.graceSeconds,
          });
        continue;
      }

      let price: number | null = null;
      let hitPool: string | null = null;

      // Resolve top N pools via GeckoTerminal, then try OHLCV
      let pools: { address: string; dexId?: string }[] = [];
      try {
        const tops = await listTopPoolsByToken(
          body.network,
          m.tokenKey,
          body.tryPools,
        );
        pools = tops;
        if (body.debug)
          debugLog.push({ id: m.id, note: "gt-top-pools", pools: tops });
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.includes("HTTP 404")) {
          // GT 尚未收录该 mint
          if (body.debug)
            debugLog.push({ id: m.id, why: "gt-404-unindexed" });
        } else {
          if (body.debug)
            debugLog.push({
              id: m.id,
              why: "gt-top-pools-failed",
              err: e?.message,
            });
        }
      }

      // 无池直接跳过（GT-only 策略）
      if (pools.length === 0) {
        if (body.debug) debugLog.push({ id: m.id, why: "no-pool-on-gt" });
        continue;
      }

      for (const p of pools) {
        try {
          const v = await priceAtTsWithFallbacks(
            body.network,
            p.address,
            tweetSec,
          );
          if (Number.isFinite(v)) {
            price = v!;
            hitPool = p.address;
            break;
          }
        } catch (e: any) {
          if (body.debug)
            debugLog.push({
              id: m.id,
              pool: p.address,
              why: "ohlcv-error",
              err: e?.message,
            });
        }
      }

      if (price == null) {
        if (body.debug)
          debugLog.push({
            id: m.id,
            why: "no-price",
            tried: pools.map((p) => p.address),
          });
        continue;
      }

      // 4) write numeric(18,8) as string to preserve precision
      await db
        .update(tweetTokenMentions)
        .set({ priceUsdAt: String(price.toFixed(8)) })
        .where(eq(tweetTokenMentions.id, m.id));

      updated += 1;
      if (body.debug)
        debugLog.push({
          id: m.id,
          ok: true,
          poolAddress: hitPool,
          ts: tweetSec,
          price,
        });

      // small delay to be nice to GT public rate limit (optional)
      // await new Promise((r) => setTimeout(r, 60));
    }

    // 简单汇总：按 why 聚合
    const summary = debugLog.reduce((acc: Record<string, number>, x: any) => {
      if (x.why) acc[x.why] = (acc[x.why] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      ok: true,
      updated,
      scanned: mentions.length,
      summary,
      debug: body.debug ? debugLog : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Error", debug: debugLog },
      { status: 500 },
    );
  }
}

