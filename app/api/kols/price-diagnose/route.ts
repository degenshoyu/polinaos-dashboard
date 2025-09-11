import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import {
  listTopPoolsByToken,
  fetchOHLCVMinute,
  fetchOHLCVDay,
  priceAtTsWithFallbacks,
  type Ohlcv,
} from "@/lib/pricing/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweetId: z.string().trim().min(1),
  tokenKey: z.string().trim().min(1),
  network: z.string().trim().default("solana"),
  tryPools: z.number().int().min(1).max(10).default(5),
  graceSeconds: z.number().int().min(0).max(600).default(0), // 调试默认 0
});

function tsToIso(tsSec: number | null | undefined) {
  if (!Number.isFinite(tsSec as number)) return null;
  return new Date(Number(tsSec) * 1000).toISOString();
}
function candleInfo(c?: Ohlcv | undefined) {
  if (!c) return null;
  return {
    ts: c[0],
    tsIso: tsToIso(Number(c[0])),
    o: c[1],
    h: c[2],
    l: c[3],
    c: c[4],
    v: c[5] ?? null,
  };
}

export async function POST(req: Request) {
  try {
    const { tweetId, tokenKey, network, tryPools, graceSeconds } = Body.parse(
      await req.json().catch(() => ({})),
    );

    // 1) tweet publish time
    const tid = String(tweetId);
    const rows = await db
      .select({ publish: kolTweets.publishDate })
      .from(kolTweets)
      .where(sql`${kolTweets.tweetId}::text = ${tid}`)
      .limit(1);

    if (!rows?.length) {
      return NextResponse.json(
        { ok: false, error: "tweet not found" },
        { status: 404 },
      );
    }

    const publish = rows[0].publish;
    const tweetSec = Math.floor(new Date(publish).getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const fresh = nowSec - tweetSec < graceSeconds;

    // 2) top pools (address-based)
    const pools = await listTopPoolsByToken(network, tokenKey, tryPools);

    // 3) for each pool, probe OHLCV
    const details: any[] = [];
    for (const p of pools) {
      const minute1 = await fetchOHLCVMinute(
        network,
        p.address,
        tweetSec,
        1,
      ).catch(() => []);
      const minute60 = await fetchOHLCVMinute(
        network,
        p.address,
        tweetSec,
        60,
      ).catch(() => []);
      const day2 = await fetchOHLCVDay(network, p.address, tweetSec, 2).catch(
        () => [],
      );

      // 额外：我们最终算法得到的价格
      const picked = await priceAtTsWithFallbacks(network, p.address, tweetSec);

      details.push({
        poolAddress: p.address,
        dexId: p.dexId ?? null,
        minute1: {
          count: minute1.length,
          first: candleInfo(minute1[0]),
          last: candleInfo(minute1.at(-1)),
        },
        minute60: {
          count: minute60.length,
          first: candleInfo(minute60[0]),
          last: candleInfo(minute60.at(-1)),
          // 给你看一下 <=tweetSec 的最近一根（如果有）
          nearestLE: (() => {
            if (!minute60.length) return null;
            const asc =
              minute60[0][0] <= minute60.at(-1)![0]
                ? minute60
                : [...minute60].reverse();
            for (let i = asc.length - 1; i >= 0; i--) {
              const c = asc[i];
              if (Number(c?.[0]) <= tweetSec) return candleInfo(c);
            }
            return null;
          })(),
        },
        day2: {
          count: day2.length,
          first: candleInfo(day2[0]),
          last: candleInfo(day2.at(-1)),
        },
        pickedPrice: Number.isFinite(picked as number) ? picked : null,
      });
    }

    return NextResponse.json({
      ok: true,
      tweet: {
        tweetId,
        publishedAt: new Date(publish).toISOString(),
        tweetSec,
        tooFresh: fresh,
        graceSeconds,
      },
      tokenKey,
      network,
      poolsCount: pools.length,
      pools: pools.map((p) => ({ address: p.address, dexId: p.dexId })),
      details,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Error" },
      { status: 500 },
    );
  }
}
