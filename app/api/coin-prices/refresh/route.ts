// app/api/coin-prices/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { coinPrice } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  // comma-separated contract addresses
  addresses: z.string().min(1),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const looksLikeEvm = (s: string) => /^0x[a-fA-F0-9]{40}$/i.test(s);
/** Normalize contract address for DB keying:
 * - EVM: lowercase (case-insensitive)
 * - Solana (base58): keep original casing (case-sensitive)
 */
const normalizeCA = (s: string) => (looksLikeEvm(s) ? s.toLowerCase() : s);

/** Fetch one token from GeckoTerminal Tokens endpoint (server-side, no CORS).
 * We use /networks/solana/tokens/{address} because it returns BOTH price and market cap (if available).
 * If market_cap_usd is null, we fallback to fdv_usd.
 *
 * Docs/notes:
 * - Root: https://api.geckoterminal.com/api/v2 (public REST) :contentReference[oaicite:2]{index=2}
 * - Changelog indicates token response includes market cap / FDV fields. :contentReference[oaicite:3]{index=3}
 */
async function fetchGtTokenSol(
  addressRaw: string,
): Promise<{ price: number | null; mcap: number | null } | null> {
  const ca = normalizeCA(addressRaw);
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(
    ca,
  )}`;

  let tries = 0;
  for (;;) {
    tries++;
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    // Gentle backoff for 429
    if (r.status === 429) {
      const backoff = Math.min(15000, 500 * 2 ** (tries - 1));
      await sleep(backoff);
      continue;
    }

    if (!r.ok) {
      // 404/5xx etc → give up for this token
      return null;
    }

    // Parse attributes
    const j: any = await r.json().catch(() => ({}));
    const attrs = j?.data?.attributes ?? {};
    const priceNum = Number(attrs.price_usd);
    const mcapRaw = attrs.market_cap_usd ?? attrs.fdv_usd ?? null;
    const mcapNum =
      mcapRaw == null
        ? null
        : Number(typeof mcapRaw === "string" ? mcapRaw : mcapRaw);

    const price = Number.isFinite(priceNum) ? priceNum : null;
    const mcap = mcapNum != null && Number.isFinite(mcapNum) ? mcapNum : null;
    return { price, mcap };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.parse({ addresses: searchParams.get("addresses") });

    // Normalize + de-dup
    const rawList = parsed.addresses
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const list = Array.from(new Set(rawList.map(normalizeCA)));
    if (list.length === 0) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const now = new Date();
    const rowsOut: Array<{
      contract_address: string;
      price_usd: string | null;
      market_cap_usd: string | null;
      price_at: string;
      source: "geckoterminal";
    }> = [];

    // One-by-one (matches your queue’s current pattern; safe under 30 rpm public limit)
    for (const ca of list) {
      // jitter to reduce 429 bursts
      await sleep(300 + Math.floor(Math.random() * 300));

      const res = await fetchGtTokenSol(ca);
      if (!res || res.price == null) {
        // No valid price → skip insert/return for this address
        continue;
      }

      // Write snapshot into DB (price + market cap if available)
      await db.insert(coinPrice).values({
        contractAddress: ca,
        priceUsd: String(res.price), // Drizzle numeric: use string
        marketCapUsd: res.mcap != null ? String(res.mcap) : null,
        priceAt: now,
        source: "geckoterminal",
        poolAddress: null,
        confidence: null,
      });

      rowsOut.push({
        contract_address: ca,
        price_usd: String(res.price),
        market_cap_usd: res.mcap != null ? String(res.mcap) : null,
        price_at: now.toISOString(),
        source: "geckoterminal",
      });
    }

    return NextResponse.json({ items: rowsOut }, { status: 200 });
  } catch (e: any) {
    console.error("[/api/coin-prices/refresh] error:", e);
    return NextResponse.json(
      { error: e?.message || "Failed" },
      { status: 400 },
    );
  }
}
