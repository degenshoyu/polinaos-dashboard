// lib/pricing/mentionMax.ts
// Compute per-mention max price since t0 using GeckoTerminal OHLCV.
// Adds rate limit handling: pacing + exponential backoff retry.
// Minute-patch is best-effort — if 429 persists, we degrade to day-only.

import {
  fetchOHLCVDay,
  fetchOHLCVMinute,
  listTopPoolsByToken,
} from "@/lib/pricing/geckoterminal";
import type { Ohlcv as OhlcvCandle } from "@/lib/pricing/geckoterminal";

// ----------------------------- Types -----------------------------

/** Minimal DB shape the caller should provide (joined with kol_tweets to get publishDate). */
export type MentionRow = {
  id: string; // tweet_token_mentions.id
  tokenKey: string; // normalized contract address (CA)
  publishDate: string; // ISO string from kol_tweets.publish_date
};

export type MaxPair = { maxPrice: number | null; maxAt: Date | null };

export type FetchOptions = {
  /** Use only the best-ranked pool ("primary") or merge top 3 pools and take the global max ("top3"). */
  poolMode?: "primary" | "top3";
  /** Filter out candles with tiny volume spikes. 0 disables filtering. */
  minVolume?: number;
  /** Patch minute candles for t0-day remainder and today to better catch intraday spikes. */
  minutePatch?: boolean;
  /** Force network name if known (e.g. "solana" | "ethereum"). If omitted, we infer from CA format. */
  network?: string;
  /** Minute aggregation for GT minute OHLCV. Default 15 (i.e., 15m bars). */
  minuteAgg?: number;
};

// ----------------------------- Rate limit helpers -----------------------------

const DEFAULT_NETWORK = process.env.GT_DEFAULT_NETWORK ?? "solana";

/**
 * Global pacing to keep RPS low even when caller uses concurrency.
 * With 1 worker, SPACING_MS≈450ms ~= 2.2 req/s total across all GT endpoints.
 * Adjust if你们有自己的全局限速器。
 */
const SPACING_MS = Number(process.env.GT_PACING_MS ?? 450);

/** Exponential backoff baseline (ms) and attempts. */
const RETRY_BASE_MS = Number(process.env.GT_RETRY_BASE_MS ?? 800);
const RETRY_MAX = Number(process.env.GT_RETRY_MAX ?? 5);

/** Simple jitter in [0,base). */
const jitter = (base: number) => Math.floor(Math.random() * base);

/** Sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Global simple pacer (coarse, process-wide). */
let lastCallAt = 0;
async function pace() {
  const now = Date.now();
  const wait = lastCallAt + SPACING_MS - now;
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

/** Detect GT 429 from error object/text */
function is429(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  if (msg.includes("HTTP 429")) return true;
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  return status === 429;
}

/** Parse Retry-After seconds if present in error; fallback to null */
function retryAfterMs(err: any): number | null {
  const v =
    err?.response?.headers?.["retry-after"] ??
    err?.headers?.["retry-after"] ??
    err?.retryAfter ??
    null;
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Wrap a GT call with pacing + exponential backoff on 429 */
async function gtCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      await pace();
      return await fn();
    } catch (err) {
      if (!is429(err)) throw err; // non-429: bubble up
      const ra = retryAfterMs(err);
      const base = ra ?? RETRY_BASE_MS * Math.pow(2, attempt - 1);
      const waitMs = base + jitter(250);
      // Optional: you可以在此处接入日志上报
      await sleep(waitMs);
    }
  }
  // 最后一次再执行，若失败就抛
  await pace();
  return await fn();
}

// ----------------------------- Utils -----------------------------

const nowSec = () => Math.floor(Date.now() / 1000);
const startOfDaySec = (ts: number) => Math.floor(ts / 86400) * 86400;

/** Heuristic network inference if not provided by caller. */
function inferNetworkFromCA(ca: string): string {
  return ca?.startsWith("0x") ? "ethereum" : DEFAULT_NETWORK;
}

