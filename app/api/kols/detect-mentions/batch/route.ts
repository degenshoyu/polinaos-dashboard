// app/api/kols/detect-mentions/batch/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Batch detector & price backfill:
 * - Calls the same service as /api/kols/detect-mentions (runDetectMentions)
 * - Streams NDJSON with ISO timestamp (ts), unix time (t), and elapsedMs
 * - Periodic "progress" snapshots with totals, percents, and ETA
 * - After detection, backfills price per (tweetId, tokenKey) using shared lib
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runDetectMentions } from "@/lib/kols/detectMentionsService";
import { fillMentionPricesForTweet } from "@/lib/kols/fillMentionPrices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Input schema mirrors the single route, plus a few batch-only knobs. */
const Body = z.object({
  screen_name: z.string().min(1),
  days: z.number().int().min(1).max(30).optional().default(7),
  missingOnly: z.boolean().optional().default(true),
  dbLog: z.boolean().optional(), // we'll force true internally to collect pairs
  stream: z.boolean().optional().default(false),

  // Price backfill knobs (all optional)
  priceTryPools: z.number().int().min(1).max(8).optional().default(3),
  priceGraceSeconds: z.number().int().min(0).max(600).optional().default(90),
  priceConcurrency: z
    .number()
    .int()
    .min(1)
    .max(16)
    .optional()
    .default(Number(process.env.DETECT_BATCH_PRICE_CONCURRENCY ?? 4)),

  // Progress cadence (ms). Emits a "progress" event at most once per interval.
  progressEveryMs: z
    .number()
    .int()
    .min(250)
    .max(10000)
    .optional()
    .default(1500),
});

/** Allow m2m via CRON secret (query ?secret= or headers). */
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

type Pair = { tweetId: string; tokenKey: string };

