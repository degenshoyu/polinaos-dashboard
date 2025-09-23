// lib/pricing/mentionMax.ts
// Compute max price since mention publish time (t0) using GeckoTerminal Public API.
// - Calls GT directly with correct query params (timeframe/aggregate/limit).
// - No auth required (per GT docs); add `accept: application/json` header.
// - Timestamps normalized to ms; robust pool selection; rich debug trace.

type AnyObj = Record<string, any>;

export type MentionRow = { id: string; publishDate: string | Date };
export type MaxPair = { maxPrice: number | null; maxAt: string | null };

export type FetchOptions = {
  network?: string; // e.g. "solana"
  poolMode?: "primary" | "top3"; // how to pick pools
  minVolume?: number; // USD 24h volume filter; default 0
  minutePatch?: boolean; // fetch minute candles as well
  minuteAgg?: number; // minute aggregate 1|5|15; default 15
  signal?: AbortSignal; // optional abort signal
  debug?: boolean | ((e: DebugEvent) => void); // debug sink or flag
};

export type DebugEvent = { tag: string; data?: any };

function makeDebugger(sink?: FetchOptions["debug"]) {
  const store: DebugEvent[] = [];
  const log = (e: DebugEvent) => {
    store.push(e);
    if (typeof sink === "function") sink(e);
  };
  return {
    log,
    attachTo<T extends object>(obj: T): T {
      Object.defineProperty(obj, "__debug", {
        value: store,
        enumerable: false,
        configurable: true,
      });
      return obj;
    },
    snapshot: () => store as DebugEvent[],
  };
}

export function extractDebug(
  map: Map<string, MaxPair>,
): DebugEvent[] | undefined {
  return (map as any).__debug;
}

/* ---------------------- time helpers ---------------------- */

function toTs(v: string | Date): number {
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  // numeric string: seconds vs milliseconds
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    return num < 1e12 ? num * 1000 : num;
  }
  // "YYYY-MM-DD HH:mm[:ss[.SSS]]" (UTC)
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(s)) {
    return Date.parse(s.replace(" ", "T") + "Z");
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function cTime(c: any): number {
  const v =
    c?.t ??
    c?.time ??
    c?.timestamp ??
    c?.ts ??
    (Array.isArray(c) ? c[0] : undefined);
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(String(v));
  return Number.isFinite(d) ? d : NaN;
}

function cClose(c: any): number {
  const v =
    c?.c ?? c?.close ?? c?.price ?? (Array.isArray(c) ? c[4] : undefined);
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function mergeCandles(...lists: any[][]): { t: number; c: number }[] {
  const out: { t: number; c: number }[] = [];
  for (const arr of lists) {
    for (const c of arr || []) {
      const t = cTime(c);
      const price = cClose(c);
      if (Number.isFinite(t) && Number.isFinite(price))
        out.push({ t, c: price });
    }
  }
  out.sort((a, b) => a.t - b.t);
  const dedup: { t: number; c: number }[] = [];
  let lastT = -1;
  for (const k of out) {
    if (k.t !== lastT) {
      dedup.push(k);
      lastT = k.t;
    }
  }
  return dedup;
}

/* ---------------------- pool helpers ---------------------- */

function pickPoolAddress(p: any): string | null {
  return (
    p?.address ||
    p?.pool_address ||
    p?.id ||
    p?.attributes?.address ||
    p?.attributes?.pool_address ||
    p?.attributes?.id ||
    null
  );
}

function numOr(x: any, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function poolMetrics(p: any) {
  const vol =
    numOr(p?.trade_volume_usd_24h, NaN) ??
    numOr(p?.volume_usd_24h, NaN) ??
    numOr(p?.volume_24h_usd, NaN);
  const volAlt = numOr(p?.volume24h, NaN);
  const liq = numOr(p?.liquidityUsd, NaN) ?? numOr(p?.liquidity_usd, NaN);
  const res = numOr(p?.reservesUsd, NaN) ?? numOr(p?.reserveUsd, NaN);
  const volumeUSD = Number.isFinite(vol)
    ? vol
    : Number.isFinite(volAlt)
      ? volAlt
      : 0;
  const liquidityUSD = Number.isFinite(liq)
    ? liq
    : Number.isFinite(res)
      ? res
      : 0;
  return { volumeUSD, liquidityUSD };
}

/* ---------------------- direct GT fetchers ---------------------- */
/** Normalizes GT ohlcv response to [{t, c}] in ms. */
function normalizeGT(resp: AnyObj): { t: number; c: number }[] {
  // GT public API returns shape { data: { attributes: { ohlcv_list: [[ts, o,h,l,c,v], ...] } } }
  const list: any[] = resp?.data?.attributes?.ohlcv_list ?? [];
  const out: { t: number; c: number }[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const tsSec = Number(row[0]);
    const close = Number(row[4]);
    if (Number.isFinite(tsSec) && Number.isFinite(close)) {
      out.push({ t: tsSec * 1000, c: close });
    }
  }
  return out;
}

async function gtFetchOHLCV(
  network: string,
  pool: string,
  timeframe: "minute" | "day" | "hour",
  params: {
    aggregate?: number; // 1|5|15 for minute; 1 for day
    limit?: number; // default 100, max 1000
    beforeSec?: number; // seconds since epoch
    signal?: AbortSignal;
  },
): Promise<{ t: number; c: number }[]> {
  const u = new URL(
    `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(
      pool,
    )}/ohlcv/${timeframe}`,
  );
  if (params.aggregate)
    u.searchParams.set("aggregate", String(params.aggregate));
  if (params.limit) u.searchParams.set("limit", String(params.limit));
  if (params.beforeSec)
    u.searchParams.set(
      "before_timestamp",
      String(Math.floor(params.beforeSec)),
    );
  // currency/token left as default "usd"/"base" per docs

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: {
      // GT public API example uses this header
      // https://apiguide.geckoterminal.com/getting-started
      accept: "application/json",
      "user-agent": "PolinaOS-Dashboard/1.0 (+https://github.com/)", // friendly UA
    },
    signal: params.signal,
    // Next.js fetch caches by default in RSC; we are in a server action/route context
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GT ${res.status} ${res.statusText} ${u.pathname}${u.search} :: ${text.slice(0, 200)}`,
    );
  }

  const json = await res.json().catch(() => ({}));
  return normalizeGT(json);
}

/* ---------------------- choose pools ---------------------- */

async function choosePools(
  network: string,
  ca: string,
  minVolume: number,
  mode: "primary" | "top3",
  dbg: (e: DebugEvent) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  // Lightweight pool discovery using GT /tokens/{ca}/pools
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
    network,
  )}/tokens/${encodeURIComponent(ca)}/pools?page=1`;
  let pools: any[] = [];
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
      cache: "no-store",
    });
    const j = await r.json();
    // Normalize both "data: []" and flat list forms
    pools = Array.isArray(j?.data)
      ? j.data.map((x: any) => x?.attributes ?? x)
      : Array.isArray(j)
        ? j
        : [];
  } catch {
    pools = [];
  }

  dbg({
    tag: "pools.list",
    data: {
      network,
      ca,
      count: pools?.length ?? 0,
      sample: (pools || []).slice(0, 3),
    },
  });

  const withMetrics = (pools || [])
    .map((p) => {
      const addr = String(pickPoolAddress(p) || "").trim();
      const m = poolMetrics(p);
      return { raw: p, addr, ...m };
    })
    .filter((x) => !!x.addr);

  const filtered = withMetrics.filter((x) => x.volumeUSD >= (minVolume || 0));
  dbg({
    tag: "pools.filtered",
    data: {
      minVolume,
      count: filtered.length,
      sample: filtered
        .slice(0, 3)
        .map((x) => ({ addr: x.addr, vol: x.volumeUSD, liq: x.liquidityUSD })),
    },
  });

  const candidates = filtered.length ? filtered : withMetrics;

  candidates.sort((a, b) => {
    if (a.volumeUSD !== b.volumeUSD) return b.volumeUSD - a.volumeUSD;
    return b.liquidityUSD - a.liquidityUSD;
  });

  const chosen = (
    mode === "top3" ? candidates.slice(0, 3) : candidates.slice(0, 1)
  ).map((x) => x.addr);
  dbg({ tag: "pools.chosen", data: { mode, addrs: chosen } });

  return Array.from(new Set(chosen));
}

