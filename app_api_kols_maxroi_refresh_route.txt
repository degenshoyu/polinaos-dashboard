// app/api/kols/maxroi/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sql, inArray, eq } from "drizzle-orm";
import { tweetTokenMentions, kolTweets } from "@/lib/db/schema";
import { computeMaxPairsForCA } from "@/lib/pricing/mentionMax";
import "@/lib/net/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  items: z
    .array(
      z.object({
        ca: z.string().min(1),
        mentionId: z.string().min(1),
        network: z.string().optional(),
        poolMode: z.enum(["primary", "top3"]).optional().default("primary"),
        minVolume: z.number().min(0).optional().default(0),
        minutePatch: z.boolean().optional().default(true),
        minuteAgg: z.number().int().min(1).max(60).optional().default(15),
      }),
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = Body.parse(await req.json());
    const nowIso = new Date().toISOString();

    const allIds = Array.from(new Set(parsed.items.map((i) => i.mentionId)));
    const rows = await db
      .select({
        id: tweetTokenMentions.id,
        publishDate: kolTweets.publishDate,
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
      .where(inArray(tweetTokenMentions.id, allIds));
    const pubById = new Map(
      rows.map((r) => [String(r.id), r.publishDate as Date]),
    );

    const byCA = new Map<string, { id: string; publishDate: Date }[]>();
    for (const it of parsed.items) {
      const pd = pubById.get(String(it.mentionId));
      if (!pd) continue;
      const arr = byCA.get(it.ca) ?? [];
      arr.push({ id: it.mentionId, publishDate: pd });
      byCA.set(it.ca, arr);
    }

    const updated: {
      id: string;
      maxPriceSinceMention: number | null;
      maxPriceAtSinceMention: string | null;
      refreshedAt: string;
    }[] = [];

    for (const [ca, list] of byCA) {
      // shape to feed computeMaxPairsForCA
      const mentions = list.map((m) => ({
        id: m.id,
        tokenKey: ca,
        publishDate: m.publishDate.toISOString(),
      }));

      const ref = parsed.items.find((x) => x.ca === ca)!;

      const pairs = await computeMaxPairsForCA(ca, mentions, {
        poolMode: ref.poolMode,
        minVolume: ref.minVolume ?? 0,
        minutePatch: ref.minutePatch ?? true,
        minuteAgg: ref.minuteAgg ?? 15,
        network: ref.network, // 可选
      });

      await db.transaction(async (tx) => {
        for (const m of mentions) {
          const p = pairs.get(m.id) ?? { maxPrice: null, maxAt: null };
          await tx.execute(sql/* sql */ `
            UPDATE tweet_token_mentions
            SET
              max_price_since_mention = ${p.maxPrice},
              max_price_at_since_mention = ${p.maxAt}
            WHERE id = ${m.id};
          `);
          updated.push({
            id: m.id,
            maxPriceSinceMention: p.maxPrice as any,
            maxPriceAtSinceMention: p.maxAt
              ? new Date(p.maxAt as any).toISOString()
              : null,
            refreshedAt: nowIso,
          });
        }
      });
    }

    return NextResponse.json({ updated }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed" },
      { status: 400 },
    );
  }
}
