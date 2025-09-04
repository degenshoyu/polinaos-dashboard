// app/api/kols/reextract/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  conditionalRebuildMentionsForTweets,
  fetchTweetsByIds,
} from "@/lib/kols/conditionalRebuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweet_ids: z.array(z.string()).min(1),
  threshold: z.number().optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const { tweet_ids, threshold } = body;

    const tweets = await fetchTweetsByIds(db, tweet_ids);
    const stat = await conditionalRebuildMentionsForTweets(db, tweets, {
      threshold,
    });

    return NextResponse.json({ ok: true, ...stat });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 400 },
    );
  }
}
