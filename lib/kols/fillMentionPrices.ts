// lib/kols/fillMentionPrices.ts
/* Core price backfill used by both batch + per-tweet routes.
   It tries GeckoTerminal pools in order and writes priceUsdAt for NULL rows.
   All comments in English to match your repo convention. */

import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  listTopPoolsByToken,
  priceAtTsWithFallbacks,
} from "@/lib/pricing/geckoterminal";

export type FillPriceParams = {
  tweetId: string; // bigint as string safe
  tokenKey: string; // CA/mint
  network?: string; // "solana" by default
  tryPools?: number; // default 3
  graceSeconds?: number; // default 90
  debug?: boolean;
};

export type FillPriceResult = {
  ok: boolean;
  updated: number;
  price?: number | null;
  poolAddress?: string | null;
  reason?: string;
  debug?: any[];
};

function looksLikeSolMint(s: string): boolean {
  return typeof s === "string" && s.length >= 32 && s.length <= 44;
}

export async function fillMentionPricesForTweet(
  params: FillPriceParams,
): Promise<FillPriceResult> {
  const {
    tweetId,
    tokenKey,
    network = "solana",
    tryPools = 3,
    graceSeconds = 90,
    debug = false,
  } = params;

  const debugLog: any[] = [];
  if (!looksLikeSolMint(tokenKey)) {
    return { ok: false, updated: 0, reason: "bad-mint" };
  }

  const tid = String(tweetId);

  // 1) fetch tweet publish date robustly
  let row;
  try {
    row = await db
      .select({ publish: kolTweets.publishDate })
      .from(kolTweets)
      .where(sql`${kolTweets.tweetId}::text = ${tid}`)
      .limit(1);
  } catch (e: any) {
    return {
      ok: false,
      updated: 0,
      reason: `db-select:${e?.message ?? "err"}`,
    };
  }
  if (!row?.length) return { ok: false, updated: 0, reason: "tweet-not-found" };

  const publish = row[0].publish;
  const tweetSec = Math.floor(new Date(publish).getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - tweetSec < Math.max(0, graceSeconds)) {
    return { ok: true, updated: 0, reason: "too-fresh" };
  }

  // 2) resolve top pools
  let pools: { address: string; dexId?: string }[] = [];
  try {
    pools = await listTopPoolsByToken(network, tokenKey, tryPools);
    if (debug) debugLog.push({ note: "gt-top-pools", pools });
  } catch (e: any) {
    if (debug) debugLog.push({ note: "gt-top-pools-failed", err: e?.message });
  }
  if (!pools.length) return { ok: true, updated: 0, reason: "no-pools" };

  // 3) pick price via OHLCV fallbacks
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
  if (price == null) return { ok: true, updated: 0, reason: "no-price" };

  // 4) write price for mentions (tweet+CA) with NULL price_usd_at
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
    return {
      ok: false,
      updated: 0,
      reason: `db-update:${e?.message ?? "err"}`,
    };
  }

  return {
    ok: true,
    updated: updatedRows.length,
    price,
    poolAddress: hitPool,
    debug: debug ? debugLog : undefined,
  };
}
