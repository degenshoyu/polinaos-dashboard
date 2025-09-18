// app/api/kols/coin-roi/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  kolTweets,
  tweetTokenMentions,
  coinPrice,
  coinCaTicker,
} from "@/lib/db/schema";
import { and, desc, eq, gte, lt, lte, inArray, sql } from "drizzle-orm";
import { getLatestPrices } from "@/lib/db/prices";

/** -------- Query schema -------- */
const Query = z.object({
  handle: z.string().min(1), // twitter_username
  days: z.coerce.number().int().min(1).max(30).default(7),
  mode: z.enum(["earliest", "latest", "lowest", "highest"]).default("earliest"),
  limitPerKol: z.coerce.number().int().min(1).max(64).default(4),
});

/** -------- Helpers -------- */
/** EVM address: 0x + 40 hex chars (case-insensitive) */
function looksLikeEvm(addr: string) {
  return /^0x[a-f0-9]{40}$/i.test(addr);
}
/** Base58 (Solana mint etc.). Keep BOTH cases; DO NOT lowercase. */
function looksLikeBase58(s: string) {
  // 32~64 chars, excludes 0 O I l (base58 alphabet)
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(s);
}

/**
 * Normalize key for GROUPING purpose only:
 * - EVM -> lowercase (case-insensitive)
 * - Base58 (Solana) -> KEEP ORIGINAL CASING (case-sensitive)
 * - Ticker/others -> uppercase (easier de-dup)
 *
 * Important: This function is ONLY for "normKey" used as map key.
 * We never send "normKey" back to the client if a CA exists in the group.
 */
function toNormKey(raw: string) {
  if (looksLikeEvm(raw)) return raw.toLowerCase();
  if (looksLikeBase58(raw)) return raw; // keep original casing
  return raw.toUpperCase(); // ticker/tag etc.
}

/**
 * Resolve canonical casing for a CA:
 * - EVM: lowercase
 * - Solana: try to find "original casing" that already exists in DB
 *   (coin_ca_ticker or coin_price). If not found, return raw.
 */
async function resolveCanonicalCase(raw: string): Promise<string> {
  if (looksLikeEvm(raw)) return raw.toLowerCase();

  if (looksLikeBase58(raw)) {
    // Try mapping table first
    const t = await db
      .select({ ca: coinCaTicker.contractAddress })
      .from(coinCaTicker)
      .where(sql`lower(${coinCaTicker.contractAddress}) = lower(${raw})`)
      .limit(1);
    if (t[0]?.ca) return String(t[0].ca);

    // Then try price snapshots (latest one wins)
    const p = await db
      .select({ ca: coinPrice.contractAddress })
      .from(coinPrice)
      .where(sql`lower(${coinPrice.contractAddress}) = lower(${raw})`)
      .orderBy(desc(coinPrice.priceAt))
      .limit(1);
    if (p[0]?.ca) return String(p[0].ca);
  }

  // Fallback: keep the raw casing
  return raw;
}