/** Binary search: first index i where arr[i] >= t0Sec. */
function lowerBound(arr: number[], t0Sec: number) {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < t0Sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Build suffix maxima (max high, tie-broken by latest timestamp) for ascending candles. */
function buildSuffixMax(candles: OhlcvCandle[]) {
  const n = candles.length;
  const best: Array<{ h: number; ts: number }> = new Array(n);
  let curH = -Infinity;
  let curTs = 0;
  for (let i = n - 1; i >= 0; i--) {
    const ts = candles[i][0]!;
    const h = candles[i][2]!;
    if (h > curH || (h === curH && ts > curTs)) {
      curH = h;
      curTs = ts;
    }
    best[i] = { h: curH, ts: curTs };
  }
  const tsArr = candles.map((c) => c[0]!);
  return { tsArr, best };
}

/** Merge day + minute arrays, ascending, with optional volume filter. */
function mergeAndFilter(
  day: OhlcvCandle[],
  minute: OhlcvCandle[] | null,
  minVolume = 0,
): OhlcvCandle[] {
  const merged = minute && minute.length ? [...day, ...minute] : [...day];
  merged.sort((a, b) => a[0]! - b[0]!);
  return minVolume > 0
    ? merged.filter((c) => (c[5] ?? 0) >= minVolume)
    : merged;
}

// ------------------------- OHLCV fetching ------------------------

/**
 * Fetch an OHLCV span for a given pool set covering [tStartSec, now]:
 * - Paginates daily candles backwards using `before_timestamp`
 * - Optionally patches minute candles for (t0-day remainder) and (today)
 * - All GT calls are wrapped with gtCall() => pacing + backoff
 */
async function fetchOhlcvSpanForPools(
  network: string,
  poolIds: string[],
  tStartSec: number,
  minutePatch: boolean,
  minVolume: number,
  minuteAgg: number,
): Promise<OhlcvCandle[]> {
  const dayAll: OhlcvCandle[] = [];
  const minAll: OhlcvCandle[] = [];

  for (const poolId of poolIds) {
    // Backward pagination on day candles until tStartSec is covered
    let cursor = nowSec() + 86400; // push a bit beyond "today" to ensure inclusion
    const limit = 200;
    let guard = 0;
    while (guard++ < 60) {
      const batch = await gtCall("ohlcv_day", () =>
        fetchOHLCVDay(network, poolId, cursor, limit),
      );
      if (!batch.length) break;
      dayAll.push(...batch);
      const oldest = batch[0][0]!;
      if (oldest <= tStartSec) break;
      cursor = oldest - 1; // continue further back
    }

    if (minutePatch) {
      // Patch minute candles for edges; if 429 persists we degrade silently to day-only.
      const t0DayEnd = startOfDaySec(tStartSec) + 86400;
      const todayEnd = nowSec() + 60;
      const perDayBars = Math.ceil(1440 / Math.max(1, minuteAgg)); // 96 when minuteAgg=15

      try {
        const m1 = await gtCall("ohlcv_min_t0_day", () =>
          fetchOHLCVMinute(network, poolId, t0DayEnd, perDayBars, minuteAgg),
        );
        if (m1?.length) minAll.push(...m1);
      } catch {
        // degrade
      }

      try {
        const m2 = await gtCall("ohlcv_min_today", () =>
          fetchOHLCVMinute(network, poolId, todayEnd, perDayBars, minuteAgg),
        );
        if (m2?.length) minAll.push(...m2);
      } catch {
        // degrade
      }
    }
  }

  return mergeAndFilter(dayAll, minAll, minVolume);
}

/** Select pools to use according to poolMode. */
async function selectPools(
  network: string,
  tokenCA: string,
  mode: "primary" | "top3",
): Promise<string[]> {
  // listTopPoolsByToken can itself hit 429; wrap it.
  const pools = await gtCall("list_pools", () =>
    listTopPoolsByToken(network, tokenCA, 3),
  );
  if (!pools?.length) return [];
  if (mode === "top3") return pools.slice(0, 3).map((p) => p.address);
  return [pools[0]!.address];
}

// ------------------------- Public API ----------------------------

/**
 * Compute (max price, when) since t0 for every mention of a given CA,
 * by fetching OHLCV once and answering each mention from a suffix maxima table.
 *
 * @param ca       normalized contract address
 * @param mentions mentions of this CA (must include publishDate)
 * @param opts     tuning knobs (poolMode/minVolume/minutePatch/network)
 */
export async function computeMaxPairsForCA(
  ca: string,
  mentions: MentionRow[],
  opts: FetchOptions = {},
): Promise<Map<string, MaxPair>> {
  const out = new Map<string, MaxPair>();
  if (!mentions?.length) return out;

  const poolMode = opts.poolMode ?? "primary";
  const minVolume = opts.minVolume ?? 0;
  const minutePatch = opts.minutePatch ?? true;
  const network = opts.network ?? inferNetworkFromCA(ca);
  const minuteAgg = opts.minuteAgg ?? 15;

  // 1) earliest t0 across mentions for this CA
  const earliest = mentions.reduce<number>((acc, m) => {
    const ts = Math.floor(new Date(m.publishDate).getTime() / 1000);
    return Math.min(acc, ts);
  }, Number.POSITIVE_INFINITY);

  // 2) choose pools
  const poolIds = await selectPools(network, ca, poolMode);
  if (!poolIds.length) {
    // No pools found -> null everything
    for (const m of mentions) out.set(m.id, { maxPrice: null, maxAt: null });
    return out;
  }

  // 3) fetch a single OHLCV span (day + optional minute patch), merged & filtered
  const candles = await fetchOhlcvSpanForPools(
    network,
    poolIds,
    earliest,
    minutePatch,
    minVolume,
    minuteAgg,
  );
  if (!candles.length) {
    for (const m of mentions) out.set(m.id, { maxPrice: null, maxAt: null });
    return out;
  }

  // 4) build suffix maxima once, answer each mention with a binary search
  const { tsArr, best } = buildSuffixMax(candles);
  for (const m of mentions) {
    const t0 = Math.floor(new Date(m.publishDate).getTime() / 1000);
    const j = lowerBound(tsArr, t0);
    if (j >= tsArr.length) {
      out.set(m.id, { maxPrice: null, maxAt: null });
      continue;
    }
    const { h, ts } = best[j];
    out.set(m.id, {
      maxPrice: Number.isFinite(h) ? h : null,
      maxAt: Number.isFinite(ts) ? new Date(ts * 1000) : null,
    });
  }

  return out;
}

/**
 * Convenience: compute pairs for multiple CAs in one go.
 * The caller groups mentions by CA; we iterate groups sequentially (or let the caller parallelize).
 */
export async function computeMaxPairsForGroups(
  groups: Map<string, MentionRow[]>,
  opts: FetchOptions = {},
): Promise<Map<string, MaxPair>> {
  const result = new Map<string, MaxPair>();
  for (const [ca, items] of groups) {
    const pairs = await computeMaxPairsForCA(ca, items, opts);
    for (const it of items) {
      result.set(it.id, pairs.get(it.id) ?? { maxPrice: null, maxAt: null });
    }
  }
  return result;
}
