import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  listTopPoolsByToken,
  priceAtTsWithFallbacks,
} from "@/lib/pricing/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweetId: z.string().trim().min(1),
  tokenKey: z.string().trim().min(1), // CA
  network: z.string().trim().default("solana"),
  tryPools: z.number().int().min(1).max(8).default(3),
  graceSeconds: z.number().int().min(0).max(600).default(90),
  debug: z.boolean().default(false),
});

function looksLikeSolMint(s: string): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44;
}

export async function POST(req: Request) {
  const debugLog: any[] = [];
  try {
    const { tweetId, tokenKey, network, tryPools, graceSeconds, debug } =
      Body.parse(await req.json().catch(() => ({})));

    if (!looksLikeSolMint(tokenKey)) {
      return NextResponse.json(
        { ok: false, error: "tokenKey does not look like a Solana mint" },
        { status: 400 },
      );
    }

    const tid = String(tweetId);

    // 1) fetch tweet publish date (cast tweet_id to text to be robust against bigint/text)
    let row;
    try {
      row = await db
        .select({ publish: kolTweets.publishDate })
        .from(kolTweets)
        .where(sql`${kolTweets.tweetId}::text = ${tid}`)
        .limit(1);
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: `DB error(select tweet): ${e?.message ?? "unknown"}`,
        },
        { status: 500 },
      );
    }

    if (!row?.length) {
      return NextResponse.json(
        { ok: false, error: "tweet not found" },
        { status: 404 },
      );
    }

    const publish = row[0].publish;
    const tweetSec = Math.floor(new Date(publish).getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - tweetSec < graceSeconds) {
      return NextResponse.json({
        ok: true,
        updated: 0,
        reason: "too-fresh",
        wait: graceSeconds,
      });
    }

    // 2) resolve pools from GeckoTerminal (make sure you已修正为 attributes.address)
    let pools: { address: string; dexId?: string }[] = [];
    try {
      pools = await listTopPoolsByToken(network, tokenKey, tryPools);
      if (debug) debugLog.push({ note: "gt-top-pools", pools });
    } catch (e: any) {
      if (debug)
        debugLog.push({ note: "gt-top-pools-failed", err: e?.message });
    }

    if (!pools.length) {
      return NextResponse.json({
        ok: true,
        updated: 0,
        reason: "no-pool-on-gt",
      });
    }

    // 3) try OHLCV with fallbacks (make sure你已改为取 arr.at(-1))
    let price: number | null = null;
    let hitPool: string | null = null;

    for (const p of pools) {
      try {
        const v = await priceAtTsWithFallbacks(network, p.address, tweetSec);
        if (Number.isFinite(v)) {
          price = v!;
          hitPool = p.address;
          break;
        }
      } catch (e: any) {
        if (debug)
          debugLog.push({
            pool: p.address,
            note: "ohlcv-error",
            err: e?.message,
          });
      }
    }

    if (price == null) {
      return NextResponse.json({
        ok: true,
        updated: 0,
        reason: "no-price",
      });
    }

    // 4) write price for mentions in this tweet+CA where price_usd_at IS NULL
    let updatedRows: { id: any }[] = [];
    try {
      updatedRows = await db
        .update(tweetTokenMentions)
        .set({ priceUsdAt: String(price.toFixed(8)) })
        .where(
          and(
            sql`${tweetTokenMentions.tweetId}::text = ${tid}`,
            sql`lower(${tweetTokenMentions.tokenKey}) = lower(${tokenKey})`,
            isNull(tweetTokenMentions.priceUsdAt),
          ),
        )
        .returning({ id: tweetTokenMentions.id });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: `DB error(update mentions): ${e?.message ?? "unknown"}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      updated: updatedRows.length,
      price,
      poolAddress: hitPool,
      debug: debug ? debugLog : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Error" },
      { status: 500 },
    );
  }
}
