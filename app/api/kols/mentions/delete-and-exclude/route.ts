// app/api/kols/mentions/delete-and-exclude/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweetId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const { tweetId } = Body.parse(await req.json());

    const res = await db.transaction(async (tx) => {
      const del = await tx.delete(tweetTokenMentions).where(eq(tweetTokenMentions.tweetId, tweetId));
      const removed = Number((del as any)?.rowCount ?? 0);

      await tx
        .update(kolTweets)
        .set({ excluded: true })
        .where(eq(kolTweets.tweetId, tweetId));

      return { removed };
    });

    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 400 });
  }
}

