"use client";

/**
 * Price refresh queue with 10-min freshness:
 * - Always probe DB first to get existing price & timestamp.
 * - If the latest DB snapshot is within STALE_MS (10min), mark fresh and skip refresh.
 * - Otherwise, trigger server refresh (/api/coin-prices/refresh) to write DB,
 *   then read-back (/api/coin-prices) and mark fresh when confirmed.
 * - UI can blink until isDbFresh(ca) becomes true; if DB is already fresh (<=10min),
 *   we mark it fresh immediately so it won't blink at all.
 */

import * as React from "react";

type Job = { ca: string; network?: "solana" };
type PricesMap = Record<string, number>;
type FreshMap = Record<string, boolean>;

const STALE_MS = 10 * 60 * 1000; // 10 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// EVM addresses are case-insensitive → normalize to lowercase.
// Solana base58 addresses are case-sensitive → keep original casing.
const looksLikeEvm = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const normalizeCA = (s: string) => (looksLikeEvm(s) ? s.toLowerCase() : s);

/** DB snapshot shape for a CA */
type DbSnap = { price: number; priceAt: number; mc: number | null } | null;

/** GET latest DB snapshot for one CA. Returns null if not found. */
async function fetchDbSnapshot(caRaw: string): Promise<DbSnap> {
  const ca = normalizeCA(caRaw);
  try {
    const qs = new URLSearchParams({ addresses: ca });
    const r = await fetch(`/api/coin-prices?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;

    const j: any = await r.json().catch(() => ({}));
    const item = Array.isArray(j?.items)
      ? j.items.find((x: any) => String(x.contract_address) === ca)
      : null;

    if (!item) return null;
    const p = Number(item.price_usd);
    const mc = item.market_cap_usd == null ? null : Number(item.market_cap_usd);
    const t = Date.parse(item.price_at);
    if (!Number.isFinite(p) || Number.isNaN(t)) return null;
    return { price: p, priceAt: t, mc };
  } catch {
    return null;
  }
}

/** Call server refresh once: server fetches GT and writes DB, returns live price. */
async function serverRefreshOnce(caRaw: string): Promise<number | null> {
  const ca = normalizeCA(caRaw);
  try {
    const r = await fetch(
      `/api/coin-prices/refresh?${new URLSearchParams({ addresses: ca }).toString()}`,
      { cache: "no-store" },
    );
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => ({}));
    const row = Array.isArray(j?.items)
      ? j.items.find((x: any) => String(x.contract_address) === ca)
      : null;
    const n = Number(row?.price_usd);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** -------------------- Module-scope singleton stores -------------------- */
let pricesStore: PricesMap = {}; // latest known price shown in UI
let mcStore: PricesMap = {};
let dbFreshStore: FreshMap = {}; // true if confirmed fresh (either <=10min or read-back after refresh)
let updatingStore = false; // worker running flag
let totalStore = 0; // enqueue count
let doneStore = 0; // finished count

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}

/** FIFO queue + de-dup */
const queued = new Set<string>();
const inFlight = new Set<string>();
const queue: Job[] = [];

/** The worker processes queue items one-by-one with gentle pacing. */
async function runWorker(opts: {
  delayMin: number;
  delayMax: number;
  maxRetries: number;
}) {
  if (updatingStore) return;
  updatingStore = true;
  emit();

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      const caRaw = job.ca;
      const ca = normalizeCA(caRaw);
      inFlight.add(ca);
      emit();

      try {
        // 1) Probe DB first (to display whatever we already have)
        const snap = await fetchDbSnapshot(caRaw);
        const now = Date.now();
        if (snap) {
          pricesStore = { ...pricesStore, [ca]: Number(snap.price.toFixed(6)) };
          if (snap.mc != null) {
            mcStore = { ...mcStore, [ca]: Number(snap.mc) };
          }
          emit();
        }

        // 2) Freshness check: skip refresh if the snapshot is within STALE_MS
        const isFreshEnough = snap != null && now - snap.priceAt <= STALE_MS;
        if (isFreshEnough) {
          // Mark as fresh immediately so UI won't blink
          dbFreshStore = { ...dbFreshStore, [ca]: true };
          emit();
        } else {
          // 3) Trigger server refresh (fetch latest → write DB)
          const live = await serverRefreshOnce(caRaw);
          if (live != null) {
            // Show live price immediately for feedback
            pricesStore = { ...pricesStore, [ca]: Number(live.toFixed(6)) };
            emit();
          }

          // 4) Read-back from DB to confirm; mark as fresh on success
          let confirmed: DbSnap | null = null;
          for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
            const dbNow = await fetchDbSnapshot(caRaw);
            if (dbNow != null) {
              confirmed = dbNow;
              dbFreshStore = { ...dbFreshStore, [ca]: true };
              emit();
              break;
            }
            const backoff = clamp(500 * Math.pow(2, attempt), 500, 15000);
            await sleep(backoff);
          }

          if (confirmed != null) {
            pricesStore = {
              ...pricesStore,
              [ca]: Number(confirmed.price.toFixed(6)),
            };
            if (confirmed.mc != null) {
              mcStore = { ...mcStore, [ca]: Number(confirmed.mc) };
            }
            emit();
          }
        }
      } finally {
        doneStore += 1;
        inFlight.delete(ca);
        queued.delete(ca);
        emit();

        // Gentle pacing to reduce server rate pressure
        const d = Math.floor(
          opts.delayMin + Math.random() * (opts.delayMax - opts.delayMin + 1),
        );
        await sleep(d);
      }
    }
  } finally {
    updatingStore = false;
    emit();
  }
}

/** -------------------- Public React hook API -------------------- */
export function usePriceRefreshQueue(options?: {
  delayMs?: [number, number]; // [min, max] ms between tokens
  maxRetries?: number; // DB read-back retry count
}) {
  const delayMin = options?.delayMs?.[0] ?? 600;
  const delayMax = options?.delayMs?.[1] ?? 1200;
  const maxRetries = options?.maxRetries ?? 2;

  // Subscribe to global store changes to re-render
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const fn = () => force();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  /** Enqueue many tokens; dedup within current queue+inFlight. */
  const enqueueMany = React.useCallback(
    (list: Job[]) => {
      const newOnes: Job[] = [];
      for (const j of list) {
        const ca = normalizeCA(j.ca);
        if (!ca) continue;
        if (queued.has(ca) || inFlight.has(ca)) continue;
        queued.add(ca);
        newOnes.push({ ca, network: "solana" });
      }
      if (newOnes.length) {
        queue.push(...newOnes);
        totalStore += newOnes.length;
        emit();
        void runWorker({ delayMin, delayMax, maxRetries });
      }
    },
    [delayMin, delayMax, maxRetries],
  );

  /** Read a price from store (normalized key). */
  const get = React.useCallback(
    (ca: string) => pricesStore[normalizeCA(ca)],
    [],
  );
  /** Whether this CA has been confirmed by DB read-back or fresh-enough (<=10min). */
  const isDbFresh = React.useCallback(
    (ca: string) => Boolean(dbFreshStore[normalizeCA(ca)]),
    [],
  );
  /** Reset progress counters (does not clear cached prices). */
  const resetProgress = React.useCallback(() => {
    totalStore = 0;
    doneStore = 0;
    emit();
  }, []);

  return {
    // current prices hash (readonly snapshot)
    prices: pricesStore as PricesMap,

    // helpers
    get,
    getMc: (ca: string) => mcStore[normalizeCA(ca)],
    isDbFresh,
    enqueueMany,
    resetProgress,

    // status
    updating: updatingStore,
    progress: {
      total: totalStore,
      done: doneStore,
      queue: queue.length,
      inFlight: inFlight.size,
    },
  };
}
