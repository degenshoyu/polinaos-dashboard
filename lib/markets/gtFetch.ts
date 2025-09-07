// lib/markets/gtFetch.ts
// GeckoTerminal fetch guard: in-memory cache + concurrency + timeout + retries.
// Prevents "Unexpected end of JSON input" by parsing text with retry on partial bodies.

type Opts = {
  ttlMs?: number;      // cache TTL for successful responses
  timeoutMs?: number;  // per-request timeout
  retries?: number;    // retry on 429/5xx/parse errors
};

const CACHE = new Map<string, { exp: number; data: any }>();
const INFLIGHT = new Map<string, Promise<any>>();
let inflightCount = 0;
const MAX_CONCURRENCY = Number(process.env.GT_MAX_CONCURRENCY ?? 3);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (inflightCount >= MAX_CONCURRENCY) await sleep(25);
  inflightCount++;
  try {
    return await fn();
  } finally {
    inflightCount--;
  }
}

export async function fetchGTJson(url: string, opts: Opts = {}): Promise<any> {
  const { ttlMs = 30_000, timeoutMs = 8_000, retries = 3 } = opts;
  const key = url;

  // cache hit
  const now = Date.now();
  const c = CACHE.get(key);
  if (c && c.exp > now) return c.data;

  // de-dupe same URL inflight
  const existing = INFLIGHT.get(key);
  if (existing) return existing;

  const p = withSlot(async () => {
    let attempt = 0;
    let lastErr: any;

    while (attempt <= retries) {
      attempt++;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          headers: { accept: "application/json" },
          cache: "no-store",
          next: { revalidate: 0 },
          signal: ac.signal,
        });

        const status = res.status;
        const text = await res.text().catch(() => "");
        clearTimeout(t);

        // Success
        if (status >= 200 && status < 300) {
          try {
            const json = text ? JSON.parse(text) : null;
            CACHE.set(key, { exp: Date.now() + ttlMs, data: json });
            return json;
          } catch (e) {
            // Partial/invalid JSON -> retry
            lastErr = new Error(
              `GT JSON parse failed (len=${text?.length || 0})`,
            );
          }
        } else if (status === 204) {
          CACHE.set(key, { exp: Date.now() + ttlMs, data: null });
          return null;
        } else if (status === 429 || status >= 500) {
          // Retryable
          lastErr = new Error(`GT HTTP ${status}`);
        } else {
          // Non-retryable 4xx: throw with body
          throw new Error(`GT HTTP ${status}: ${text?.slice(0, 200)}`);
        }
      } catch (e: any) {
        lastErr = e;
      } finally {
        clearTimeout(t);
      }

      // backoff
      const backoff = Math.min(1500 * attempt, 4000);
      await sleep(backoff);
    }

    throw lastErr ?? new Error("fetchGTJson failed");
  }).finally(() => {
    INFLIGHT.delete(key);
  });

  INFLIGHT.set(key, p);
  return p;
}

