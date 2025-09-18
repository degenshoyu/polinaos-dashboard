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
const looksLikeEvm = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const normalizeCA = (s: string) => (looksLikeEvm(s) ? s.toLowerCase() : s);

/** Server-side GeckoTerminal fetch (no CORS) */
async function fetchGtSimpleSol(
  addresses: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const caRaw of addresses) {
    const ca = normalizeCA(caRaw);
    const url = `https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${encodeURIComponent(ca)}`;
    let tries = 0;
    for (;;) {
      tries++;
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (r.status === 429) {
        const backoff = Math.min(15000, 500 * 2 ** (tries - 1));
        await sleep(backoff);
        continue;
      }
      if (!r.ok) break;
      const j: any = await r.json().catch(() => ({}));
      const map = j?.data?.attributes?.token_prices || {};
      const v = map[ca] ?? Object.values(map)[0];
      const num = Number(v);
      if (Number.isFinite(num)) out[ca] = num;
      break;
    }
    await sleep(300 + Math.floor(Math.random() * 300)); // jitter to reduce 429
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.parse({ addresses: searchParams.get("addresses") });

    // normalize + de-dupe
    const rawList = parsed.addresses
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const list = Array.from(new Set(rawList.map(normalizeCA)));
    if (list.length === 0)
      return NextResponse.json({ items: [] }, { status: 200 });

    const prices = await fetchGtSimpleSol(list);

    const now = new Date();
    const values = Object.entries(prices).map(([ca, p]) => ({
      contractAddress: ca,
      priceUsd: String(p), // Drizzle numeric 要用 string
      priceAt: now,
      source: "geckoterminal" as const,
    }));

    if (values.length) {
      await db.insert(coinPrice).values(values);
    }

    return NextResponse.json(
      {
        items: values.map((v) => ({
          contract_address: v.contractAddress,
          price_usd: v.priceUsd,
          price_at: v.priceAt.toISOString(),
          source: v.source,
        })),
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed" },
      { status: 400 },
    );
  }
}
