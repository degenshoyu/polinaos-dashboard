"use client";

import * as React from "react";

export type LivePriceToken = {
  ca: string; // contract address (case-sensitive)
  network?: "solana"; // currently only supports Solana
};

export type LivePriceOptions = {
  auto?: boolean; // auto refresh on tokens change (default true)
  delayMs?: [number, number]; // backoff range between requests [min, max], default [600, 1200]
  maxRetries?: number; // max retries for 429 or network errors (default 2)
};

export type LivePriceState = {
  prices: Record<string, number>; // ca -> latest price (number)
  updating: boolean; // whether hook is currently fetching
  progress: { total: number; done: number; queue: number };
  refresh: (tokens: LivePriceToken[]) => Promise<void>; // manual trigger
  get: (ca: string) => number | undefined; // quick getter
};

/** Sleep helper */
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Random int between [min, max] inclusive */
const rand = (min: number, max: number) =>
  Math.floor(min + Math.random() * Math.max(0, max - min));

/** Fetch latest snapshot price from DB */
async function fetchDbPrice(ca: string): Promise<number | null> {
  try {
    const qs = new URLSearchParams({ addresses: ca });
    const r = await fetch(`/api/coin-prices?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json();
    const first = Array.isArray(j?.items)
      ? j.items.find((x: any) => String(x.contract_address) === ca)
      : null;
    const n = Number(first?.price_usd);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Fetch live price from GeckoTerminal (Solana) */
async function fetchGtSpotSol(ca: string): Promise<number | null> {
  const url = `https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${encodeURIComponent(ca)}`;
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (r.status === 429) {
    const e = new Error("429");
    (e as any).status = 429;
    throw e;
  }
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}) as any);
  const map = j?.data?.attributes?.token_prices || {};
  const v = map[ca] ?? Object.values(map)[0];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Save back to DB */
async function pushDbPrice(ca: string, priceUsd: number, priceAt?: string) {
  try {
    await fetch(`/api/coin-prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            contract_address: ca,
            price_usd: priceUsd,
            price_at: priceAt ?? new Date().toISOString(),
            source: "client_push",
          },
        ],
      }),
    });
  } catch (e) {
    console.warn("pushDbPrice failed", e);
  }
}

/** Refresh one token: try DB -> GT -> save back */
async function refreshOne(
  token: LivePriceToken,
  maxRetries: number,
): Promise<number | null> {
  const ca = token.ca;

  // 1. Try DB snapshot
  const db = await fetchDbPrice(ca);
  if (db != null) return db;

  // 2. GeckoTerminal with retry/backoff
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    try {
      const gt = await fetchGtSpotSol(ca);
      if (gt != null) {
        await pushDbPrice(ca, gt);
        return gt;
      }
      return null;
    } catch (e: any) {
      const is429 = e?.status === 429 || /429/.test(String(e?.message || e));
      if (is429 && attempt <= maxRetries) {
        const backoff = Math.min(15000, 500 * 2 ** (attempt - 1));
        await sleep(backoff);
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Hook: refresh live prices with controlled queue */
export function useLiveTokenPrices(
  tokens: LivePriceToken[],
  opts?: LivePriceOptions,
): LivePriceState {
  const { auto = true, delayMs = [600, 1200], maxRetries = 2 } = opts || {};
  const [prices, setPrices] = React.useState<Record<string, number>>({});
  const [updating, setUpdating] = React.useState(false);
  const [progress, setProgress] = React.useState({
    total: 0,
    done: 0,
    queue: 0,
  });

  const get = React.useCallback((ca: string) => prices[ca], [prices]);

  const refresh = React.useCallback(
    async (list: LivePriceToken[]) => {
      if (!list?.length) return;
      setUpdating(true);
      setProgress({ total: list.length, done: 0, queue: list.length });
      try {
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const v = await refreshOne(t, maxRetries);
          if (v != null) {
            setPrices((prev) => ({
              ...prev,
              [t.ca]: Number(Number(v).toFixed(6)), // 6 decimal places
            }));
          }
          setProgress({
            total: list.length,
            done: i + 1,
            queue: Math.max(0, list.length - (i + 1)),
          });
          // gentle delay between requests
          const [dmin, dmax] = delayMs;
          await sleep(rand(dmin, dmax));
        }
      } finally {
        setUpdating(false);
      }
    },
    [delayMs, maxRetries],
  );

  // auto refresh on token change
  React.useEffect(() => {
    if (!auto) return;
    const missing = (tokens || []).filter((t) => !prices[t.ca]);
    if (!missing.length) return;
    void refresh(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  return { prices, updating, progress, refresh, get };
}
