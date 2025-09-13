// app/api/kols/detect-mentions/batch/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { resolveTickerToCA, resolvePhraseToCA } from "@/lib/tokens/resolve";
import { canonAddr } from "@/lib/chains/address";
import {
  and,
  or,
  eq,
  lt,
  gte,
  desc,
  inArray,
  sql,
  isNull,
  asc,
} from "drizzle-orm";
import { processTweetsToRows } from "@/lib/kols/detectEngine";
import {
  listTopPoolsByToken,
  priceAtTsWithFallbacks,
} from "@/lib/pricing/geckoterminal";

/* ========================= Runtime ========================= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Route identifier for ops scripts parity */
const ROUTE_ID = "/api/kols/detect-mentions/batch";

/* ========================= Auth ========================= */
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

/* ========================= Query schema ========================= */
const Q = z.object({
  screen_name: z.string().min(1).default("*"),
  days: z.coerce.number().int().min(1).max(30).default(14),
  missingOnly: z
    .union([
      z.literal("1"),
      z.literal("0"),
      z.literal("true"),
      z.literal("false"),
    ])
    .optional()
    .transform((v) => (v == null ? true : v === "1" || v === "true")),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(),
  stream: z.union([z.literal("1"), z.literal("true")]).optional(),

  // price fill knobs
  fill_prices: z.union([z.literal("1"), z.literal("true")]).optional(),
  price_try_pools: z.coerce.number().int().min(1).max(5).default(3),
  price_grace_seconds: z.coerce.number().int().min(0).max(600).default(90),
});

/* ========================= Cursor helpers ========================= */
type Cursor = { ts: string; id: string };
function encCursor(c: Cursor) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
function decCursor(s?: string): Cursor | null {
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof j?.ts === "string" && typeof j?.id === "string")
      return j as Cursor;
  } catch {}
  return null;
}

/* ========================= Global price fill (sweep) ========================= */

const NET_KEY = "solana";

// ↓↓↓ lower default concurrency to avoid 429
const GT_CONCURRENCY = Math.max(
  1,
  Number(process.env.DETECT_BATCH_PRICE_CONCURRENCY ?? 2),
);

// ---- In-pass caches ----
type PoolInfo = {
  address: string;
  dexId?: string;
  reservesUsd?: number;
  volume24h?: number;
};
type PoolsCache = Map<string, PoolInfo[]>; // tokenKey -> pools
type PriceCache = Map<string, number | null>; // `${pool}:${minuteTs}` -> price

function minuteKey(tsSec: number) {
  // one price per minute per pool is enough for our backfill
  return Math.floor(tsSec / 60) * 60;
}

/**
 * Try to fill price for a single mention row (by tokenKey + publishedAt).
 * It looks up top pools for the token and queries OHLCV; memoized by minute.
 */
async function fillOnePrice(
  row: {
    mentionId: string;
    tweetId: string;
    tokenKey: string;
    publishedAt: Date;
  },
  opts: {
    tryPools: number;
    graceSeconds: number;
    log: (e: any) => void;
    poolsCache: PoolsCache;
    priceCache: PriceCache;
  },
) {
  const { tryPools, graceSeconds, log, poolsCache, priceCache } = opts;
  const ts = Math.floor(row.publishedAt.getTime() / 1000);

  // fresh guard
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - ts < Math.max(0, graceSeconds)) {
    log({ event: "price_skip", id: row.mentionId, why: "too-fresh" });
    return false;
  }

  // resolve pools with per-pass cache
  let pools = poolsCache.get(row.tokenKey);
  if (!pools) {
    try {
      pools = await listTopPoolsByToken(NET_KEY, row.tokenKey, tryPools);
      poolsCache.set(row.tokenKey, pools);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/HTTP\s+404/.test(msg)) {
        log({
          event: "price_skip",
          id: row.mentionId,
          why: "no-pools",
          tokenKey: row.tokenKey,
          network: NET_KEY,
        });
        return false;
      }
      log({ event: "price_err_pools", id: row.mentionId, message: msg });
      return false;
    }
  }
  if (!pools?.length) {
    log({
      event: "price_skip",
      id: row.mentionId,
      why: "no-pools",
      tokenKey: row.tokenKey,
      network: NET_KEY,
    });
    return false;
  }
  log({ event: "price_candidates", id: row.mentionId, pools });

  // try OHLCV with (pool, minute) cache
  const mKey = minuteKey(ts);
  for (const p of pools) {
    const cacheKey = `${p.address}:${mKey}`;
    if (priceCache.has(cacheKey)) {
      const cached = priceCache.get(cacheKey)!;
      if (cached != null) {
        await db
          .update(tweetTokenMentions)
          .set({ priceUsdAt: String(Number(cached).toFixed(8)) })
          .where(eq(tweetTokenMentions.id, row.mentionId));
        log({
          event: "price_filled",
          id: row.mentionId,
          pool: p.address,
          ts,
          price: cached,
          cached: true,
        });
        return true;
      }
      // cached null → skip this pool quickly
      continue;
    }

    try {
      const price = await priceAtTsWithFallbacks(NET_KEY, p.address, ts);
      priceCache.set(cacheKey, price ?? null);

      if (Number.isFinite(price)) {
        await db
          .update(tweetTokenMentions)
          .set({ priceUsdAt: String(Number(price).toFixed(8)) })
          .where(eq(tweetTokenMentions.id, row.mentionId));
        log({
          event: "price_filled",
          id: row.mentionId,
          pool: p.address,
          ts,
          price,
          cached: false,
        });
        return true;
      }
    } catch (e: any) {
      log({
        event: "price_err_ohlcv",
        id: row.mentionId,
        pool: p.address,
        message: e?.message || String(e),
      });
    }
  }
  log({ event: "price_fail", id: row.mentionId, ts, tokenKey: row.tokenKey });
  return false;
}

