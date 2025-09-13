// app/api/kols/fill-mention-prices-tweet/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { fillMentionPricesForTweet } from "@/lib/kols/fillMentionPrices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tweetId: z.string().trim().min(1),
  tokenKey: z.string().trim().min(1),
  network: z.string().trim().default("solana"),
  tryPools: z.number().int().min(1).max(8).default(3),
  graceSeconds: z.number().int().min(0).max(600).default(90),
  debug: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const p = Body.parse(await req.json().catch(() => ({})));
    const result = await fillMentionPricesForTweet(p);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Internal Error" },
      { status: 500 },
    );
  }
}
