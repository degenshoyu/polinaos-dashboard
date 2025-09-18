// app/api/coin-prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { coinPrice } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  // 逗号分隔的合约地址
  addresses: z.string().min(1),
});

const looksLikeEvm = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
// 仅 EVM 小写；Solana（base58）保持大小写（大小写敏感）
const normalizeCA = (s: string) => (looksLikeEvm(s) ? s.toLowerCase() : s);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.parse({ addresses: searchParams.get("addresses") });

    // 规范化 + 去重
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

    // 子查询：每个 contract_address 的最新 price_at
    // 注意：max(...) 必须在表达式上 .as('lastAt')，否则 Drizzle 报 alias 错误
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

    // 连接：锁定到“每个地址的最新一条”
    const rows = await db
      .with(latestPerCa)
      .select({
        contract_address: coinPrice.contractAddress,
        price_usd: coinPrice.priceUsd, // Drizzle numeric => string
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
          price_at: (r.price_at as Date).toISOString(),
          source: String(r.source),
        })),
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("[/api/coin-prices] GET error:", e);
    return NextResponse.json({ error: e?.message || "Bad Request" }, { status: 400 });
  }
}

