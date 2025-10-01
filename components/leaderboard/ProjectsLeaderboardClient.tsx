// components/leaderboard/ProjectsLeaderboardClient.tsx
// Client container: SSR initial data + refetch on URL changes.
// Columns: Rank | Project | Mkt Cap | Price | 1h | 24h | Vol (24h) | Age | Top Shillers | Followers | Type | Attention
// This component also performs client-side enrichment for rows with a CA:
//   - price_usd / mcap_usd / price_change_1h_pct / price_change_24h_pct
//   - volume_24h_usd
//   - image (token logo)
//   - age_days (pool/token age; best-effort)
// We keep a small in-memory cache and a throttled queue to respect public API rate limits.

"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ProjectsHeaderControls from "./ProjectsHeaderControls";
import ProjectsRow from "./ProjectsRow";
import { Pagination } from "@/components/leaderboard/Pagination";

export type ProjectType = "meme" | "utility" | "unknown";

export interface ProjectLeaderboardItem {
  rank: number;
  ticker: string;
  ca: string;
  image: string | null;

  price_usd: number | null;
  mcap_usd: number | null;
  price_change_1h_pct?: number | null;
  price_change_24h_pct?: number | null;

  // NEW: enriched on the client
  volume_24h_usd?: number | null;
  age_days?: number | null;

  social_score: number | null; // kept for backend compatibility
  type: ProjectType;
  attention_score: number;

  // Optional project-level followers; row will fallback to sum of shillers if absent
  followers_count?: number | null;

  top_shillers: Array<{
    handle: string;
    views: number;
    avatar: string | null;
    followers: number | null;
  }>;

  mentions?: number;
  shillers?: number;
  views?: number;
  engs?: number;
}

export interface LeaderboardQuery {
  preset: "7d" | "30d";
  q: string;
  type: "all" | "meme" | "utility";
  sort: "attention" | "views" | "shillers" | "social" | "mcap" | "price";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** ---------- Client-side enrichment helpers (reused pattern from TopTokensByMentions) ---------- */

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return undefined;
}

// Light scoring to pick the most representative pool
function scorePool(vol24h?: number, liq?: number, cap?: number) {
  const sVol = Math.log10(1 + Math.max(0, vol24h ?? 0));
  const sLiq = Math.log10(1 + Math.max(0, liq ?? 0));
  const sCap = Math.log10(1 + Math.max(0, cap ?? 0));
  return 3.0 * sVol + 1.6 * sLiq + 1.2 * sCap;
}

function chainFromId(id?: string) {
  if (!id) return "";
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : "";
}

// Best-effort age (days) from ISO timestamp; < 1 day returns fraction
function ageDaysFromISO(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 0) return 0;
  return ms / 86400000; // days
}

