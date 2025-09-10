// lib/pricing/geckoterminal.ts
// GeckoTerminal helpers: primary pool selection + OHLCV with fallbacks.
// + rate-limit aware fetch & gentle backoff for 429

export type Ohlcv = [number, number, number, number, number, number?]; // [ts, o, h, l, c, v]

type FetchOpts = RequestInit & { retries?: number; retryDelayMs?: number };

// ---- Simple in-module throttle (per serverless instance/request lifecycle) ----
const MIN_INTERVAL_MS = Math.max(
  0,
  Number(process.env.GT_MIN_INTERVAL_MS ?? 350), // ~2.8 rps by default
);
let lastCallAt = 0;
async function throttleOnce() {
  const now = Date.now();
  const wait = lastCallAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

// ---- 429-aware JSON fetch with retries & jitter ----
async function fetchJson(url: string, opts: FetchOpts = {}) {
  const { retries = 3, retryDelayMs = 800, ...init } = opts;
  let lastErr: any = null;

  for (let i = 0; i <= retries; i++) {
    try {
      await throttleOnce();
      const r = await fetch(url, { ...init, cache: "no-store" });

      // Handle 429 with backoff + Retry-After
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after") || 0);
        // base backoff: either Retry-After (sec) or exponential
        const base =
          ra > 0 ? ra * 1000 : retryDelayMs * Math.pow(2, i === 0 ? 0 : i - 1);
        const jitter = Math.floor(Math.random() * 300);
        const sleepMs = Math.min(base + jitter, 8000); // cap
        // surface error details for logs (without consuming body multiple times)
        let msg = `HTTP 429 for ${url}`;
        try {
          const j = await r.json().catch(() => null);
          if (j?.status?.error_message) msg += ` :: ${j.status.error_message}`;
          lastErr = new Error(msg);
        } catch {
          lastErr = new Error(msg);
        }
        if (i < retries) {
          await new Promise((res) => setTimeout(res, sleepMs));
          continue;
        }
        throw lastErr;
      }

      if (!r.ok) {
        throw new Error(`HTTP ${r.status} for ${url}`);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const sleepMs =
          retryDelayMs * (i + 1) + Math.floor(Math.random() * 250);
        await new Promise((res) => setTimeout(res, sleepMs));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

/** List pools for a token on a network, pick by highest reserves_usd (fallback volume_24h). */
export async function listTopPoolsByToken(
  network: string,
  tokenAddress: string,
  take = 3,
): Promise<
  {
    address: string;
    dexId?: string;
    reservesUsd?: number;
    volume24h?: number;
  }[]
> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
    network,
  )}/tokens/${encodeURIComponent(tokenAddress)}/pools`;
  const json = await fetchJson(url);
  const arr: any[] = Array.isArray(json?.data) ? json.data : [];
  if (!arr.length) return [];
  const ranked = arr
    .map((d) => {
      const id = String(d?.id || "");
      const a = d?.attributes || {};
      const reserves = Number(a?.reserve_in_usd ?? a?.reserve_usd ?? 0);
      const vol24 = Number(a?.volume_usd_24h ?? 0);
      const score =
        Number.isFinite(reserves) && reserves > 0 ? reserves : vol24;
      return {
        address: id,
        dexId: String(a?.dex_identifier || a?.dex_id || a?.dexId || ""),
        reservesUsd: Number.isFinite(reserves) ? reserves : undefined,
        volume24h: Number.isFinite(vol24) ? vol24 : undefined,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, take).map(({ score, ...rest }) => rest);
}

/** Minute OHLCV (aggregate=1) before/at ts (sec). Returns newest-first list. */
export async function fetchOHLCVMinute(
  network: string,
  poolId: string,
  beforeTsSec: number,
  limit = 1,
): Promise<Ohlcv[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
    network,
  )}/pools/${encodeURIComponent(
    poolId,
  )}/ohlcv/minute?aggregate=1&limit=${limit}&before_timestamp=${beforeTsSec}`;
  const json = await fetchJson(url);
  const list = json?.data?.attributes?.ohlcv_list ?? [];
  return Array.isArray(list) ? (list as Ohlcv[]) : [];
}

/** Day OHLCV (aggregate=1) before/at ts (sec). Newest-first list. */
export async function fetchOHLCVDay(
  network: string,
  poolId: string,
  beforeTsSec: number,
  limit = 1,
): Promise<Ohlcv[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
    network,
  )}/pools/${encodeURIComponent(
    poolId,
  )}/ohlcv/day?aggregate=1&limit=${limit}&before_timestamp=${beforeTsSec}`;
  const json = await fetchJson(url);
  const list = json?.data?.attributes?.ohlcv_list ?? [];
  return Array.isArray(list) ? (list as Ohlcv[]) : [];
}

export function pickClose(candle?: Ohlcv): number | null {
  if (!candle) return null;
  const c = Number(candle[4]);
  return Number.isFinite(c) ? c : null;
}

/** Try price at ts with fallbacks: minute(1) -> minute(5) -> day(1). */
export async function priceAtTsWithFallbacks(
  network: string,
  poolId: string,
  tsSec: number,
): Promise<number | null> {
  // 1) last minute candle
  let arr = await fetchOHLCVMinute(network, poolId, tsSec, 1).catch(() => []);
  let price = pickClose(arr[0]);
  if (price != null) return price;

  // 2) widen to 5 minutes
  arr = await fetchOHLCVMinute(network, poolId, tsSec, 5).catch(() => []);
  price = pickClose(arr[0]);
  if (price != null) return price;

  // 3) fallback to day
  arr = await fetchOHLCVDay(network, poolId, tsSec, 1).catch(() => []);
  price = pickClose(arr[0]);
  return price ?? null;
}
