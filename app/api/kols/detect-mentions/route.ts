// app/api/kols/detect-mentions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { extractMentions, type Mention } from "@/lib/tokens/extract";

const Body = z.object({
  screen_name: z.string().min(1),
  days: z.number().int().min(1).max(30).optional().default(7),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GT_BASE =
  process.env.GECKOTERMINAL_BASE ?? "https://api.geckoterminal.com/api/v2";

async function resolveTickersToContracts(tickers: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  const NETWORKS = [
    "eth",
    "bsc",
    "base",
    "polygon",
    "arbitrum",
    "optimism",
    "avalanche",
    "fantom",
    "solana",
  ];

  for (const raw of tickers) {
    const ticker = raw.replace(/^\$+/, "").toLowerCase();
    let hit: { addr?: string; display?: string } | null = null;

    for (const net of NETWORKS) {
      try {
        const url = `${GT_BASE}/search/pools?query=${encodeURIComponent(ticker)}&network=${encodeURIComponent(net)}&include=base_token,quote_token`;
        const res = await fetch(url, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) continue;
        const j: any = await res.json();

        const inc: any[] = Array.isArray(j?.included) ? j.included : [];
        const token = inc.find(
          (x) =>
            x?.type?.includes("token") &&
            String(x?.attributes?.symbol ?? "").toLowerCase() === ticker,
        );

        if (token?.attributes?.address) {
          const addr = String(token.attributes.address).toLowerCase();
          hit = { addr, display: `$${ticker.toUpperCase()}` };
          break;
        }

        const addrFromJson = JSON.stringify(inc).match(
          /\b0x[a-fA-F0-9]{40}\b/,
        )?.[0];
        if (addrFromJson) {
          hit = {
            addr: addrFromJson.toLowerCase(),
            display: `$${ticker.toUpperCase()}`,
          };
          break;
        }
      } catch {
        /* ignore and try next network */
      }
    }

    if (hit?.addr) {
      out.set(ticker, {
        tokenKey: hit.addr,
        tokenDisplay: hit.display ?? `$${ticker.toUpperCase()}`,
        boostedConf: 98,
      });
    } else {
      out.set(ticker, {
        tokenKey: ticker,
        tokenDisplay: `$${ticker.toUpperCase()}`,
        boostedConf: 95,
      });
    }
  }
  return out;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (!isAdmin)
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );

  const { screen_name, days } = Body.parse(await req.json());
  const handle = screen_name.trim().replace(/^@+/, "").toLowerCase();

  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  const tweets = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      views: kolTweets.views,
      likes: kolTweets.likes,
      retweets: kolTweets.retweets,
      replies: kolTweets.replies,
    })
    .from(kolTweets)
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      ),
    );

  const allMentions: { tweetId: string; mention: Mention }[] = [];
  const uniqueTickers = new Set<string>();
  for (const t of tweets) {
    const ext = extractMentions(t.textContent ?? "");
    for (const m of ext) {
      allMentions.push({ tweetId: t.tweetId, mention: m });
      if (m.source !== "ca") {
        const tk = m.tokenDisplay.startsWith("$")
          ? m.tokenDisplay
          : `$${m.tokenKey.toUpperCase()}`;
        uniqueTickers.add(tk);
      }
    }
  }

  const resolved = await resolveTickersToContracts([...uniqueTickers]);

  type Row = {
    tweetId: string;
    tokenKey: string;
    tokenDisplay: string;
    confidence: number;
    source: "ca" | "ticker" | "phrase" | "hashtag" | "upper";
  };
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const { tweetId, mention } of allMentions) {
    let tokenKey = mention.tokenKey;
    let tokenDisplay = mention.tokenDisplay;
    let confidence = mention.confidence;

    if (mention.source !== "ca") {
      const t = mention.tokenDisplay.startsWith("$")
        ? mention.tokenDisplay
        : `$${mention.tokenKey.toUpperCase()}`;
      const r = resolved.get(t.replace(/^\$+/, "").toLowerCase());
      if (r) {
        tokenKey = r.tokenKey;
        tokenDisplay = r.tokenDisplay;
        confidence = Math.max(confidence, r.boostedConf);
      }
    }

    const k = `${tweetId}::${tokenKey}`;
    if (seen.has(k)) continue;
    seen.add(k);

    rows.push({
      tweetId,
      tokenKey,
      tokenDisplay,
      confidence: Math.min(100, Math.max(0, Math.round(confidence))),
      source: mention.source,
    });
  }

  let inserted = 0;
  if (rows.length) {
    const result = await db
      .insert(tweetTokenMentions)
      .values(
        rows.map((r) => ({
          tweetId: r.tweetId,
          tokenKey: r.tokenKey,
          tokenDisplay: r.tokenDisplay,
          confidence: r.confidence,
          source: r.source,
        })),
      )
      .onConflictDoNothing({
        target: [tweetTokenMentions.tweetId, tweetTokenMentions.tokenKey],
      })
      .returning({ id: tweetTokenMentions.id });

    inserted = result.length;
  }

  return NextResponse.json({
    ok: true,
    handle,
    days,
    scannedTweets: tweets.length,
    mentionsDetected: rows.length,
    inserted,
  });
}
