// lib/kols/detectMentionsService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// Service layer for /api/kols/detect-mentions:
// - Loads tweets to scan
// - Extracts mentions via detectEngine
// - Resolves ticker/phrase -> contract address
// - Ensures display metadata (symbol/name)
// - Enriches + persists coin_ca_ticker (mint authority, mintedAt, creator, flags)
// - Upserts tweet_token_mentions
// - Marks tweets as resolved
//
// This file absorbs the heavy logic so the API route stays minimal.

import { db } from "@/lib/db/client";
import {
  kolTweets,
  tweetTokenMentions,
  tokenResolutionIssues,
  coinCaTicker,
  mentionSource,
} from "@/lib/db/schema";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import {
  processTweetsToRows,
  type MinimalTweet,
} from "@/lib/kols/detectEngine";

import { resolveTickerToCA, resolveCAtoMeta } from "@/lib/tokens/resolve";
import { canonAddr } from "@/lib/chains/address";

import { fetchMintMeta } from "@/lib/mintmeta/fetch";
import {
  upsertCoinCaProvenance,
  type BasicIdentity,
} from "@/lib/db/repos/coinCaTickerRepo";

// --- rate control knobs for /api/mintmeta enrichment (with sane defaults) ---
const MINTMETA_CONCURRENCY = Math.max(
  1,
  Number(process.env.DETECT_MINTMETA_CONCURRENCY ?? 1),
);
const MINTMETA_SLEEP_MS = Math.max(
  0,
  Number(process.env.DETECT_MINTMETA_SLEEP_MS ?? 300),
);
const MINTMETA_JITTER_MS = Math.max(
  0,
  Number(process.env.DETECT_MINTMETA_JITTER_MS ?? 250),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (n: number) => (n > 0 ? Math.floor(Math.random() * n) : 0);

// ------------ Public entry ------------
export async function runDetectMentions(
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    dbLog: boolean;
    origin: string;
  },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly, dbLog } = params;

  const raw = screen_name.trim().replace(/^@+/, "");
  const isAll = raw === "*" || raw.toLowerCase() === "all";
  const handle = isAll ? null : raw.toLowerCase();

  log({ event: "start", handle: handle ?? "*", days, missingOnly });

  // Time window [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // Load candidate tweets (newest first)
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
            eq(kolTweets.excluded, false),
          )
        : and(
            eq(kolTweets.twitterUsername, handle!),
            gte(kolTweets.publishDate, since),
            lt(kolTweets.publishDate, until),
            missingOnly ? eq(kolTweets.resolved, false) : sql`true`,
            eq(kolTweets.excluded, false),
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

  // 1) Extract raw mentions
  const minimal: MinimalTweet[] = tweets.map((t) => ({
    tweetId: t.tweetId,
    textContent: t.textContent,
  }));
  const { rows: extractedRows, stats } = await processTweetsToRows(
    minimal,
    log,
  );
  log({ event: "extracted_rows", count: extractedRows.length });

  // 2) Resolve to CA (ticker/phrase rules)
  const normalized = await normalizeRowsToCA(extractedRows, log);

  // 3) Keep only valid Solana addresses
  const caRows = normalized
    .map((r) => {
      const a = canonAddr(String(r.tokenKey || ""));
      return a ? { ...r, tokenKey: a } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  log({ event: "ca_rows", count: caRows.length });

  // 4) Ensure symbol/name for display and identity (strict mode)
  const finalRows = await ensureDisplayMeta(caRows, log);

  if (!finalRows.length) {
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

  // 5) Plan upsert for mentions
  const { existsMap, willInsert, willUpdate } = await planMentions(finalRows);

  // 6) Enrich + persist coin_ca_ticker provenance
  await enrichAndPersistCoinMeta(finalRows, params.origin, log);

  // 7) Upsert mentions in chunks
  await upsertMentions(finalRows, existsMap, dbLog, log);

  // 8) Mark processed tweets as resolved
  await markTweetsResolved(finalRows, log);

  log({
    event: "done",
    rows: finalRows.length,
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

// ------------ Internal helpers ------------

// Normalization helpers & unresolved recorder
const RESOLVE_NAME_DB_ONLY =
  (process.env.RESOLVE_NAME_DB_ONLY ?? "1").trim() !== "0";

const normTicker = (s: string) =>
  String(s || "")
    .replace(/^\$+/, "")
    .trim()
    .toUpperCase();

const stripCoinSuffix = (raw: string) =>
  String(raw || "")
    .replace(/\s+(coin|token)\b/gi, "")
    .trim();

async function recordUnresolved(opts: {
  kind: "ticker" | "phrase";
  rawValue: string;
  tweetId: string;
  triggerKey: string;
  reason: "resolver_miss" | "missing_meta";
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
      lastError: null,
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
        lastError: sql`null`,
        lastTweetId: sql`excluded.last_tweet_id`,
        lastTriggerKey: sql`excluded.last_trigger_key`,
        seenCount: sql`${tokenResolutionIssues.seenCount} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * DB-only phrase resolver (name/ticker from coin_ca_ticker).
 * Order: exact token_name -> exact token_ticker -> ILIKE token_name.
 */
async function resolvePhraseFromDBOnly(nameRaw: string) {
  const name = stripCoinSuffix(nameRaw);
  if (!name || name.length < 2) return null;

  const byName = await db
    .select()
    .from(coinCaTicker)
    .where(eq(coinCaTicker.tokenName, name))
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);
  if (byName.length) {
    const r = byName[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker ?? null,
      tokenName: r.tokenName ?? null,
      primaryPoolAddress: r.primaryPoolAddress ?? null,
    };
  }

  const t = normTicker(name);
  if (t) {
    const byTicker = await db
      .select()
      .from(coinCaTicker)
      .where(eq(coinCaTicker.tokenTicker, t))
      .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
      .limit(1);
    if (byTicker.length) {
      const r = byTicker[0]!;
      return {
        contractAddress: r.contractAddress,
        tokenTicker: r.tokenTicker ?? null,
        tokenName: r.tokenName ?? null,
        primaryPoolAddress: r.primaryPoolAddress ?? null,
      };
    }
  }

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
    };
  }

  return null;
}

// Types reused from detectEngine
type ExtractedRow = Awaited<
  ReturnType<typeof processTweetsToRows>
>["rows"][number];

type RowWithMeta = ExtractedRow & {
  meta?: {
    symbol?: string | null;
    tokenName?: string | null;
    primaryPoolAddress?: string | null;
    source?: "ticker" | "phrase" | "ca";
  };
};

// Resolve ticker/phrase -> CA (with unresolved recording)
async function normalizeRowsToCA(
  extracted: ExtractedRow[],
  log: (e: any) => void,
) {
  const rows: RowWithMeta[] = [];

  for (const r of extracted) {
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
        rows.push({
          ...r,
          tokenKey: hit.contractAddress,
          meta: {
            ...(r as RowWithMeta).meta,
            symbol: hit.tokenTicker || null,
            tokenName: hit.tokenName || null,
            source: "ticker",
          },
        });
        continue;
      }
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
      rows.push(r as RowWithMeta);
      continue;
    }

    if (r.source === "phrase") {
      const rawPhrase = (r.tokenDisplay || r.tokenKey || "").trim();
      const cleaned = stripCoinSuffix(rawPhrase);

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
        rows.push({
          ...r,
          tokenKey: dbHit.contractAddress,
          meta: {
            ...(r as RowWithMeta).meta,
            symbol: dbHit.tokenTicker || null,
            tokenName: dbHit.tokenName || null,
            primaryPoolAddress: dbHit.primaryPoolAddress || null,
            source: "phrase",
          },
        });
        continue;
      }

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
        rows.push(r as RowWithMeta);
        continue;
      }

      // If RESOLVE_NAME_DB_ONLY=0, you can add a GT-based phrase resolver here.
      rows.push(r as RowWithMeta);
      continue;
    }

    // 'ca' or other sources
    rows.push(r as RowWithMeta);
  }

  return rows;
}

// Ensure every row has {symbol, tokenName} and normalized tokenDisplay
async function ensureDisplayMeta(caRows: RowWithMeta[], log: (e: any) => void) {
  const finalRows: RowWithMeta[] = [];

  for (const r of caRows) {
    let symbol = r.meta?.symbol ?? null;
    let tokenName = r.meta?.tokenName ?? null;
    let primaryPoolAddress = r.meta?.primaryPoolAddress ?? null;

    if (!symbol || !tokenName) {
      const meta = await resolveCAtoMeta(r.tokenKey).catch(() => null);
      if (!meta || !meta.symbol || !meta.tokenName) {
        if (r.source === "ticker" || r.source === "phrase") {
          await recordUnresolved({
            kind: r.source,
            rawValue: r.tokenDisplay || r.tokenKey || "",
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
        continue;
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

  return finalRows;
}

// Prepare upsert plan for mentions
async function planMentions(finalRows: RowWithMeta[]) {
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

  return { existsMap, willInsert, willUpdate };
}

// Enrich coin_ca_ticker by calling /api/mintmeta (cheap) and upsert provenance
async function enrichAndPersistCoinMeta(
  finalRows: RowWithMeta[],
  origin: string,
  log: (e: any) => void,
) {
  // Build CA → identity map for inserts
  const caIdentity = new Map<string, BasicIdentity>();
  for (const r of finalRows) {
    const sym = r.meta?.symbol;
    const name = r.meta?.tokenName;
    if (sym && name) {
      caIdentity.set(r.tokenKey, {
        symbol: sym,
        tokenName: name,
        primaryPoolAddress: r.meta?.primaryPoolAddress ?? null,
      });
    }
  }

  // Unique CAs
  const cas = Array.from(new Set(finalRows.map((r) => r.tokenKey)));

  for (let i = 0; i < cas.length; i += MINTMETA_CONCURRENCY) {
    const batch = cas.slice(i, i + MINTMETA_CONCURRENCY);
    log({
      event: "ca_meta_batch_begin",
      offset: i,
      size: batch.length,
      total: cas.length,
      concurrency: MINTMETA_CONCURRENCY,
    });
    await Promise.all(
      batch.map(async (ca) => {
        try {
          const m = await fetchMintMeta(origin, ca, {
            tz: "UTC",
            strategy: "cheap",
            max: 1000,
          });

          const creatorAddr =
            (m.creators && m.creators.length ? m.creators[0]!.address : null) ??
            m.updateAuthority ??
            null;

          const mintedAt =
            typeof m.mintedAt === "number" && m.mintedAt > 0
              ? new Date(m.mintedAt * 1000)
              : null;

          const hasMint =
            typeof m.hasMintAuthority === "boolean"
              ? m.hasMintAuthority
              : Boolean(m.mintAuthority);

          const hasFreeze =
            typeof m.hasFreezeAuthority === "boolean"
              ? m.hasFreezeAuthority
              : Boolean(m.freezeAuthority);

          const status = await upsertCoinCaProvenance(
            ca,
            caIdentity.get(ca) ?? null,
            {
              mintAuthority: m.mintAuthority ?? null,
              freezeAuthority: m.freezeAuthority ?? null,
              hasMintAuth: hasMint,
              hasFreezeAuth: hasFreeze,
              mintedAt,
              creatorAddress: creatorAddr,
              updateAuthority: m.updateAuthority ?? null,
            },
          );

          log({ event: "ca_meta_" + status, addr: ca, hasMint, hasFreeze });
        } catch (e: any) {
          log({
            event: "ca_meta_error",
            addr: ca,
            message: e?.message || String(e),
          });
        }
      }),
    );
    log({
      event: "ca_meta_batch_end",
      offset: i,
      size: batch.length,
      total: cas.length,
    });
    if (MINTMETA_SLEEP_MS > 0) {
      await sleep(MINTMETA_SLEEP_MS + jitter(MINTMETA_JITTER_MS));
    }
  }
}

// Upsert tweet_token_mentions in chunks + log plan
async function upsertMentions(
  finalRows: RowWithMeta[],
  existsMap: Map<string, string>,
  dbLog: boolean,
  log: (e: any) => void,
) {
  const CHUNK = 200;

  for (let i = 0; i < finalRows.length; i += CHUNK) {
    const chunk = finalRows.slice(i, i + CHUNK).map((r) => ({
      tweetId: r.tweetId,
      tokenKey: r.tokenKey,
      tokenDisplay: r.tokenDisplay,
      confidence: r.confidence,
      source: r.source as (typeof mentionSource.enumValues)[number],
      triggerKey: r.triggerKey,
      triggerText: r.triggerText,
    }));

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
}

// Mark tweets as resolved (those that produced at least one final row)
async function markTweetsResolved(
  finalRows: RowWithMeta[],
  log: (e: any) => void,
) {
  const processedTweetIds = Array.from(
    new Set(finalRows.map((r) => r.tweetId)),
  );
  if (!processedTweetIds.length) return;

  await db
    .update(kolTweets)
    .set({ resolved: true, updatedAt: new Date() })
    .where(inArray(kolTweets.tweetId, processedTweetIds));

  log({
    event: "tweets_resolved",
    count: processedTweetIds.length,
    sample: processedTweetIds.slice(0, 20),
  });
}
