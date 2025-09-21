// app/api/kols/maxroi/refresh/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { computeMaxPairsForCA } from "@/lib/pricing/mentionMax";

// 运行在 Node，禁用静态优化
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ====== 请求体校验（宽松：coerce number / 布尔） ====== */
const Item = z.object({
  mentionId: z.string().min(1),
  ca: z.string().min(1),
  // 下面这些是「计算策略」选项，缺省时用默认
  poolMode: z.enum(["primary", "top3"]).optional(),
  minVolume: z.coerce.number().nonnegative().optional(),
  minutePatch: z.union([z.boolean(), z.coerce.number().transform(n => n !== 0)]).optional(),
  minuteAgg: z.coerce.number().int().positive().optional(), // 例如 15
  network: z.string().optional(), // e.g. "solana"
});
const Body = z.object({
  items: z.array(Item).min(1),
});

type PubRow = {
  id: string;
  tokenKey: string | null;
  publishDate: Date;
};

/** ====== POST /api/kols/maxroi/refresh ======
 * 请求体：{ items: Array<{ mentionId, ca, poolMode?, minVolume?, minutePatch?, minuteAgg?, network? }> }
 * 返回：{ updated: Array<{ id, maxPriceSinceMention, maxPriceAtSinceMention, refreshedAt }> }
 */
export async function POST(req: Request) {
  try {
    const nowIso = new Date().toISOString();

    const parsed = Body.parse(await req.json().catch(() => ({})));

    // 取本次要刷新的 mention 列表
    const ids = Array.from(new Set(parsed.items.map(x => x.mentionId)));
    if (ids.length === 0) {
      return NextResponse.json({ updated: [] }, { status: 200 });
    }

    /** 关键修复点 #1：publish_date 必须以 DB 为准（join kol_tweets） */
    const pubRows = (await db.execute(sql/* sql */`
      SELECT
        m.id,
        m.token_key   AS "tokenKey",
        kt.publish_date AS "publishDate"
      FROM tweet_token_mentions m
      JOIN kol_tweets kt
        ON kt.tweet_id = m.tweet_id
      WHERE m.id IN (${sql.join(ids, sql`, `)})
    `)) as unknown as { rows: PubRow[] };

    const pubs = new Map<string, PubRow>();
    for (const r of pubRows.rows ?? []) pubs.set(String(r.id), r);

    /** 按 CA 分组（只处理本次请求里、且能在 DB 找到 publish_date 的 mention） */
    const byCA = new Map<string, { id: string; publishDate: Date }[]>();
    for (const it of parsed.items) {
      const hit = pubs.get(it.mentionId);
      if (!hit) continue;
      // 以 DB 的 token_key 优先生效，退回到请求体 ca
      const ca = (hit.tokenKey || it.ca || "").trim();
      if (!ca) continue;
      const arr = byCA.get(ca) ?? [];
      arr.push({ id: it.mentionId, publishDate: hit.publishDate });
      byCA.set(ca, arr);
    }

    if (byCA.size === 0) {
      return NextResponse.json({ updated: [] }, { status: 200 });
    }

    /** 结果聚合（仅返回本次请求内的 mention） */
    const updated: {
      id: string;
      maxPriceSinceMention: number | null;
      maxPriceAtSinceMention: string | null;
      refreshedAt: string;
    }[] = [];

    /** 关键修复点 #2：每个 CA 只计算一次，并批量回填同 CA 的所有 mention */
    for (const [ca, list] of byCA) {
      // 同 CA 的策略：取该 CA 在本次请求中第一条 item 作为参考（同 CA 其余 item 复用）
      const ref = parsed.items.find(x => (x.ca || pubs.get(x.mentionId)?.tokenKey) === ca)!;

      const mentions = list.map(m => ({
        id: m.id,
        tokenKey: ca,
        publishDate: m.publishDate.toISOString(),
      }));

      const pairs = await computeMaxPairsForCA(ca, mentions, {
        poolMode: ref.poolMode ?? "primary",
        minVolume: ref.minVolume ?? 0,
        minutePatch: ref.minutePatch ?? true,
        minuteAgg: ref.minuteAgg ?? 15,
        network: ref.network ?? "solana",
      });

      // 事务内逐条更新，容错 null
      await db.transaction(async (tx) => {
        for (const m of mentions) {
          const p = pairs.get(m.id) ?? { maxPrice: null as number | null, maxAt: null as string | null };
          await tx.execute(sql/* sql */`
            UPDATE tweet_token_mentions
            SET
              max_price_since_mention     = ${p.maxPrice},
              max_price_at_since_mention  = ${p.maxAt}
            WHERE id = ${m.id};
          `);

          updated.push({
            id: m.id,
            maxPriceSinceMention: p.maxPrice,
            maxPriceAtSinceMention: p.maxAt ? new Date(p.maxAt).toISOString() : null,
            refreshedAt: nowIso,
          });
        }
      });
    }

    return NextResponse.json({ updated }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 400 });
  }
}