/** Sweep pass to fill prices for existing rows with NULL priceUsdAt. */
async function fillPricesGlobalPass(
  params: { limit: number; tryPools: number; graceSeconds: number },
  log: (e: any) => void,
) {
  // pick a batch of mentions with null price, ordered by tweet publish time asc
  const rows = await db
    .select({
      mentionId: tweetTokenMentions.id,
      tweetId: tweetTokenMentions.tweetId,
      tokenKey: tweetTokenMentions.tokenKey,
      publishedAt: kolTweets.publishDate,
    })
    .from(tweetTokenMentions)
    .innerJoin(kolTweets, eq(kolTweets.tweetId, tweetTokenMentions.tweetId))
    .where(isNull(tweetTokenMentions.priceUsdAt))
    .orderBy(asc(kolTweets.publishDate), asc(tweetTokenMentions.id))
    .limit(params.limit);

  if (rows.length === 0) {
    log({ event: "price_fill_skip", reason: "no-null-prices" });
    return { filled: 0, scanned: 0, pickedTweets: 0 };
  }

  const byTweet = new Map<string, Date>();
  rows.forEach((r) => byTweet.set(r.tweetId, r.publishedAt));
  log({
    event: "price_global_start",
    tweetIds: byTweet.size,
    pick: params.limit,
  });

  // per-pass caches
  const poolsCache: PoolsCache = new Map();
  const priceCache: PriceCache = new Map();

  // simple concurrency workers
  let filled = 0;
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= rows.length) break;
      const r = rows[idx];
      const ok = await fillOnePrice(r, {
        tryPools: params.tryPools,
        graceSeconds: params.graceSeconds,
        log,
        poolsCache,
        priceCache,
      });
      if (ok) filled++;
    }
  }
  const workers = Array.from({ length: GT_CONCURRENCY }, () => worker());
  await Promise.all(workers);
  log({ event: "price_global_done", filled, scanned: rows.length });
  return { filled, scanned: rows.length, pickedTweets: byTweet.size };
}

