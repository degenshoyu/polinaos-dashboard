// app/api/kols/coins/delete/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Request body:
 * - ca: required Solana mint (contract address)
 * - excludeTweets: optional boolean; when true, also set excluded=true on kol_tweets that mentioned this CA
 *
 * Example:
 *   { "ca": "FtUEW73...", "excludeTweets": true }
 */
const Body = z.object({
  ca: z.string().min(32, "invalid ca").max(64),
  excludeTweets: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const { ca, excludeTweets } = Body.parse(await req.json());

    const result = await db.transaction(async (tx) => {
      // 1) Optionally mark related tweets as excluded=true.
      //    We update only tweets that have at least one mention with this CA.
      //    Using a CTE to both compute the set and return affected count.
      let excludedTweets = 0;
      if (excludeTweets) {
        const upd = await tx.execute(sql`
          WITH tt AS (
            SELECT DISTINCT m.tweet_id
            FROM tweet_token_mentions m
            WHERE m.token_key = ${ca}
          )
          UPDATE kol_tweets kt
          SET excluded = true,
              updated_at = NOW()
          FROM tt
          WHERE kt.tweet_id = tt.tweet_id
            AND (kt.excluded IS DISTINCT FROM true)
          RETURNING kt.tweet_id
        `);
        excludedTweets = upd.rows?.length ?? 0;
      }

      // 2) Delete mentions for this CA.
      const delMentions = await tx.execute(
        sql`DELETE FROM tweet_token_mentions WHERE token_key = ${ca} RETURNING 1`,
      );
      const removedMentions = delMentions.rows?.length ?? 0;

      // 3) Delete mapping row in coin_ca_ticker.
      const delTicker = await tx.execute(
        sql`DELETE FROM coin_ca_ticker WHERE contract_address = ${ca} RETURNING 1`,
      );
      const removedTicker = delTicker.rows?.length ?? 0;

      return { excludedTweets, removedMentions, removedTicker };
    });

    return NextResponse.json({
      ok: true,
      mode: result.excludedTweets > 0 ? "with_exclude" : "basic",
      ...result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 400 },
    );
  }
}

