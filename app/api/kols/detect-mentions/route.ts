// app/api/kols/detect-mentions/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import { db } from "@/lib/db/client";
import {
  kolTweets,
  tweetTokenMentions,
  mentionSource,
  tokenResolutionIssues,
  coinCaTicker,
} from "@/lib/db/schema";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import {
  processTweetsToRows,
  type MinimalTweet,
} from "@/lib/kols/detectEngine";

import { resolveTickerToCA, resolveCAtoMeta } from "@/lib/tokens/resolve";

import { canonAddr } from "@/lib/chains/address";

// ---------- Types for local enrichment ----------
// Infer the element type returned by processTweetsToRows().rows
type ExtractedRow = Awaited<
  ReturnType<typeof processTweetsToRows>
>["rows"][number];
// Extend with a lightweight meta used only inside this route
type RowWithMeta = ExtractedRow & {
  meta?: {
    symbol?: string | null;
    tokenName?: string | null;
    primaryPoolAddress?: string | null;
    source?: "ticker" | "phrase" | "ca";
  };
};

// ---------- Helpers for unresolved recording ----------
const normTicker = (s: string) =>
  String(s || "")
    .replace(/^\$+/, "")
    .trim()
    .toUpperCase();
const stripCoinSuffix = (raw: string) =>
  String(raw || "")
    .replace(/\s+(coin|token)\b/gi, "")
    .trim();

// Honor "DB-only" for phrase resolution. Default ON.
// Set RESOLVE_NAME_DB_ONLY=0 if you want to allow GT fallback via resolvePhraseToCA().
const RESOLVE_NAME_DB_ONLY =
  (process.env.RESOLVE_NAME_DB_ONLY ?? "1").trim() !== "0";