/* ========================= Core - one page ========================= */
async function runDetectPage(
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    limit: number;
    cursor?: string;
    url: URL;
  },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly, limit, cursor, url } = params;

  const raw = screen_name.trim().replace(/^@+/, "");
  const isAll = raw === "*" || raw.toLowerCase() === "all";
  const handle = isAll ? null : raw.toLowerCase();

  const qs = Object.fromEntries(url.searchParams.entries());
  const fillPrices =
    /^(1|true)$/i.test(String(qs.fill_prices ?? "")) ||
    String(process.env.DETECT_BATCH_FILL_PRICES_DEFAULT ?? "true") === "true";
  const priceTryPools = Number(
    qs.price_try_pools ?? process.env.DETECT_BATCH_PRICE_TRY_POOLS ?? 3,
  );
  const priceGraceSeconds = Number(
    qs.price_grace_seconds ??
      process.env.DETECT_BATCH_PRICE_GRACE_SECONDS ??
      90,
  );
  const globalLimit = Math.max(
    1,
    Number(process.env.DETECT_BATCH_PRICE_GLOBAL_LIMIT ?? 200),
  );
  const maxPasses = Math.max(
    1,
    Number(process.env.DETECT_BATCH_PRICE_MAX_PASSES ?? 3),
  );
  const sleepMs = Math.max(
    0,
    Number(process.env.DETECT_BATCH_PRICE_SLEEP_MS ?? 0),
  );

  log({
    event: "start",
    routeId: ROUTE_ID,
    handle: handle ?? "*",
    days,
    missingOnly,
    limit,
    fillPrices,
    priceTryPools,
    priceGraceSeconds,
    globalLimit,
  });

  // time window
  const now = new Date();
  const until = now; // exclusive
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);

  // cursor (publishDate DESC, tweetId DESC)
  const c = decCursor(cursor || undefined);
  const cursorTs = c ? new Date(c.ts) : null;
  const cursorId = c?.id ?? null;

  const baseWhere = isAll
    ? and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until))
    : and(
        eq(kolTweets.twitterUsername, handle!),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      );

  const where = c
    ? and(
        baseWhere,
        or(
          lt(kolTweets.publishDate, cursorTs!),
          and(
            eq(kolTweets.publishDate, cursorTs!),
            lt(kolTweets.tweetId, cursorId!),
          ),
        ),
      )
    : baseWhere;

  const page = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(where)
    .orderBy(desc(kolTweets.publishDate), desc(kolTweets.tweetId))
    .limit(limit);

  log({ event: "loaded", count: page.length, until, since, limit });

  // filter if missingOnly
  let candidates = page;
  if (missingOnly) {
    const existing = await db
      .select({ tweetId: tweetTokenMentions.tweetId })
      .from(tweetTokenMentions)
      .where(
        inArray(
          tweetTokenMentions.tweetId,
          page.map((t) => t.tweetId),
        ),
      );
    const has = new Set(existing.map((e) => e.tweetId));
    candidates = page.filter((t) => !has.has(t.tweetId));
  }
  log({ event: "candidates", count: candidates.length });

  const { rows, stats } = await processTweetsToRows(
    candidates.map((t) => ({ tweetId: t.tweetId, textContent: t.textContent })),
    log,
  );

  // Normalize: resolve ticker/phrase -> CA and keep only valid Solana CAs
  const normalizedRows = await Promise.all(
    rows.map(async (r) => {
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
          return { ...r, tokenKey: hit.contractAddress };
        }
        log({
          event: "resolver_miss",
          kind: "ticker",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          token,
        });
        return r;
      }
      if (r.source === "phrase") {
        const phrase = (r.tokenDisplay || r.tokenKey || "").trim();
        log({
          event: "resolver_try",
          kind: "phrase",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          phrase,
        });
        const hit = await resolvePhraseToCA(phrase).catch(() => null);
        if (hit?.contractAddress) {
          log({
            event: "resolver_hit",
            kind: "phrase",
            tweetId: r.tweetId,
            triggerKey: r.triggerKey,
            addr: hit.contractAddress,
            tokenTicker: hit.tokenTicker ?? null,
            tokenName: hit.tokenName ?? null,
          });
          return { ...r, tokenKey: hit.contractAddress };
        }
        log({
          event: "resolver_miss",
          kind: "phrase",
          tweetId: r.tweetId,
          triggerKey: r.triggerKey,
          phrase,
        });
        return r;
      }
      return r; // 'ca' passthrough
    }),
  );

  // FINAL DEFENSE: only keep mentions with a valid Solana contract address
  const caRows = normalizedRows
    .map((r) => {
      const a = canonAddr(String(r.tokenKey || ""));
      return a ? { ...r, tokenKey: a } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  log({ event: "ca_rows", count: caRows.length });

  const last = page[page.length - 1];
  const nextCursor = last
    ? encCursor({ ts: last.published.toISOString(), id: last.tweetId })
    : null;

  if (!caRows.length) {
    // Nothing to insert/update on this page; optionally run price fill sweep
    if (fillPrices) {
      log({
        event: "price_fill_start",
        tweetIds: page.length,
        tryPools: priceTryPools,
        network: NET_KEY,
        graceSeconds: priceGraceSeconds,
      });
      let pass = 0;
      while (pass < maxPasses) {
        pass++;
        const { filled, scanned } = await fillPricesGlobalPass(
          {
            limit: globalLimit,
            tryPools: priceTryPools,
            graceSeconds: priceGraceSeconds,
          },
          log,
        );
        if (scanned < globalLimit || filled === 0) break;
        if (sleepMs) await new Promise((r) => setTimeout(r, sleepMs));
      }
      log({ event: "price_fill_done_page" });
    }
    return {
      routeId: ROUTE_ID,
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: stats.scannedTweets,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
      nextCursor,
    };
  }

  // Upsert planning based on CA rows only
  const tweetIds = Array.from(new Set(caRows.map((r) => r.tweetId)));
  const triggers = Array.from(new Set(caRows.map((r) => r.triggerKey)));
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
  const willInsert = caRows.filter(
    (r) => !existsMap.has(`${r.tweetId}___${r.triggerKey}`),
  ).length;
  const willUpdate = caRows.filter((r) => {
    const prev = existsMap.get(`${r.tweetId}___${r.triggerKey}`);
    return prev && prev !== r.tokenKey;
  }).length;

  log({
    event: "upsert_planning",
    rows: caRows.length,
    willInsert,
    willUpdate,
  });

  // Upsert by chunks
  const CHUNK = 200;
  for (let i = 0; i < caRows.length; i += CHUNK) {
    const chunk = caRows.slice(i, i + CHUNK).map((r) => ({
      tweetId: r.tweetId,
      tokenKey: r.tokenKey, // final CA
      tokenDisplay: r.tokenDisplay,
      confidence: r.confidence,
      source: r.source as (typeof mentionSource.enumValues)[number],
      triggerKey: r.triggerKey,
      triggerText: r.triggerText,
    }));

    // Per-row action plan for logging
    const actions = chunk.map((r) => {
      const key = `${r.tweetId}___${r.triggerKey}`;
      const prev = existsMap.get(key);
      if (!prev) return { ...r, action: "insert" as const, prev: null };
      if (prev !== r.tokenKey) return { ...r, action: "update" as const, prev };
      return { ...r, action: "noop" as const, prev };
    });
    log({
      event: "db_chunk_plan",
      i,
      size: chunk.length,
      inserts: actions.filter((a) => a.action === "insert").length,
      updates: actions.filter((a) => a.action === "update").length,
      noops: actions.filter((a) => a.action === "noop").length,
    });

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
      inserts: actions.filter((a) => a.action === "insert").length,
      updates: actions.filter((a) => a.action === "update").length,
    });
  }

  // Mark tweets with at least one CA mention as resolved
  const processedTweetIds = Array.from(new Set(caRows.map((r) => r.tweetId)));
  if (processedTweetIds.length) {
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

  return {
    routeId: ROUTE_ID,
    ok: true,
    handle: handle ?? "*",
    days,
    scannedTweets: stats.scannedTweets,
    mentionsDetected: caRows.length,
    inserted: willInsert,
    updated: willUpdate,
    nextCursor,
  };
}

