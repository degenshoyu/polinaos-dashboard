// lib/markets/gtFetch.ts
// GeckoTerminal fetch guard: in-memory cache + concurrency gate + 429 retry

const GT_MAX_CONC       = Number(process.env.GT_MAX_CONC ?? 4);          // max parallel GT calls
const GT_CACHE_TTL_MS   = Number(process.env.GT_CACHE_TTL_MS ?? 120_000); // 2 min cache
const GT_RETRY          = Number(process.env.GT_RETRY ?? 2);              // retry on 429
const GT_BASE_DELAY_MS  = Number(process.env.GT_BASE_DELAY_MS ?? 500);    // backoff base

type CacheEntry = { t: number; json: any };
const cache = new Map<string, CacheEntry>();

let active = 0;
const queue: Array<() => void> = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (active < GT_MAX_CONC) { active++; resolve(); }
    else queue.push(() => { active++; resolve(); });
  });
}
function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
}

/** Fetch GT JSON with URL-level cache + concurrency + 429 retry */
export async function fetchGTJson(url: string, init?: RequestInit): Promise<any> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.t < GT_CACHE_TTL_MS) return hit.json;

  await acquire();
  try {
    let attempt = 0;
    while (true) {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(init || {}),
      });

      if (res.status === 429 && attempt < GT_RETRY) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000
          || GT_BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(retryAfter);
        attempt++;
        continue;
      }
      if (!res.ok) throw new Error(`GT ${res.status} ${res.statusText}`);

      const json = await res.json();
      cache.set(url, { t: Date.now(), json });
      return json;
    }
  } finally {
    release();
  }
}

/** Optional helpers */
export function clearGtCache() { cache.clear(); }
export function gtCacheSize() { return cache.size; }

