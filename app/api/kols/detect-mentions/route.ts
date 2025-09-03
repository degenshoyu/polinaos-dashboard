// app/api/kols/detect-mentions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { eq, and, gte, lt, sql, inArray, desc } from "drizzle-orm";
import { extractMentions, type Mention } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";
import { resolveTickersToContracts } from "@/lib/markets/geckoterminal";
import { isSolAddr, canonAddr } from "@/lib/chains/address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========== Body ========== */
const Body = z.object({
  screen_name: z.string().min(1),
  days: z.number().int().min(1).max(30).optional().default(7),
  missingOnly: z.boolean().optional().default(true),
});

/* ========== Small helpers ========== */
// Prefer readable input for trigger text
function triggerInputFor(m: Mention) {
  if (m.source === "ca") return m.tokenKey || "";
  if (m.tokenDisplay?.startsWith("$")) return m.tokenDisplay;
  return `$${String(m.tokenKey || "").toUpperCase()}`;
}

/* ========== Route ========== */
export async function POST(req: Request) {
  // Admin auth
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (!isAdmin) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const { screen_name, days, missingOnly } = Body.parse(await req.json());
  const handle = screen_name.trim().replace(/^@+/, "").toLowerCase();

  // Time window [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // Load tweets
  const tweets = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    )
    .orderBy(desc(kolTweets.publishDate));

  if (!tweets.length) {
    return NextResponse.json({
      ok: true,
      handle,
      days,
      scannedTweets: 0,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
    });
  }

  // When missingOnly=true, skip tweets that already have ANY mentions
  let candidates = tweets;
  if (missingOnly) {
    const existing = await db
      .select({ tweetId: tweetTokenMentions.tweetId })
      .from(tweetTokenMentions)
      .where(
        inArray(
          tweetTokenMentions.tweetId,
          tweets.map((t) => t.tweetId),
        ),
      );
    const has = new Set(existing.map((e) => e.tweetId));
    candidates = tweets.filter((t) => !has.has(t.tweetId));
  }

  // Extract mentions; note if any Solana CA exists (to force solana for tickers)
  const all: {
    tweetId: string;
    m: Mention;
    triggerKey: string;
    triggerText: string;
  }[] = [];
  const uniqueTickers = new Set<string>(); // "$TICKER"
  let seenSolanaCA = false;

  for (const t of candidates) {
    const ext = extractMentions(t.textContent ?? "");
    for (const m of ext) {
      const input = triggerInputFor(m);
      const { key, text } = buildTriggerKeyWithText({
        source: m.source as any,
        value: input,
      });

      all.push({
        tweetId: t.tweetId,
        m,
        triggerKey: key,
        triggerText: text,
      });

      if (m.source === "ca" && isSolAddr(m.tokenKey)) seenSolanaCA = true;

      if (m.source !== "ca") {
        const tk = m.tokenDisplay?.startsWith("$")
          ? m.tokenDisplay
          : `$${String(m.tokenKey || "").toUpperCase()}`;
        uniqueTickers.add(tk);
      }
    }
  }

  // Resolve tickers → tokenKey using GeckoTerminal
  const resolved = await resolveTickersToContracts(
    [...uniqueTickers],
    seenSolanaCA ? { forceNetwork: "solana" } : { preferSolana: true },
  );

  // Build DB rows; de-duplicate by (tweetId, triggerKey)
  type Row = {
    tweetId: string;
    tokenKey: string;
    tokenDisplay: string | null;
    confidence: number;
    source: (typeof mentionSource.enumValues)[number];
    triggerKey: string;
    triggerText: string | null;
  };
  const rows: Row[] = [];
  const seenPair = new Set<string>();

  for (const { tweetId, m, triggerKey, triggerText } of all) {
    let tokenKey = m.tokenKey;
    let tokenDisplay = m.tokenDisplay;
    let confidence = m.confidence;

    if (m.source === "ca") {
      // For CA: trust address form, no GT lookup
      tokenKey = canonAddr(String(m.tokenKey || ""));
      tokenDisplay = tokenDisplay ?? m.tokenKey;
    } else {
      // For ticker/phrase: prefer Solana + DEX-priority ranking
      const disp = m.tokenDisplay?.startsWith("$")
        ? m.tokenDisplay
        : `$${String(m.tokenKey || "").toUpperCase()}`;
      const r = resolved.get(disp.replace(/^\$+/, "").toLowerCase());
      if (r) {
        tokenKey = r.tokenKey;
        tokenDisplay = r.tokenDisplay;
        confidence = Math.max(confidence, r.boostedConf);
      }
    }

    const pair = `${tweetId}___${triggerKey}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);

    rows.push({
      tweetId,
      tokenKey: canonAddr(String(tokenKey || "")), // EVM lowercased; Solana preserved
      tokenDisplay: tokenDisplay ?? (m.tokenDisplay || m.tokenKey),
      confidence: Math.min(100, Math.max(0, Math.round(confidence))),
      source: m.source as any as Row["source"],
      triggerKey,
      triggerText,
    });
  }

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      handle,
      days,
      scannedTweets: candidates.length,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
    });
  }

  // Accurate counts via pre-check (existing pairs)
  const tweetIds = Array.from(new Set(rows.map((r) => r.tweetId)));
  const triggers = Array.from(new Set(rows.map((r) => r.triggerKey)));
  const existingPairs = await db
    .select({
      tweetId: tweetTokenMentions.tweetId,
      triggerKey: tweetTokenMentions.triggerKey,
      tokenKey: tweetTokenMentions.tokenKey,
    })
    .from(tweetTokenMentions)
    .where(
      and(
        inArray(tweetTokenMentions.tweetId, tweetIds),
        inArray(tweetTokenMentions.triggerKey, triggers),
      ),
    );

  const existsMap = new Map(
    existingPairs.map((e) => [`${e.tweetId}___${e.triggerKey}`, e.tokenKey]),
  );
  const willInsert = rows.filter(
    (r) => !existsMap.has(`${r.tweetId}___${r.triggerKey}`),
  ).length;
  const willUpdate = rows.filter((r) => {
    const prev = existsMap.get(`${r.tweetId}___${r.triggerKey}`);
    return prev && prev !== r.tokenKey;
  }).length;

  // Upsert by (tweet_id, trigger_key), chunked
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(tweetTokenMentions)
      .values(chunk)
      .onConflictDoUpdate({
        target: [tweetTokenMentions.tweetId, tweetTokenMentions.triggerKey],
        set: {
          tokenKey: sql`excluded.token_key`,
          tokenDisplay: sql`excluded.token_display`,
          confidence: sql`excluded.confidence`,
          source: sql`excluded.source`,
          triggerText: sql`excluded.trigger_text`,
          updatedAt: sql`now()`,
        },
      });
  }

  return NextResponse.json({
    ok: true,
    handle,
    days,
    scannedTweets: candidates.length,
    mentionsDetected: rows.length,
    inserted: willInsert,
    updated: willUpdate,
  });
}