/* ---------------------- core compute ---------------------- */

export async function computeMaxPairsForCA(
  ca: string,
  mentions: MentionRow[],
  opts: FetchOptions = {},
): Promise<Map<string, MaxPair>> {
  const dbg = makeDebugger(opts.debug);
  const network = opts.network || "solana";
  const poolMode = opts.poolMode || "primary";
  const minVolume = typeof opts.minVolume === "number" ? opts.minVolume : 0; // relax default
  const minutePatch = opts.minutePatch ?? true;
  const minuteAgg = opts.minuteAgg ?? 15;

  dbg.log({
    tag: "input.opts",
    data: { network, poolMode, minVolume, minutePatch, minuteAgg, ca },
  });
  dbg.log({ tag: "input.mentions", data: mentions });

  const metas = mentions
    .map((m) => ({ id: m.id, t0: toTs(m.publishDate) }))
    .filter((x) => Number.isFinite(x.t0));

  if (!metas.length) {
    const empty = new Map<string, MaxPair>();
    for (const m of mentions) empty.set(m.id, { maxPrice: null, maxAt: null });
    return dbg.attachTo(empty);
  }

  const tEarliest = Math.min(...metas.map((m) => m.t0));
  dbg.log({
    tag: "t0.window",
    data: {
      earliest: new Date(tEarliest).toISOString(),
      ids: metas.map((m) => ({ id: m.id, t0: new Date(m.t0).toISOString() })),
    },
  });

  const pools = await choosePools(
    network,
    ca,
    minVolume,
    poolMode,
    dbg.log,
    opts.signal,
  );
  if (!pools.length) {
    const out = new Map<string, MaxPair>();
    for (const m of mentions) out.set(m.id, { maxPrice: null, maxAt: null });
    dbg.log({
      tag: "exit.noPools",
      data: { reason: "no pools after volume/liquidity filter" },
    });
    return dbg.attachTo(out);
  }

  const nowMs = Date.now();

  // minute candles (latest N bars, aggregate = minuteAgg, no before_timestamp)
  let minutes: { t: number; c: number }[] = [];
  if (minutePatch) {
    try {
      const spanMs = nowMs + 60_000 - Math.max(tEarliest - 2 * 3600 * 1000, 0);
      const barsNeeded = Math.ceil(spanMs / (minuteAgg * 60_000));
      const limit = Math.max(50, Math.min(barsNeeded + 20, 1000)); // GT max 1000
      minutes = await gtFetchOHLCV(network, pools[0], "minute", {
        aggregate: minuteAgg,
        limit,
        signal: opts.signal,
      });
      dbg.log({
        tag: "candles.minute",
        data: {
          pool: pools[0],
          agg: minuteAgg,
          limit,
          count: minutes.length,
          headISO: minutes[0] ? new Date(minutes[0].t).toISOString() : null,
          tailISO: minutes[minutes.length - 1]
            ? new Date(minutes[minutes.length - 1].t).toISOString()
            : null,
        },
      });
    } catch (e: any) {
      dbg.log({
        tag: "candles.minute.error",
        data: { error: e?.message || String(e) },
      });
      minutes = [];
    }
  }

  // day candles (latest N days for each selected pool)
  const daySets: { t: number; c: number }[][] = [];
  const startDay = new Date(tEarliest);
  startDay.setUTCHours(0, 0, 0, 0);
  const fromDay = startDay.getTime() - 24 * 3600 * 1000;
  const toDay = nowMs + 24 * 3600 * 1000;
  const daysNeeded = Math.ceil((toDay - fromDay) / 86_400_000) + 2;
  const dayLimit = Math.max(7, Math.min(daysNeeded, 1000)); // GT max 1000

  for (const p of pools) {
    try {
      const arr = await gtFetchOHLCV(network, p, "day", {
        aggregate: 1,
        limit: dayLimit,
        signal: opts.signal,
      });
      daySets.push(arr);
      dbg.log({
        tag: "candles.day",
        data: {
          pool: p,
          limit: dayLimit,
          count: arr.length,
          headISO: arr[0] ? new Date(arr[0].t).toISOString() : null,
          tailISO: arr[arr.length - 1]
            ? new Date(arr[arr.length - 1].t).toISOString()
            : null,
        },
      });
    } catch (e: any) {
      dbg.log({
        tag: "candles.day.error",
        data: { pool: p, error: e?.message || String(e) },
      });
    }
  }

  const merged = mergeCandles(minutes, ...daySets);
  dbg.log({
    tag: "candles.merged",
    data: {
      count: merged.length,
      headISO: merged.length ? new Date(merged[0].t).toISOString() : null,
      tailISO: merged.length
        ? new Date(merged[merged.length - 1].t).toISOString()
        : null,
    },
  });

  const out = new Map<string, MaxPair>();
  for (const m of metas) {
    let bestPrice = NaN;
    let bestTime = NaN;
    for (const c of merged) {
      if (c.t >= m.t0 && Number.isFinite(c.c)) {
        if (!Number.isFinite(bestPrice) || c.c > bestPrice) {
          bestPrice = c.c;
          bestTime = c.t;
        }
      }
    }
    if (Number.isFinite(bestPrice) && Number.isFinite(bestTime)) {
      const at = new Date(bestTime).toISOString();
      out.set(m.id, { maxPrice: bestPrice, maxAt: at });
      dbg.log({
        tag: "result.mention",
        data: { id: m.id, maxPrice: bestPrice, maxAt: at },
      });
    } else {
      out.set(m.id, { maxPrice: null, maxAt: null });
      const after = merged.find((c) => c.t >= m.t0);
      dbg.log({
        tag: "result.mention.null",
        data: {
          id: m.id,
          reason:
            merged.length === 0
              ? "no candles at all"
              : after
                ? "candles after t0 exist but all close invalid/NaN"
                : "no candle with t >= t0",
          t0ISO: new Date(m.t0).toISOString(),
          mergedHeadISO: merged.length
            ? new Date(merged[0].t).toISOString()
            : null,
          mergedTailISO: merged.length
            ? new Date(merged[merged.length - 1].t).toISOString()
            : null,
          mergedCount: merged.length,
        },
      });
    }
  }

  // fill nulls for mentions failed to parse t0
  for (const m of mentions)
    if (!out.has(m.id)) out.set(m.id, { maxPrice: null, maxAt: null });

  return dbg.attachTo(out);
}

export async function computeMaxPairsForGroups(
  groups: Map<string, MentionRow[]>,
  opts: FetchOptions = {},
): Promise<Map<string, MaxPair>> {
  const result = new Map<string, MaxPair>();
  for (const [ca, items] of groups) {
    const pairs = await computeMaxPairsForCA(ca, items, opts);
    for (const it of items)
      result.set(it.id, pairs.get(it.id) ?? { maxPrice: null, maxAt: null });
  }
  return result;
}
