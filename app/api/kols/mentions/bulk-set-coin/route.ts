// app/api/kols/mentions/bulk-set-coin/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { tweetTokenMentions } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweetIds: z.array(z.string().min(1)).min(1),
  newTokenKey: z.string().min(1),
  newTokenDisplay: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const { tweetIds, newTokenKey, newTokenDisplay } = Body.parse(
      await req.json(),
    );

    const result = await db
      .update(tweetTokenMentions)
      .set({
        tokenKey: newTokenKey,
        tokenDisplay: newTokenDisplay,
        priceUsdAt: null,
      })
      .where(inArray(tweetTokenMentions.tweetId, tweetIds));

    const updated = Number((result as any)?.rowCount ?? 0);
    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