export async function GET(req: NextRequest) {
  const to6 = (v: number | null | undefined) =>
    v == null ? null : Number(Number(v).toFixed(6));

  try {
    const { searchParams } = new URL(req.url);
    const parse = Query.parse({
      handle: searchParams.get("handle"),
      days: searchParams.get("days"),
      mode: (searchParams.get("mode") || "earliest").toLowerCase(),
      limitPerKol: searchParams.get("limitPerKol"),
    });
    const debug = (searchParams.get("debug") || "") === "1";
    parse.limitPerKol = Math.min(parse.limitPerKol, 64);

    const until = new Date(); // now
    const since = new Date(Date.now() - parse.days * 864e5);

    // Pull raw mentions for this KOL
    const rows = await db
      .select({
        tokenKey: tweetTokenMentions.tokenKey, // raw key (CA or ticker)
        tokenDisplay: tweetTokenMentions.tokenDisplay, // ticker text (nullable)
        priceUsdAt: tweetTokenMentions.priceUsdAt, // string | null
        createdAt: kolTweets.publishDate,
      })
      .from(kolTweets)
      .innerJoin(
        tweetTokenMentions,
        eq(tweetTokenMentions.tweetId, kolTweets.tweetId),
      )
      .where(
        and(
          eq(kolTweets.twitterUsername, parse.handle),
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, until),
          eq(kolTweets.excluded, false),
          eq(tweetTokenMentions.excluded, false),
        ),
      );

    type M = {
      priceUsdAt: string | null;
      createdAt: Date;
      tokenDisplay: string | null;
      rawKey: string;
    };

    /** Group raw mentions by a "normKey"
     *  - EVM -> lower
     *  - Solana/Base58 -> KEEP original casing
     *  - ticker/others -> upper
     */
    const byNormKey = new Map<string, M[]>();
    for (const r of rows) {
      const raw = (r.tokenKey || "").trim();
      if (!raw) continue;
      const norm = toNormKey(raw);
      const list = byNormKey.get(norm) ?? [];
      list.push({
        priceUsdAt: r.priceUsdAt,
        createdAt: r.createdAt as Date,
        tokenDisplay: r.tokenDisplay,
        rawKey: raw,
      });
      byNormKey.set(norm, list);
    }

    // Map normKey -> canonical CA (if this group corresponds to a CA)
    const needTicker: string[] = [];
    const caByNormKey = new Map<string, string>();

    for (const normKey of byNormKey.keys()) {
      // Decide if this group looks like a CA (EVM or Base58)
      if (looksLikeEvm(normKey) || looksLikeBase58(normKey)) {
        // Use the ORIGINAL raw casing from data, then resolve canonical from DB
        const rawCase = byNormKey.get(normKey)?.[0]?.rawKey || normKey;
        const canon = await resolveCanonicalCase(rawCase);
        caByNormKey.set(normKey, canon); // store canonical CA
      } else {
        // Likely a ticker; collect for mapping lookup
        needTicker.push(normKey.toUpperCase());
      }
    }

    // Resolve tickers -> CA using coin_ca_ticker (priority desc, updatedAt desc)
    if (needTicker.length) {
      const tickRows = await db
        .select({
          tokenTicker: coinCaTicker.tokenTicker,
          contractAddress: coinCaTicker.contractAddress,
          priority: coinCaTicker.priority,
          updatedAt: coinCaTicker.updatedAt,
        })
        .from(coinCaTicker)
        .where(inArray(coinCaTicker.tokenTicker, needTicker))
        .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt));

      const bestByTicker = new Map<string, string>(); // TICKER -> CA
      for (const r of tickRows) {
        const t = (r.tokenTicker || "").toUpperCase();
        if (!t) continue;
        if (!bestByTicker.has(t)) {
          bestByTicker.set(t, String(r.contractAddress));
        }
      }

      // Fill missing normKey -> CA via ticker
      for (const key of byNormKey.keys()) {
        if (caByNormKey.has(key)) continue;
        const ca = bestByTicker.get(key.toUpperCase());
        if (ca) caByNormKey.set(key, ca);
      }
    }

    /** Build groups:
     *  - If this normKey resolves to a CA, we create a "CA group" with groupKey = "<CA>::<displayLower>"
     *  - Otherwise a "raw group" with groupKey = "raw::<normKey>::<displayLower>"
     *  Later we will strictly use "<CA>" as tokenKey for CA groups (NEVER fallback to normKey).
     */
    type Group = {
      keyForPrice: string | null; // canonical CA to query price with, or null for raw/ticker groups
      tokenDisplay: string; // display text (ticker or best display)
      list: M[];
    };
    const groups = new Map<string, Group>(); // groupKey -> group

    for (const [normKey, list] of byNormKey) {
      const ca = caByNormKey.get(normKey) || null;
      const display = (list[0]?.tokenDisplay || normKey).trim();
      const groupKey = ca
        ? `${ca}::${display.toLowerCase()}`
        : `raw::${normKey}::${display.toLowerCase()}`;

      const g = groups.get(groupKey) ?? {
        keyForPrice: ca,
        tokenDisplay: display,
        list: [],
      };
      g.list.push(...list);
      groups.set(groupKey, g);
    }

    /** Compute mention price per group, and build final rows */
    const results: Array<{
      tokenKey: string; // For the frontend: CA or a raw key (ticker)
      tokenDisplay: string; // For UI display
      mentionPrice: number | null;
      mentionCount: number;
      _isCA: boolean; // marks CA groups
    }> = [];

    for (const [gk, g] of groups) {
      // time ascending
      g.list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // Collect mention-time price samples
      const samples: number[] = [];
      for (const m of g.list) {
        // Prefer embedded price_usd_at if present
        if (m.priceUsdAt != null) {
          const n = Number(m.priceUsdAt);
          if (!Number.isNaN(n)) {
            samples.push(n);
            continue;
          }
        }
        // Otherwise, if we have a CA, pick the nearest snapshot <= tweet time
        if (g.keyForPrice) {
          const near = await db
            .select({ priceUsd: coinPrice.priceUsd })
            .from(coinPrice)
            .where(
              and(
                eq(coinPrice.contractAddress, g.keyForPrice),
                lte(coinPrice.priceAt, m.createdAt),
              ),
            )
            .orderBy(desc(coinPrice.priceAt))
            .limit(1);
          if (near[0]) {
            const n = Number(near[0].priceUsd);
            if (!Number.isNaN(n)) samples.push(n);
          }
        }
      }

      const mentionCount = g.list.length;

      // Choose basis price according to "mode"
      let mentionPrice: number | null = null;
      if (samples.length > 0) {
        switch (parse.mode) {
          case "earliest":
            mentionPrice = samples[0];
            break;
          case "latest":
            mentionPrice = samples[samples.length - 1];
            break;
          case "lowest":
            mentionPrice = Math.min(...samples);
            break;
          case "highest":
            mentionPrice = Math.max(...samples);
            break;
        }
      }

      // Decide tokenKey for the frontend:
      // - CA group: ALWAYS use canonical CA (keeps Solana casing intact)
      // - raw group: use normKey (ticker upper) embedded in group key
      const tokenKey = g.keyForPrice ? g.keyForPrice : gk.split("::")[1];

      results.push({
        tokenKey,
        tokenDisplay: g.tokenDisplay,
        mentionPrice,
        mentionCount,
        _isCA: Boolean(g.keyForPrice),
      });
    }

    // Pull latest prices for CA groups
    const cas = results.filter((r) => r._isCA).map((r) => r.tokenKey);
    const latest = cas.length
      ? await getLatestPrices({ contractAddresses: cas })
      : [];
    const latestBy = new Map(
      latest.map((x) => [
        String(x.contract_address),
        {
          price: Number(x.price_usd),
          mc: x.market_cap_usd == null ? null : Number(x.market_cap_usd),
        },
      ]),
    );

    // Final shape
    const out = results
      .map((r) => {
        const rec = r._isCA ? latestBy.get(r.tokenKey) : null;
        const cur = rec ? rec.price : null;
        const curMc = rec ? rec.mc : null;
        const roi =
          r.mentionPrice != null && cur != null && r.mentionPrice > 0
            ? (cur - r.mentionPrice) / r.mentionPrice
            : null;
        return {
          tokenKey: r.tokenKey, // CA (canonical) or ticker
          tokenDisplay: r.tokenDisplay,
          mentionPrice: to6(r.mentionPrice),
          currentPrice: to6(cur),
          currentMc: curMc, // keep number for compact display on client
          roi,
          mentionCount: r.mentionCount,
        };
      })
      .sort((a, b) => {
        const d = (b.mentionCount ?? 0) - (a.mentionCount ?? 0);
        return d !== 0 ? d : a.tokenDisplay.localeCompare(b.tokenDisplay);
      })
      .slice(0, parse.limitPerKol);

    if (!debug) {
      return NextResponse.json({ items: out }, { status: 200 });
    }
    const dbgHit = latest.map((x) => String(x.contract_address));
    const dbgNeed = cas.filter((ca) => !latestBy.has(ca));
    return NextResponse.json(
      { items: out, debug: { hit: dbgHit, missing: dbgNeed } },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed" },
      { status: 400 },
    );
  }
}
