// app/api/kols/coins/search/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { coinCaTicker } from "@/lib/db/schema";
import { ilike, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

    if (!q) return NextResponse.json({ ok: true, items: [] });

    // ILIKE both ticker and CA
    const items = await db
      .select({
        id: coinCaTicker.id,
        tokenTicker: coinCaTicker.tokenTicker,
        contractAddress: coinCaTicker.contractAddress,
      })
      .from(coinCaTicker)
      .where(
        or(
          ilike(coinCaTicker.tokenTicker, `%${q.replace(/^\$/, "")}%`),
          ilike(coinCaTicker.contractAddress, `%${q}%`),
        ),
      )
      .limit(limit);

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