// ---------- unresolved recorder ----------
async function recordUnresolved(opts: {
  kind: "ticker" | "phrase";
  rawValue: string;
  tweetId: string;
  triggerKey: string;
  reason: "resolver_miss" | "missing_meta";
  error?: string | null;
  candidates?: any; // optional debug snapshot
}) {
  const normKey =
    opts.kind === "ticker"
      ? normTicker(opts.rawValue)
      : stripCoinSuffix(opts.rawValue).toLowerCase();
  if (!normKey) return;
  await db
    .insert(tokenResolutionIssues)
    .values({
      kind: opts.kind as any,
      normKey,
      sample: opts.rawValue,
      lastReason: opts.reason,
      lastError: opts.error ?? null,
      lastTweetId: opts.tweetId,
      lastTriggerKey: opts.triggerKey,
      seenCount: 1,
      updatedAt: new Date(),
    } as any)
    .onConflictDoUpdate({
      target: [tokenResolutionIssues.kind, tokenResolutionIssues.normKey],
      set: {
        sample: sql`coalesce(excluded.sample, ${tokenResolutionIssues.sample})`,
        lastReason: sql`excluded.last_reason`,
        lastError: sql`excluded.last_error`,
        lastTweetId: sql`excluded.last_tweet_id`,
        lastTriggerKey: sql`excluded.last_trigger_key`,
        seenCount: sql`${tokenResolutionIssues.seenCount} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/* ========================= Runtime hints ========================= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================= DB-only phrase resolver ========================= */
/**
 * Resolve a natural phrase to a CA using ONLY coin_ca_ticker.
 * Order of attempts:
 *  1) token_name exact match
 *  2) token_ticker exact match (normalized uppercase, no $)
 *  3) token_name ILIKE %name%
 */
async function resolvePhraseFromDBOnly(nameRaw: string) {
  const name = stripCoinSuffix(nameRaw);
  if (!name || name.length < 2) return null;

  // 1) exact token_name
  const exactByName = await db
    .select()
    .from(coinCaTicker)
    .where(eq(coinCaTicker.tokenName, name))
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);
  if (exactByName.length) {
    const r = exactByName[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker ?? null,
      tokenName: r.tokenName ?? null,
      primaryPoolAddress: r.primaryPoolAddress ?? null,
      source: "db-name-exact" as const,
    };
  }

  // 2) exact token_ticker
  const t = normTicker(name);
  if (t) {
    const exactByTicker = await db
      .select()
      .from(coinCaTicker)
      .where(eq(coinCaTicker.tokenTicker, t))
      .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
      .limit(1);
    if (exactByTicker.length) {
      const r = exactByTicker[0]!;
      return {
        contractAddress: r.contractAddress,
        tokenTicker: r.tokenTicker ?? null,
        tokenName: r.tokenName ?? null,
        primaryPoolAddress: r.primaryPoolAddress ?? null,
        source: "db-ticker-exact" as const,
      };
    }
  }

  // 3) name ILIKE
  const likeRows = await db
    .select()
    .from(coinCaTicker)
    .where(sql`${coinCaTicker.tokenName} ILIKE ${"%" + name + "%"}`)
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);
  if (likeRows.length) {
    const r = likeRows[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker ?? null,
      tokenName: r.tokenName ?? null,
      primaryPoolAddress: r.primaryPoolAddress ?? null,
      source: "db-name-like" as const,
    };
  }
  return null;
}

/* ========================= Auth helpers ========================= */
/**
 * Allow machine-to-machine (cron) access via a shared secret.
 * Accepts the secret from:
 *   - query param: ?secret=...
 *   - headers: x-cron-secret / x-api-key
 */
function allowByCronSecret(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return false;

  const url = new URL(req.url);
  const q = url.searchParams.get("secret")?.trim() || "";
  const h =
    req.headers.get("x-cron-secret")?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    "";

  return q === expected || h === expected;
}

/* ========================= Input schema ========================= */
const Body = z.object({
  // Handle or "*" / "all"
  screen_name: z.string().min(1),
  // Scan window (in days)
  days: z.number().int().min(1).max(30).optional().default(7),
  /**
   * When true:
   *   - only scan unresolved tweets (kol_tweets.resolved = false)
   *   - after successful CA writes, mark those tweets as resolved=true
   */
  missingOnly: z.boolean().optional().default(true),
  // allow toggling logs via body as well
  dbLog: z.boolean().optional(),
  stream: z.boolean().optional(),
  /**
   * When true: emit per-row DB actions (insert/update/noop) as NDJSON events.
   * This can be very verbose on large batches; default is false.
   */
});

/* ========================= Core runner ========================= */
async function runDetectOnce(
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    dbLog: boolean;
    url: URL;
  },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly, dbLog } = params;

  const raw = screen_name.trim().replace(/^@+/, "");
  const isAll = raw === "*" || raw.toLowerCase() === "all";
  const handle = isAll ? null : raw.toLowerCase();

  log({ event: "start", handle: handle ?? "*", days, missingOnly });

  // Calculate scan window: [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // Fetch candidate tweets (newest first).
  // IMPORTANT: when missingOnly=true, only scan unresolved tweets.
  const tweets = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(
      isAll
        ? and(
            gte(kolTweets.publishDate, since),
            lt(kolTweets.publishDate, until),
            missingOnly ? eq(kolTweets.resolved, false) : sql`true`,
          )
        : and(
            eq(kolTweets.twitterUsername, handle!),
            gte(kolTweets.publishDate, since),
            lt(kolTweets.publishDate, until),
            missingOnly ? eq(kolTweets.resolved, false) : sql`true`,
          ),
    )
    .orderBy(desc(kolTweets.publishDate));

  log({ event: "loaded", tweets: tweets.length });

  if (!tweets.length) {
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: 0,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
    };
  }

  // 1) Extraction only: get raw mentions (no market calls here)
  const minimal: MinimalTweet[] = tweets.map((t) => ({
    tweetId: t.tweetId,
    textContent: t.textContent,
  }));

  const { rows: extractedRows, stats } = await processTweetsToRows(
    minimal,
    log,
  );
  log({ event: "extracted_rows", count: extractedRows.length });

  // 2) Normalize ticker/phrase -> CA via resolver (knowledge base + GT search)
  const normalizedRows: RowWithMeta[] = await Promise.all(
    extractedRows.map(async (r): Promise<RowWithMeta> => {
      if (r.source === "ticker") {
        const token = (r.tokenDisplay || r.tokenKey || "").replace(/^\$+/, "");
        log({
          event: "resolver_try",
          kind: "ticker",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          token,
        });
        const hit = await resolveTickerToCA(token).catch(() => null);
        if (hit?.contractAddress) {
          log({
            event: "resolver_hit",
            kind: "ticker",
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            addr: hit.contractAddress,
            tokenTicker: hit.tokenTicker ?? null,
            tokenName: hit.tokenName ?? null,
          });
          // keep meta so we can normalize token_display later
          return {
            ...r,
            tokenKey: hit.contractAddress,
            meta: {
              ...(r as RowWithMeta).meta,
              symbol: hit.tokenTicker || null,
              tokenName: hit.tokenName || null,
              source: "ticker",
            },
          };
        }
        // record unresolved ticker
        await recordUnresolved({
          kind: "ticker",
          rawValue: token,
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          reason: "resolver_miss",
        });
        log({
          event: "resolver_miss",
          kind: "ticker",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          token,
        });
        return r as RowWithMeta; // unresolved; CA gate will drop
      }
      if (r.source === "phrase") {
        const rawPhrase = (r.tokenDisplay || r.tokenKey || "").trim();
        const cleaned = stripCoinSuffix(rawPhrase);
        // Try DB-only first (and by default ONLY DB)
        log({
          event: "resolver_db_try",
          kind: "phrase",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          phrase: cleaned,
        });
        const dbHit = await resolvePhraseFromDBOnly(cleaned);
        if (dbHit?.contractAddress) {
          log({
            event: "resolver_db_hit",
            kind: "phrase",
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            addr: dbHit.contractAddress,
            tokenTicker: dbHit.tokenTicker ?? null,
            tokenName: dbHit.tokenName ?? null,
          });
          return {
            ...r,
            tokenKey: dbHit.contractAddress,
            meta: {
              ...(r as RowWithMeta).meta,
              symbol: dbHit.tokenTicker || null,
              tokenName: dbHit.tokenName || null,
              primaryPoolAddress: dbHit.primaryPoolAddress || null,
              source: "phrase",
            },
          };
        }

        // If DB-only (default): record miss and exit early
        if (RESOLVE_NAME_DB_ONLY) {
          await recordUnresolved({
            kind: "phrase",
            rawValue: cleaned,
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            reason: "resolver_miss",
          });
          log({
            event: "resolver_db_miss",
            kind: "phrase",
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            phrase: cleaned,
          });
          return r as RowWithMeta; // unresolved; CA gate will drop
        }

        // (Optional fallback) GT-based phrase resolver if explicitly allowed
        // NOTE: you can re-enable by setting RESOLVE_NAME_DB_ONLY=0
        // import { resolvePhraseToCA } from "@/lib/tokens/resolve" at the top if you flip this
        // const hit = await resolvePhraseToCA(cleaned).catch(() => null);
        // if (hit?.contractAddress) { ... }
        // else { recordUnresolved(...) ; log(...); return r as RowWithMeta }

        // default behavior remains: DB-only → miss already handled above
        return r as RowWithMeta;
      }
      // 'ca' or others: pass through
      return r as RowWithMeta;
    }),
  );

  // 3) FINAL DEFENSE: only keep rows whose tokenKey is a valid Solana CA.
  const caRows: RowWithMeta[] = normalizedRows
    .map((r) => {
      const a = canonAddr(String(r.tokenKey || ""));
      return a ? { ...r, tokenKey: a } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  log({ event: "ca_rows", count: caRows.length });

  // ===== Enrichment & display normalization =====
  // Ensure each row has symbol/tokenName; unify token_display = $SYMBOL
  const finalRows: RowWithMeta[] = [];
  for (const r of caRows) {
    let symbol = r.meta?.symbol ?? null;
    let tokenName = r.meta?.tokenName ?? null;
    let primaryPoolAddress = r.meta?.primaryPoolAddress ?? null;

    if (!symbol || !tokenName) {
      const meta = await resolveCAtoMeta(r.tokenKey).catch(() => null);
      if (!meta || !meta.symbol || !meta.tokenName) {
        // record "missing_meta" for CA path too (helps us see which mints lack metadata)
        if (r.source === "ticker" || r.source === "phrase") {
          await recordUnresolved({
            kind: r.source,
            rawValue:
              r.source === "ticker"
                ? r.tokenDisplay || r.tokenKey || ""
                : r.tokenDisplay || r.tokenKey || "",
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            reason: "missing_meta",
          });
        }
        log({
          event: "skip_missing_meta",
          tweetId: r.tweetId,
          addr: r.tokenKey,
          source: r.source,
        });
        continue; // strict: do not write rows without symbol/name
      }
      symbol = meta.symbol;
      tokenName = meta.tokenName;
      primaryPoolAddress =
        meta.primaryPoolAddress ?? primaryPoolAddress ?? null;
    }

    finalRows.push({
      ...r,
      tokenDisplay: `$${symbol}`,
      meta: { ...(r.meta || {}), symbol, tokenName, primaryPoolAddress },
    });
  }

  if (!finalRows.length) {
    // No CA to write; do NOT mark tweets resolved to allow future attempts.
    // (If you prefer to mark as resolved even without a CA, change here.)
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: stats.scannedTweets,
      mentionsDetected: stats.mentionsDetected,
      inserted: 0,
      updated: 0,
    };
  }

  // 4) Plan upsert: check existing (tweet_id, trigger_key)
  const tweetIds = Array.from(new Set(finalRows.map((r) => r.tweetId)));
  const triggers = Array.from(new Set(finalRows.map((r) => r.triggerKey)));

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

  const willInsert = finalRows.filter(
    (r) => !existsMap.has(`${r.tweetId}___${r.triggerKey}`),
  ).length;
  const willUpdate = finalRows.filter((r) => {
    const prev = existsMap.get(`${r.tweetId}___${r.triggerKey}`);
    return prev && prev !== r.tokenKey;
  }).length;

  log({
    event: "upsert_planning",
    rows: caRows.length,
    willInsert,
    willUpdate,
  });

  // 5) Upsert by chunks
  const CHUNK = 200;
  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const chunk = finalRows.slice(i, i + CHUNK).map((r) => ({
      tweetId: r.tweetId,
      tokenKey: r.tokenKey, // final CA
      tokenDisplay: r.tokenDisplay,
      confidence: r.confidence,
      source: r.source as (typeof mentionSource.enumValues)[number],
      triggerKey: r.triggerKey,
      triggerText: r.triggerText,
    }));

    // Pre-calc per-row actions for logging
    const actions = chunk.map((r) => {
      const key = `${r.tweetId}___${r.triggerKey}`;
      const prev = existsMap.get(key);
      if (!prev) return { ...r, action: "insert" as const, prev: null };
      if (prev !== r.tokenKey) return { ...r, action: "update" as const, prev };
      return { ...r, action: "noop" as const, prev };
    });

    const insCount = actions.filter((a) => a.action === "insert").length;
    const updCount = actions.filter((a) => a.action === "update").length;
    const nopCount = actions.filter((a) => a.action === "noop").length;
    log({
      event: "db_chunk_plan",
      i,
      size: chunk.length,
      inserts: insCount,
      updates: updCount,
      noops: nopCount,
    });
    if (dbLog) {
      for (const a of actions) {
        if (a.action === "noop") continue;
        log({
          event: "db_row",
          action: a.action,
          tweetId: a.tweetId,
          triggerKey: a.triggerKey,
          prevTokenKey: a.prev,
          nextTokenKey: a.tokenKey,
          source: a.source,
        });
      }
    }

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

    log({
      event: "db_chunk_written",
      i,
      size: chunk.length,
      inserts: insCount,
      updates: updCount,
    });
  }

  // 6) Mark tweets that had at least one CA written as resolved=true
  const processedTweetIds = Array.from(
    new Set(finalRows.map((r) => r.tweetId)),
  );
  if (processedTweetIds.length) {
    await db
      .update(kolTweets)
      .set({ resolved: true, updatedAt: new Date() })
      .where(inArray(kolTweets.tweetId, processedTweetIds));

    log({
      event: "tweets_resolved",
      count: processedTweetIds.length,
      sample: processedTweetIds.slice(0, 20), // avoid huge payload
    });
  }

  log({
    event: "done",
    rows: caRows.length,
    inserted: willInsert,
    updated: willUpdate,
  });

  return {
    ok: true,
    handle: handle ?? "*",
    days,
    scannedTweets: stats.scannedTweets,
    mentionsDetected: stats.mentionsDetected,
    inserted: willInsert,
    updated: willUpdate,
  };
}

/* ========================= Route (POST) ========================= */
export async function POST(req: Request) {
  // Admin session OR cron secret
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  const bySecret = allowByCronSecret(req);

  if (!isAdmin && !bySecret) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const wantStreamQuery =
    url.searchParams.get("stream") === "1" ||
    url.searchParams.get("stream") === "true";
  const wantDbLogQuery =
    url.searchParams.get("dbLog") === "1" ||
    url.searchParams.get("dbLog") === "true";

  const body = Body.parse(await req.json().catch(() => ({})));
  const params = {
    ...body,
    dbLog: body.dbLog ?? wantDbLogQuery,
    url,
  };
  const wantStream = wantStreamQuery || Boolean(body.stream);

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          const emit = (evt: string, data: any = {}) =>
            write({ t: Date.now(), evt, ...data });
          (async () => {
            try {
              emit("hello");
              const result = await runDetectOnce(params, (e) =>
                // normalize all internal logs to NDJSON events
                typeof e === "object" && e?.event
                  ? emit(e.event, { ...e, event: undefined })
                  : emit("log", { data: e }),
              );
              emit("result", result);
              controller.close();
            } catch (e: any) {
              emit("error", { message: e?.message || String(e) });
              controller.close();
            }
          })();
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  }

  // Non-streaming JSON response
  const result = await runDetectOnce(params, () => {});
  return NextResponse.json(result);
}