// Fetch GeckoTerminal pools by CA, choose best pool; augment via Dexscreener helper if available
async function fetchTokenPreviewByCA(ca: string) {
  const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(
    ca,
  )}&include=base_token,quote_token,dex`;
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) return null;
  const j: any = await r.json();

  const pools: any[] = Array.isArray(j?.data) ? j.data : [];
  const included: any[] = Array.isArray(j?.included) ? j.included : [];
  const tokenById = new Map<string, any>();
  const dexById = new Map<string, any>();
  for (const inc of included) {
    if (inc?.type === "token") tokenById.set(inc.id, inc);
    if (inc?.type === "dex") dexById.set(inc.id, inc);
  }

  const candidates = pools
    .map((p) => {
      const attrs = p?.attributes || {};
      const baseId = p?.relationships?.base_token?.data?.id || "";
      const dexId = p?.relationships?.dex?.data?.id || null;
      const base = tokenById.get(baseId);
      const chain = chainFromId(base?.id || baseId);

      const priceUsd = toNum(attrs?.base_token_price_usd);
      const vol24h = toNum(attrs?.volume_usd?.h24);
      const liq = toNum(attrs?.reserve_in_usd);
      const mcap = toNum(attrs?.market_cap_usd);
      const fdv = toNum(attrs?.fdv_usd);
      const capOrFdv = (mcap ?? 0) || (fdv ?? 0);

      const pc1h = toNum(attrs?.price_change_percentage?.h1 ?? attrs?.price_change_pct_1h);
      const pc24h = toNum(attrs?.price_change_percentage?.h24 ?? attrs?.price_change_pct_24h);

      // Some GT responses include created_at/pool_created_at - try both
      const createdISO: string | undefined =
        attrs?.created_at || attrs?.pool_created_at || base?.attributes?.created_at;

      return {
        score: scorePool(vol24h, liq, capOrFdv),
        priceUsd,
        vol24h,
        liq,
        mcap,
        fdv,
        pc1h,
        pc24h,
        logo: base?.attributes?.image_url ?? null,
        chain,
        dexName: (dexId && (dexById.get(dexId)?.attributes?.name || dexId)) || null,
        createdISO: createdISO || null,
      };
    })
    .filter((x) => (x.liq ?? 0) > 0 || (x.vol24h ?? 0) > 0 || (x.priceUsd ?? 0) > 0);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;

  // Optional: hit our Dexscreener helper to backfill image/age if Gecko lacks it
  let ds: any = null;
  try {
    const qs = new URLSearchParams(best?.chain ? { chain: best.chain, address: ca } : { address: ca });
    const r2 = await fetch(`/api/dexscreener/info?${qs.toString()}`, { headers: { "cache-control": "no-store" } });
    if (r2.ok) ds = await r2.json();
  } catch {
    // swallow
  }

  // Age preference: Dexscreener ageDays > Gecko created_at > null
  let age_days: number | null = null;
  if (typeof ds?.ageDays === "number") {
    age_days = ds.ageDays;
  } else if (typeof ds?.age_seconds === "number") {
    age_days = ds.age_seconds / 86400;
  } else {
    age_days = ageDaysFromISO(best.createdISO);
  }

  return {
    image: best.logo ?? ds?.imageUrl ?? ds?.logo ?? null,
    price_usd: best.priceUsd ?? null,
    mcap_usd: (best.mcap ?? best.fdv ?? null) ?? null,
    price_change_1h_pct: best.pc1h ?? null,
    price_change_24h_pct: best.pc24h ?? null,
    volume_24h_usd: best.vol24h ?? ds?.volume24hUsd ?? null,
    age_days,
  };
}

/** ---------- Component ---------- */

export default function ProjectsLeaderboardClient({
  initialItems,
  initialTotal,
  initialQuery,
}: {
  initialItems: ProjectLeaderboardItem[];
  initialTotal: number;
  initialQuery: LeaderboardQuery;
}) {
  const [items, setItems] = useState<ProjectLeaderboardItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();

  const query = useMemo<LeaderboardQuery>(() => {
    const get = (k: string, f: string) => sp.get(k) ?? f;
    return {
      preset: (get("preset", initialQuery.preset) as "7d" | "30d") ?? "7d",
      q: get("q", initialQuery.q),
      type: (get("type", initialQuery.type) as "all" | "meme" | "utility") ?? "all",
      sort: (get("sort", initialQuery.sort) as LeaderboardQuery["sort"]) ?? "attention",
      order: (get("order", initialQuery.order) as "asc" | "desc") ?? "desc",
      page: Number(get("page", String(initialQuery.page))),
      pageSize: Number(get("pageSize", String(initialQuery.pageSize))),
    };
  }, [sp, initialQuery]);

  // Fetch backend data when URL changes
  const fetchData = useCallback(async () => {
    setError(null);
    const url = new URL("/api/projects/leaderboard", window.location.origin);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) return;
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        page: number;
        pageSize: number;
        total: number;
        items: ProjectLeaderboardItem[];
      };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load leaderboard");
    }
  }, [query]);

  useEffect(() => {
    // Mark client hydration; used to avoid rendering mock rows on first paint.
    setHydrated(true);
  }, []);

  const looksLikeMock = useMemo(() => {
    if (!Array.isArray(initialItems) || initialItems.length === 0) return false;
    return initialItems.every((it) => {
      const m = Number(it.mentions ?? 0) + Number(it.shillers ?? 0) + Number(it.views ?? 0) + Number(it.engs ?? 0);
      return Number(it.attention_score ?? 0) === 0 && m === 0;
    });
  }, [initialItems]);

  useEffect(() => {
    const ssrKey = new URLSearchParams(initialQuery as any).toString();
    const nowKey = sp.toString();
    if (ssrKey === nowKey && !looksLikeMock) return;
    startTransition(fetchData);
  }, [fetchData, initialQuery, sp, looksLikeMock]);

  const onPageChange = useCallback(
    (nextPage: number) => {
      const usp = new URLSearchParams(sp.toString());
      usp.set("page", String(Math.max(1, nextPage)));
      router.replace(`${pathname}?${usp.toString()}`);
    },
    [pathname, router, sp],
  );
  const onPageSizeChange = useCallback(
    (nextSize: number) => {
      const usp = new URLSearchParams(sp.toString());
      usp.set("pageSize", String(nextSize));
      usp.set("page", "1");
      router.replace(`${pathname}?${usp.toString()}`);
    },
    [pathname, router, sp],
  );

  /** ---------- Client-side enrichment (cache + throttled queue) ---------- */
  const [enrichTick, setEnrichTick] = useState(0); // trigger rerenders when cache fills
  const cacheRef = (globalThis as any).__projPreviewCache ??= new Map<string, any>();
  const inflightRef = (globalThis as any).__projPreviewInflight ??= new Set<string>();
  const queueRef = (globalThis as any).__projPreviewQueue ??= [] as string[];
  const runningRef = (globalThis as any).__projPreviewRunning ??= { v: false };

  const enqueueCA = useCallback((maybeCa?: string | null) => {
    const ca = (maybeCa || "").trim();
    if (!ca) return;
    if (cacheRef.has(ca) || inflightRef.has(ca)) return;
    inflightRef.add(ca);
    queueRef.push(ca);

    (async function run() {
      if (runningRef.v) return;
      runningRef.v = true;
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
      while (queueRef.length) {
        const next = queueRef.shift()!;
        try {
          const data = await fetchTokenPreviewByCA(next);
          if (data) cacheRef.set(next, data);
        } catch {
          // ignore errors to keep the queue healthy
        }
        inflightRef.delete(next);
        setEnrichTick((x) => x + 1);
        await sleep(220); // gentle throttle for public APIs
      }
      runningRef.v = false;
    })();
  }, []);

  // Whenever items change, enqueue missing enrichments
  useEffect(() => {
    items.forEach((it) => {
      if (!it?.ca) return;
      const cached = cacheRef.get(it.ca);
      const needPrice =
        it.price_usd == null ||
        it.mcap_usd == null ||
        it.price_change_1h_pct == null ||
        it.price_change_24h_pct == null ||
        it.volume_24h_usd == null;
      const needImage = !it.image;
      const needAge = it.age_days == null;
      if (needPrice || needImage || needAge) enqueueCA(it.ca);
    });
  }, [items, enqueueCA]);

  // Merge cache -> items (only fill empty fields so SSR/BE stays authoritative)
  useEffect(() => {
    setItems((prev) => {
      if (!prev?.length) return prev;
      let changed = false;
      const next = prev.map((it) => {
        if (!it?.ca) return it;
        const cached = cacheRef.get(it.ca);
        if (!cached) return it;
        const merged: ProjectLeaderboardItem = { ...it };
        if (!merged.image && cached.image) {
          merged.image = cached.image;
          changed = true;
        }
        if (merged.price_usd == null && cached.price_usd != null) {
          merged.price_usd = cached.price_usd;
          changed = true;
        }
        if (merged.mcap_usd == null && cached.mcap_usd != null) {
          merged.mcap_usd = cached.mcap_usd;
          changed = true;
        }
        if (merged.price_change_1h_pct == null && cached.price_change_1h_pct != null) {
          merged.price_change_1h_pct = cached.price_change_1h_pct;
          changed = true;
        }
        if (merged.price_change_24h_pct == null && cached.price_change_24h_pct != null) {
          merged.price_change_24h_pct = cached.price_change_24h_pct;
          changed = true;
        }
        if (merged.volume_24h_usd == null && cached.volume_24h_usd != null) {
          merged.volume_24h_usd = cached.volume_24h_usd;
          changed = true;
        }
        if (merged.age_days == null && cached.age_days != null) {
          merged.age_days = cached.age_days;
          changed = true;
        }
        return merged;
      });
      return changed ? next : prev;
    });
    // Only runs when cache ticks; no stale-closure risk thanks to functional setState
  }, [enrichTick]);

  return (
    <div className="space-y-4">
      <ProjectsHeaderControls />

      {error && !/404/.test(error) && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-200">{error}</div>
      )}
      {isPending && (
        <div className="px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white/80 animate-pulse">Loading…</div>
      )}

      <Pagination
        total={total}
        page={query.page}
        pageSize={query.pageSize as any}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />

      {/* Desktop table container — custom grid; widen with two new columns (Vol 24h, Age) */}
      <div className="relative z-0 overflow-visible rounded-2xl border border-white/10 bg-white/5">
        {/* 12 columns:
            64px | 1.6fr | 0.9fr | 0.8fr | 0.6fr | 0.6fr | 0.9fr | 0.6fr | 2.0fr | 0.9fr | 0.9fr | 0.9fr */}
        <div className="grid [grid-template-columns:64px_1.6fr_0.9fr_0.8fr_0.6fr_0.6fr_0.9fr_0.6fr_2.0fr_0.9fr_0.9fr_0.9fr] px-3 py-2 text-[11px] uppercase tracking-wide text-gray-400">
          <div className="text-left">#</div>
          <div className="text-left">Project</div>
          <div className="text-left">Mkt Cap</div>
          <div className="text-left">Price</div>
          <div className="text-left">1h</div>
          <div className="text-left">24h</div>
          <div className="text-left">Vol (24h)</div>
          <div className="text-left">Age</div>
          <div className="text-left">Top Shillers</div>
          <div className="text-left">Followers</div>
          <div className="text-left">Type</div>
          <div className="text-right">Attention</div>
        </div>

        <div className="divide-y divide-white/10">
          {/* Avoid flashing placeholder rows on first paint if initial data looks like mock. */}
          {!hydrated && looksLikeMock ? (
            <div className="p-3 space-y-2">
              {/* ultra-light skeleton — 6 rows */}
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">No projects found.</div>
          ) : (
            items.map((it) => <ProjectsRow key={`${it.ca}-${it.rank}`} item={it} />)
          )}
        </div>
      </div>

      <Pagination
        total={total}
        page={query.page}
        pageSize={query.pageSize as any}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