/* ========================= GET / POST ========================= */
export async function GET(req: Request) {
  if (!allowByCronSecret(req)) {
    return NextResponse.json(
      { routeId: ROUTE_ID, ok: false, error: "forbidden" },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const q = Q.parse(Object.fromEntries(url.searchParams.entries()));
  const wantStream = !!q.stream;

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          write({ event: "hello", routeId: ROUTE_ID, ts: Date.now() });
          (async () => {
            try {
              const result = await runDetectPage(
                {
                  screen_name: q.screen_name,
                  days: q.days,
                  missingOnly: q.missingOnly,
                  limit: q.limit,
                  cursor: q.cursor,
                  url,
                },
                write,
              );
              write({ event: "result", routeId: ROUTE_ID, result });
              controller.close();
            } catch (e: any) {
              write({
                event: "error",
                routeId: ROUTE_ID,
                message: e?.message || String(e),
              });
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

  const result = await runDetectPage({ ...q, url }, () => {});
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!allowByCronSecret(req)) {
    return NextResponse.json(
      { routeId: ROUTE_ID, ok: false, error: "forbidden" },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const qs = Object.fromEntries(url.searchParams.entries());

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Support stream flag from either query or body for convenience
  const isStream =
    qs.stream === "1" ||
    qs.stream === "true" ||
    body.stream === true ||
    body.stream === "1" ||
    body.stream === "true";

  const parsed = {
    screen_name: String(body.screen_name ?? qs.screen_name ?? "*"),
    days: Number(body.days ?? qs.days ?? 14),
    missingOnly:
      body.missingOnly ?? /^(1|true)$/i.test(String(qs.missingOnly ?? "true")),
    limit: Number(body.limit ?? qs.limit ?? 200),
    cursor: String(body.cursor ?? qs.cursor ?? "") || undefined,
  };

  if (isStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          write({ event: "hello", routeId: ROUTE_ID, ts: Date.now() });
          (async () => {
            try {
              const result = await runDetectPage({ ...parsed, url }, write);
              write({ event: "result", routeId: ROUTE_ID, result });
              controller.close();
            } catch (e: any) {
              write({
                event: "error",
                routeId: ROUTE_ID,
                message: e?.message || String(e),
              });
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

  const result = await runDetectPage({ ...parsed, url }, () => {});
  return NextResponse.json(result);
}
