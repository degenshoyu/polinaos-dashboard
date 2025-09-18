// app/api/coin-prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { coinPrice } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  addresses: z.string().min(1),
});

const looksLikeEvm = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const normalizeCA = (s: string) => (looksLikeEvm(s) ? s.toLowerCase() : s);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.parse({ addresses: searchParams.get("addresses") });

    const list = Array.from(
      new Set(
        parsed.addresses
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map(normalizeCA),
      ),
    );
    if (list.length === 0) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const latestPerCa = db.$with("latest_per_ca").as(
      db
        .select({
          contractAddress: coinPrice.contractAddress,
          lastAt: sql<Date>`max(${coinPrice.priceAt})`.as("lastAt"),
        })
        .from(coinPrice)
        .where(inArray(coinPrice.contractAddress, list))
        .groupBy(coinPrice.contractAddress),
    );

    const rows = await db
      .with(latestPerCa)
      .select({
        contract_address: coinPrice.contractAddress,
        price_usd: coinPrice.priceUsd,
        market_cap_usd: coinPrice.marketCapUsd, // <-- NEW
        price_at: coinPrice.priceAt,
        source: coinPrice.source,
      })
      .from(coinPrice)
      .innerJoin(
        latestPerCa,
        and(
          eq(coinPrice.contractAddress, latestPerCa.contractAddress),
          eq(coinPrice.priceAt, latestPerCa.lastAt),
        ),
      );

    return NextResponse.json(
      {
        items: rows.map((r) => ({
          contract_address: String(r.contract_address),
          price_usd: String(r.price_usd),
          market_cap_usd:
            r.market_cap_usd == null ? null : String(r.market_cap_usd),
          price_at: (r.price_at as Date).toISOString(),
          source: String(r.source),
        })),
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("[/api/coin-prices] GET error:", e);
    return NextResponse.json(
      { error: e?.message || "Bad Request" },
      { status: 400 },
    );
  }
}
