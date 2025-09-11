import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tweetTokenMentions } from "@/lib/db/schema";
import { and, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  fromCa: z.string().trim().min(1),
  toCa: z.string().trim().min(1),
  // 可选：仅针对某个 Ticker 生效（不含 $，或含 $ 都行）
  scopeTicker: z.string().trim().optional(),
});

export async function POST(req: Request) {
  try {
    const { fromCa, toCa, scopeTicker } = Body.parse(await req.json());

    // 规范化 scopeTicker：去掉前缀 $ ，使用 UPPER 做精确比较
    const normTicker = scopeTicker
      ? scopeTicker.replace(/^\$/, "").trim().toUpperCase()
      : null;

    // where: 大小写不敏感匹配 CA
    const whereFromCa = and(
      sql`lower(${tweetTokenMentions.tokenKey}) = lower(${fromCa})`,
      normTicker
        ? sql`upper(trim(both ' $' from ${tweetTokenMentions.tokenDisplay})) = ${normTicker}`
        : sql`true`,
    );

    const whereToCa = and(
      sql`lower(${tweetTokenMentions.tokenKey}) = lower(${toCa})`,
      normTicker
        ? sql`upper(trim(both ' $' from ${tweetTokenMentions.tokenDisplay})) = ${normTicker}`
        : sql`true`,
    );

    const result = await db.transaction(async (tx) => {
      // 1) 把 fromCa 全部改成 toCa，并清空价格
      const r1 = await tx
        .update(tweetTokenMentions)
        .set({ tokenKey: toCa, priceUsdAt: null })
        .where(whereFromCa);

      // 2) 兜底：把已经是 toCa 的相关行价格也清空（确保“所有相关行的价格”都清）
      const r2 = await tx
        .update(tweetTokenMentions)
        .set({ priceUsdAt: null })
        .where(whereToCa);

      return {
        changedCa: Number((r1 as any)?.rowCount ?? 0),
        clearedPrice: Number((r2 as any)?.rowCount ?? 0),
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