function uniqPairs(pairs: Pair[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const p of pairs) {
    const key = `${String(p.tweetId)}:::${String(p.tokenKey).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tweetId: String(p.tweetId), tokenKey: String(p.tokenKey) });
  }
  return out;
}

/** Backfill prices using the shared lib (same logic as per-tweet route). */
async function fillPricesForPairs(
  pairsIn: Pair[],
  knobs: { tryPools: number; graceSeconds: number; concurrency: number },
  log: (e: any) => void,
) {
  const items = uniqPairs(pairsIn);
  if (!items.length) {
    log({ evt: "price_skip", reason: "no_pairs" });
    return { total: 0, ok: 0, updated: 0, processed: 0 };
  }

  const limit = Math.max(1, knobs.concurrency || 1);
  let i = 0;
  let ok = 0;
  let updated = 0;
  let processed = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      const it = items[idx];
      try {
        const res = await fillMentionPricesForTweet({
          tweetId: String(it.tweetId),
          tokenKey: String(it.tokenKey),
          network: "solana",
          tryPools: knobs.tryPools,
          graceSeconds: knobs.graceSeconds,
          debug: false,
        });
        processed++;
        if (res.ok) ok++;
        updated += res.updated || 0;
        log({
          evt: "price_row",
          tweetId: it.tweetId,
          tokenKey: it.tokenKey,
          ok: res.ok,
          updated: res.updated,
          price: res.price ?? null,
          poolAddress: res.poolAddress ?? null,
          reason: res.reason ?? null,
        });
      } catch (e: any) {
        processed++;
        log({
          evt: "price_row_error",
          tweetId: it.tweetId,
          tokenKey: it.tokenKey,
          message: e?.message || String(e),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  log({ evt: "price_done", pairs: items.length, ok, updated, processed });
  return { total: items.length, ok, updated, processed };
}

/** Stamp any event with ISO timestamp & elapsed time. */
function stamp(evt: string, payload: Record<string, any>, t0: number) {
  const now = Date.now();
  return {
    ts: new Date(now).toISOString(),
    t: now,
    elapsedMs: now - t0,
    evt,
    ...payload,
  };
}

/** Humanize milliseconds to a compact string like "3m12s" or "54s". */
function humanizeMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m <= 0) return `${sec}s`;
  return `${m}m${sec}s`;
}

/** ETA helper from processed/total and elapsed. Returns ms or null. */
function estimateEtaMs(
  processed: number,
  total: number,
  elapsedMs: number,
): number | null {
  if (total <= 0 || processed <= 0) return null;
  const rate = processed / Math.max(1, elapsedMs); // units per ms
  const remain = Math.max(0, total - processed);
  const eta = remain / Math.max(rate, 1e-9);
  return Number.isFinite(eta) ? Math.round(eta) : null;
}

/** Progress tracker fed by service events; emits periodic progress+ETA. */
function makeProgressTracker(t0: number, progressEveryMs: number) {
  const S = {
    phase: "start" as
      | "start"
      | "loading"
      | "extraction"
      | "resolution"
      | "persist"
      | "price"
      | "done",
    // tweet-level
    tweetsTotal: 0,
    tweetsSeenIds: new Set<string>(), // tweets that reached resolver/db phases
    tweetsResolved: 0,
    // row-level (mention candidates)
    rowsTotal: 0,
    resolverTried: 0,
    // db upsert stats
    dbInserts: 0,
    dbUpdates: 0,
    dbNoops: 0,
    dbChunks: 0,
    // price stage
    pricePairs: 0,
    priceProcessed: 0,
    priceUpdated: 0,
  };
  let lastEmit = 0;

  const onServiceEvent = (
    e: any,
    write: (evt: string, payload?: any) => void,
  ) => {
    const kind = e?.event || e?.evt;

    // Track tweet ids whenever we can see them in events
    const tw = String(e?.tweetId ?? "");
    if (tw) S.tweetsSeenIds.add(tw);

    switch (kind) {
      case "start":
        S.phase = "loading";
        break;
      case "loaded":
        S.tweetsTotal = Number(e.tweets ?? e.count ?? 0);
        S.phase = "extraction";
        break;
      case "extracted_rows":
        S.rowsTotal = Number(e.count ?? 0);
        S.phase = "resolution";
        break;
      case "resolver_try":
      case "resolver_db_try":
        S.resolverTried++;
        break;
      case "db_chunk_plan":
        S.phase = "persist";
        break;
      case "db_chunk_written":
        S.dbChunks++;
        S.dbInserts += Number(e.inserts ?? 0);
        S.dbUpdates += Number(e.updates ?? 0);
        S.dbNoops += Number(e.noops ?? 0);
        break;
      case "tweets_resolved":
        S.tweetsResolved += Number(e.count ?? 0);
        break;
      case "detect_done":
      case "done":
        S.phase = "price";
        break;
      case "price_start":
        S.phase = "price";
        S.pricePairs = Number(e.pairs ?? 0);
        break;
      case "price_row":
        S.priceProcessed += 1;
        S.priceUpdated += Number(e.updated ?? 0);
        break;
      case "price_row_error":
        S.priceProcessed += 1;
        break;
      case "price_done":
        // keep phase until "result"
        break;
      case "result":
        S.phase = "done";
        break;
      default:
        break;
    }

    // Emit periodic progress snapshot
    const now = Date.now();
    if (now - lastEmit >= progressEveryMs) {
      lastEmit = now;

      const tweetsProcessed = S.tweetsSeenIds.size; // tweets that hit resolution/persist pipeline
      const pctTweets =
        S.tweetsTotal > 0
          ? Math.min(
              100,
              Math.round((tweetsProcessed / S.tweetsTotal) * 1000) / 10,
            )
          : 0;

      const pctResolver =
        S.rowsTotal > 0
          ? Math.min(
              100,
              Math.round((S.resolverTried / S.rowsTotal) * 1000) / 10,
            )
          : 0;

      const pctPrice =
        S.pricePairs > 0
          ? Math.min(
              100,
              Math.round((S.priceProcessed / S.pricePairs) * 1000) / 10,
            )
          : 0;

      // ETA for resolution (row-based) and price phases
      const elapsedMs = now - t0;
      const etaResMs = estimateEtaMs(S.resolverTried, S.rowsTotal, elapsedMs);
      const etaPriceMs = estimateEtaMs(
        S.priceProcessed,
        S.pricePairs,
        elapsedMs,
      );

      write("progress", {
        phase: S.phase,
        // tweet-level progress (approx; tweets with no extracted rows won't count here)
        tweetsTotal: S.tweetsTotal,
        tweetsProcessed,
        pctTweets,
        tweetsResolved: S.tweetsResolved,
        // resolver progress
        rowsTotal: S.rowsTotal,
        resolverTried: S.resolverTried,
        pctResolver,
        etaResolverMs: etaResMs,
        etaResolver: humanizeMs(etaResMs),
        // db upsert
        dbInserts: S.dbInserts,
        dbUpdates: S.dbUpdates,
        dbNoops: S.dbNoops,
        dbChunks: S.dbChunks,
        // price progress
        pricePairs: S.pricePairs,
        priceProcessed: S.priceProcessed,
        priceUpdated: S.priceUpdated,
        pctPrice,
        etaPriceMs: etaPriceMs,
        etaPrice: humanizeMs(etaPriceMs),
      });
    }
  };

  return { onServiceEvent };
}

/** Shared executor for both GET and POST. */
async function execDetectAndPrice(req: Request, input: z.infer<typeof Body>) {
  // AuthZ identical to the single route
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
  const wantStream = wantStreamQuery || Boolean(input.stream);

  const t0 = Date.now();
  const encoder = new TextEncoder();

  // Force dbLog=true so we can capture db_row and compute exact pairs for pricing
  const svcParams = {
    screen_name: input.screen_name,
    days: input.days,
    missingOnly: input.missingOnly,
    dbLog: true,
    origin: url.origin,
  };

  // Collect (tweetId, tokenKey) pairs for price backfill
  const pairs: Pair[] = [];
  const { onServiceEvent } = makeProgressTracker(t0, input.progressEveryMs);

  if (wantStream) {
    return new Response(
      new ReadableStream({
        start(controller) {
          const writeRaw = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          const write = (evt: string, payload: any = {}) =>
            writeRaw(stamp(evt, payload, t0));

          // log proxy: forward service events, capture pairs, update progress
          const log = (e: any) => {
            if (e && e.event === "db_row") {
              const tweetId = String(e.tweetId ?? "");
              const tokenKey = String(e.nextTokenKey ?? e.tokenKey ?? "");
              if (tweetId && tokenKey) pairs.push({ tweetId, tokenKey });
            }
            // forward as-is (stamped)
            const evt = e?.event || e?.evt || "log";
            const payload = { ...e };
            delete (payload as any).event;
            write(evt, payload);

            // periodic progress
            onServiceEvent(e, write);
          };

          (async () => {
            try {
              write("hello");
              write("start", {
                handle: input.screen_name,
                days: input.days,
                missingOnly: input.missingOnly,
              });

              // Phase 1: detection (same pipeline as the single route)
              const result = await runDetectMentions(svcParams as any, log);
              write("detect_done", { result });

              // Phase 2: price backfill
              const pairsUniq = uniqPairs(pairs);
              write("price_start", {
                pairs: pairsUniq.length,
                tryPools: input.priceTryPools,
                graceSeconds: input.priceGraceSeconds,
                concurrency: input.priceConcurrency,
              });
              const priceTotals = await fillPricesForPairs(
                pairsUniq,
                {
                  tryPools: input.priceTryPools,
                  graceSeconds: input.priceGraceSeconds,
                  concurrency: input.priceConcurrency,
                },
                (e) => write(e.evt || "log", e),
              );

              write("result", { detect: result, price: priceTotals });
              controller.close();
            } catch (e: any) {
              write("error", { message: e?.message || String(e) });
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

  // Non-streaming: run detection silently, then price backfill
  const silentLog = (e: any) => {
    if (e && e.event === "db_row") {
      const tweetId = String(e.tweetId ?? "");
      const tokenKey = String(e.nextTokenKey ?? e.tokenKey ?? "");
      if (tweetId && tokenKey) pairs.push({ tweetId, tokenKey });
    }
  };

  const detectResult = await runDetectMentions(svcParams as any, silentLog);
  const priceTotals = await fillPricesForPairs(
    pairs,
    {
      tryPools: input.priceTryPools,
      graceSeconds: input.priceGraceSeconds,
      concurrency: input.priceConcurrency,
    },
    () => {},
  );
  return NextResponse.json({
    ok: true,
    detect: detectResult,
    price: priceTotals,
  });
}

/** GET: map query params into Body schema. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Body.parse({
    screen_name: url.searchParams.get("screen_name") ?? "",
    days: Number(url.searchParams.get("days") ?? "7"),
    missingOnly: /^(1|true)$/i.test(
      url.searchParams.get("missingOnly") ?? "true",
    ),
    dbLog: /^(1|true)$/i.test(url.searchParams.get("dbLog") ?? "false"),
    stream: /^(1|true)$/i.test(url.searchParams.get("stream") ?? "false"),
    priceTryPools: Number(url.searchParams.get("priceTryPools") ?? "3"),
    priceGraceSeconds: Number(
      url.searchParams.get("priceGraceSeconds") ?? "90",
    ),
    priceConcurrency: Number(
      url.searchParams.get("priceConcurrency") ??
        process.env.DETECT_BATCH_PRICE_CONCURRENCY ??
        "4",
    ),
    progressEveryMs: Number(url.searchParams.get("progressEveryMs") ?? "1500"),
  });
  return execDetectAndPrice(req, q);
}

/** POST: identical to the single route body + optional price knobs. */
export async function POST(req: Request) {
  const body = Body.parse(await req.json().catch(() => ({})));
  return execDetectAndPrice(req, body);
}
