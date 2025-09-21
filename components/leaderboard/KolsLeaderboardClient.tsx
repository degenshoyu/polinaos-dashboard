"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KolRow } from "@/components/types";
import { totalsFromRow } from "@/lib/kols";
import { useRouter, useSearchParams } from "next/navigation";

import {
  KolsHeaderControls,
  type SortKey,
  type ScopeKey,
  type CoinOpt,
  type BasisKey,
} from "./KolsHeaderControls";
import { LeaderboardHeader } from "./LeaderboardHeader";
import { LeaderboardRow, type CoinStat } from "./LeaderboardRow";
import { Pagination, PAGE_SIZE_OPTIONS } from "./Pagination";
import MobileRow from "./MobileRow";
import KolTweetsModal from "./KolTweetsModal";
import { usePriceRefreshQueue } from "@/hooks/usePriceRefreshQueue";
import { resetMaxRoiProgress } from "@/hooks/useMaxRoiProgress";

/** ---- Avg ROI helpers ---- */
function computeAvgRoi(items: Array<{ roi?: number | null; maxRoi?: number | null }>): number | null {
  if (!Array.isArray(items)) return null;
  const vals = items
    .map((x) => {
      const m = typeof x?.maxRoi === "number" && isFinite(x.maxRoi) ? x.maxRoi : null;
      if (m !== null) return m;
      const r = typeof x?.roi === "number" && isFinite(x.roi) ? x.roi : null;
      return r;
    })
    .filter((v): v is number => v !== null);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number(mean.toFixed(4));
}

/** ---- Single ROI helpers (max over coins; prefer maxRoi, fallback roi) ---- */
function computeSingleRoi(items: Array<{ roi?: number | null; maxRoi?: number | null }>): number | null {
  if (!Array.isArray(items)) return null;
  let best: number | null = null;
  for (const x of items) {
    const m = typeof x?.maxRoi === "number" && isFinite(x.maxRoi) ? x.maxRoi : null;
    if (m === null) continue;
    if (best === null || m > best) best = m;
  }
  return best;
}

async function fetchAvgRoi(
  handle: string,
  basis: BasisKey,
  days: 7 | 30,
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({
    handle,
    mode: basis, // earliest | latest | lowest | highest
    days: String(days),
    limitPerKol: "64",
  });
  const r = await fetch(`/api/kols/coin-roi?${qs.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => ({}));
  const items: Array<{ roi?: number | null; maxRoi?: number | null }> = Array.isArray(j?.items)
    ? j.items
    : [];
  return computeAvgRoi(items);
}

async function fetchSingleRoi(
  handle: string,
  basis: BasisKey,
  days: 7 | 30,
  signal?: AbortSignal,
) {
  const qs = new URLSearchParams({
    handle,
    mode: basis,
    days: String(days),
    limitPerKol: "64",
  });
  const r = await fetch(`/api/kols/coin-roi?${qs.toString()}`, { cache: "no-store", signal });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => ({}));
  const items: Array<{ roi?: number | null; maxRoi?: number | null }> = Array.isArray(j?.items) ? j.items : [];
  return computeSingleRoi(items);
}

/** Fill a batch of missing Avg ROI with limited concurrency (default: 4) */
async function fillMissingAvgRoi(opts: {
  handles: string[];
  basis: BasisKey;
  days: 7 | 30;
  signal?: AbortSignal;
  onValue: (handle: string, v: number | null) => void;
  concurrency?: number;
}) {
  const { handles, basis, days, signal, onValue, concurrency = 4 } = opts;
  let i = 0;
  const limit = Math.min(concurrency, Math.max(1, handles.length));
  async function worker() {
    while (i < handles.length && !signal?.aborted) {
      const idx = i++;
      const h = handles[idx];
      try {
        const v = await fetchAvgRoi(h, basis, days, signal);
        if (signal?.aborted) return;
        onValue(h, v);
      } catch {
        if (signal?.aborted) return;
        onValue(h, null);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

/** Fill a batch of missing Single ROI with limited concurrency (default: 4) */
async function fillMissingSingleRoi(opts: {
  handles: string[];
  basis: BasisKey;
  days: 7 | 30;
  signal?: AbortSignal;
  onValue: (handle: string, v: number | null) => void;
  concurrency?: number;
}) {
  const { handles, basis, days, signal, onValue, concurrency = 4 } = opts;
  let i = 0;
  const limit = Math.min(concurrency, Math.max(1, handles.length));
  async function worker() {
    while (i < handles.length && !signal?.aborted) {
      const idx = i++;
      const h = handles[idx];
      try {
        const v = await fetchSingleRoi(h, basis, days, signal);
        if (signal?.aborted) return;
        onValue(h, v);
      } catch {
        if (signal?.aborted) return;
        onValue(h, null);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

/* ---------- Client container for KOL leaderboard ---------- */
export default function KolsLeaderboardClient({
  initialRows,
}: {
  initialRows: (KolRow & {
    totalShills?: number;
    shillViews?: number;
    shillEngagements?: number;
    coinsTop?: CoinStat[];
  })[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  // Days: we only support 7 / 30 in UI. Coerce to that domain.
  const daysFromUrl = (Math.max(
    1,
    Math.min(30, Number(sp.get("days") || "7") || 7),
  ) === 30
    ? 30
    : 7) as 7 | 30;

  // UI states
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [scope, setScope] = useState<ScopeKey>("shills");
  const [basis, setBasis] = useState<BasisKey>("lowest");
  const [coinKey, setCoinKey] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1); // 1-based
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);

  // cache: handle|basis|days -> avgRoi
  const [avgRoiMap, setAvgRoiMap] = useState<Record<string, number | null>>({});
  const keyFor = (h: string) => `${h}|${basis}|${daysFromUrl}`;
  const [singleRoiMap, setSingleRoiMap] = useState<Record<string, number | null>>({});

  const rows = initialRows ?? [];

  const [selectedKol, setSelectedKol] = useState<{
    twitterUsername: string;
    displayName?: string;
    profileImgUrl?: string;
  } | null>(null);

  /** Build coin options for filter (merge by tokenKey/tokenDisplay) */
  const coinOptions: CoinOpt[] = useMemo(() => {
    type Item = { tokenKey: string; tokenDisplay: string; count: number };
    const merged = new Map<string, Item>();
    for (const r of rows) {
      const list =
        (((r as any).coinsTopAll || (r as any).coinsTop) || []) as CoinStat[];
      for (const c of list) {
        const keyRaw = (c.tokenKey || c.tokenDisplay || "").trim();
        if (!keyRaw) continue;
        const key = keyRaw.toLowerCase();
        const display = (c.tokenDisplay || c.tokenKey || "UNKNOWN").trim();
        const prev = merged.get(key);
        if (prev) prev.count += Number(c.count || 0);
        else
          merged.set(key, {
            tokenKey: key,
            tokenDisplay: display,
            count: Number(c.count || 0),
          });
      }
    }
    const out = Array.from(merged.values());
    out.sort(
      (a, b) =>
        b.count - a.count || a.tokenDisplay.localeCompare(b.tokenDisplay),
    );
    return out;
  }, [rows]);

  /** Filter by text & coin */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ck = (coinKey || "").toLowerCase();
    const out = rows.filter((r) => {
      // text search
      const u = (r.twitterUsername || "").toLowerCase();
      const d = (r.displayName || "").toLowerCase();
      const textOk = !q || u.includes(q) || d.includes(q);

      // coin filter
      if (!ck) return textOk;
      const coins = (
        ((r as any).coinsTopAll || (r as any).coinsTop) || []
      ) as CoinStat[];
      const hit = coins.some((c) => {
        const key = (c.tokenKey || c.tokenDisplay || "")
          .trim()
          .toLowerCase();
        return key === ck;
      });
      return textOk && hit;
    });
    return out;
  }, [rows, query, coinKey]);

  const priceQueue = usePriceRefreshQueue();

  // When visible set likely changes, reset progress to avoid stale "Up to date"
  useEffect(() => {
    priceQueue.resetProgress?.();
    resetMaxRoiProgress();
  }, [sortKey, basis, daysFromUrl, pageSize, page]);

  /** ---- Improvement #2: Fetch missing Avg ROI with limited concurrency & abort on deps change ---- */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const missing = filtered
        .map((r) => r.twitterUsername)
        .filter((h) => avgRoiMap[keyFor(h)] === undefined);
      if (!missing.length) return;

      await fillMissingAvgRoi({
        handles: missing,
        basis,
        days: daysFromUrl as 7 | 30,
        signal: ac.signal,
        concurrency: 4, // you can tune this
        onValue: (handle, v) =>
          setAvgRoiMap((m) => ({ ...m, [keyFor(handle)]: v })),
      });
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, basis, daysFromUrl]);

/** ---- Fetch missing Single ROI when needed (same pattern as Avg ROI) ---- */
useEffect(() => {
  if (sortKey !== "singleRoi") return;
  const ac = new AbortController();
  (async () => {
    const missing = filtered
      .map((r) => r.twitterUsername)
      .filter((h) => singleRoiMap[keyFor(h)] === undefined);
    if (!missing.length) return;
    await fillMissingSingleRoi({
      handles: missing,
      basis,
      days: daysFromUrl as 7 | 30,
      signal: ac.signal,
      concurrency: 4,
      onValue: (handle, v) =>
        setSingleRoiMap((m) => ({ ...m, [keyFor(handle)]: v })),
    });
  })();
  return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filtered, basis, daysFromUrl, sortKey]);

  /** ---- Improvement #1: use fallback sort key while Avg ROI is still loading to avoid jitter ---- */
  const waitingAvgRoi = useMemo(() => {
    if (sortKey !== "avgRoi") return false;
    return filtered.some(
      (r) => avgRoiMap[keyFor(r.twitterUsername)] === undefined,
    );
  }, [filtered, sortKey, avgRoiMap, basis, daysFromUrl]); // keyFor uses basis/days

  const waitingSingleRoi = useMemo(() => {
    if (sortKey !== "singleRoi") return false;
    return filtered.some(
      (r) => singleRoiMap[keyFor(r.twitterUsername)] === undefined,
    );
  }, [filtered, sortKey, singleRoiMap, basis, daysFromUrl]);

  const effectiveSortKey: SortKey =
    waitingAvgRoi || waitingSingleRoi ? "engs" : sortKey; // fallback → engagements

  /** ---- NEW: lightweight UI loading flags for period/sort/basis ---- */
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingSort, setLoadingSort] = useState(false);
  const [loadingBasis, setLoadingBasis] = useState(false);
  const prevDaysRef = useRef(daysFromUrl);
  const prevSortRef = useRef(sortKey);
  const prevBasisRef = useRef(basis);

  // When days/sort/basis change, flash a tiny loading window (500-700ms)
  useEffect(() => {
    if (prevDaysRef.current !== daysFromUrl) {
      prevDaysRef.current = daysFromUrl;
      setLoadingDays(true);
      const id = setTimeout(() => setLoadingDays(false), 650);
      return () => clearTimeout(id);
    }
  }, [daysFromUrl]);
  useEffect(() => {
    if (prevSortRef.current !== sortKey) {
      prevSortRef.current = sortKey;
      setLoadingSort(true);
      const id = setTimeout(() => setLoadingSort(false), 500);
      return () => clearTimeout(id);
    }
  }, [sortKey]);
  useEffect(() => {
    if (prevBasisRef.current !== basis) {
      prevBasisRef.current = basis;
      setLoadingBasis(true);
      const id = setTimeout(() => setLoadingBasis(false), 600);
      return () => clearTimeout(id);
    }
  }, [basis]);

  // Table/body busy when切换 或 AvgROI 等待中
  const tableBusy =
  loadingDays || loadingSort || loadingBasis ||
  (sortKey === "avgRoi" && waitingAvgRoi) ||
  (sortKey === "singleRoi" && waitingSingleRoi);

  /** Enrich, compute totals & shills metrics, then sort by (scope × effectiveSortKey) */
  const ranked = useMemo(() => {
    const arr = filtered.map((r) => {
      const t = totalsFromRow(r);
      const totalTweets = t.totalTweets;
      const totalViews = t.totalViews;
      const totalEngs = t.totalEngs;
      const totalER = totalViews ? totalEngs / totalViews : 0;

      const shTweets = Number((r as any).totalShills || 0);
      const shViews = Number((r as any).shillViews || 0);
      const shEngs = Number((r as any).shillEngagements || 0);
      const shER = shViews ? shEngs / shViews : 0;

      const coins = (
        ((r as any).coinsTopAll || (r as any).coinsTop) || []
      ) as CoinStat[];

      const avgRoi = avgRoiMap[keyFor(r.twitterUsername)] ?? null;
      const rowWithAvg = { ...(r as any), avgRoi }; // attach for row rendering
      return {
        row: rowWithAvg,
        totalTweets,
        totalViews,
        totalEngs,
        totalER,
        shTweets,
        shViews,
        shEngs,
        shER,
        coins,
        avgRoi,
      };
    });

    arr.sort((a, b) => {
      const pick = (x: typeof a) =>
        scope === "total"
          ? {
              tweets: x.totalTweets,
              views: x.totalViews,
              engs: x.totalEngs,
              er: x.totalER,
            }
          : {
              tweets: x.shTweets,
              views: x.shViews,
              engs: x.shEngs,
              er: x.shER,
            };

      const A = pick(a);
      const B = pick(b);

      switch (effectiveSortKey) {
        case "tweets":
          return B.tweets - A.tweets;
        case "views":
          return B.views - A.views;
        case "engs":
          return B.engs - A.engs;
        case "er":
          return B.er - A.er;
        case "avgRoi": {
          const ar = typeof a.avgRoi === "number" ? a.avgRoi : -Infinity;
          const br = typeof b.avgRoi === "number" ? b.avgRoi : -Infinity;
          if (br !== ar) return br - ar; // higher first
          // tie-breaker for stability
          return B.engs - A.engs;
        }
        case "singleRoi": {
          const aKey = keyFor((a.row as any).twitterUsername);
          const bKey = keyFor((b.row as any).twitterUsername);
          const ar = typeof singleRoiMap[aKey] === "number" ? (singleRoiMap[aKey] as number) : -Infinity;
          const br = typeof singleRoiMap[bKey] === "number" ? (singleRoiMap[bKey] as number) : -Infinity;
          if (br !== ar) return br - ar; // higher first
          // tie-breakers
          if (B.engs !== A.engs) return B.engs - A.engs;
          return ((b.row as any).followers || 0) - ((a.row as any).followers || 0);
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, scope, effectiveSortKey, avgRoiMap, singleRoiMap, basis, daysFromUrl]);

  const empty = ranked.length === 0;
  const total = ranked.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const paged = ranked.slice(start, end);

  // Reset to page 1 when filters/sorts change
  useEffect(() => {
    setPage(1);
  }, [query, coinKey, sortKey, scope, daysFromUrl]);

  // URL setter for days
  function setDays(d: 7 | 30) {
    const params = new URLSearchParams(sp?.toString() || "");
    params.set("days", String(d));
    router.replace(`?${params.toString()}`);
    router.refresh();
  }

  /* ----- header tooltips (dynamic by days) ----- */
  const totalTooltip = (
    <div className="space-y-1">
      <div className="text-[13px] font-semibold text-white">
        Total ({daysFromUrl} days)
      </div>
      <div className="text-gray-300">
        Total Tweets data in last {daysFromUrl} days
      </div>
    </div>
  );
  const shillTooltip = (
    <div className="space-y-1">
      <div className="text-[13px] font-semibold text-white">
        Shills ({daysFromUrl} days)
      </div>
      <div className="text-gray-300">
        Tweets data that shill coins in last {daysFromUrl} days
      </div>
    </div>
  );

  const scopeLabel = scope === "total" ? "Total" : "Shill";
  const metricLabel =
    sortKey === "tweets"
      ? "Tweets"
      : sortKey === "views"
      ? "Views"
      : sortKey === "engs"
      ? "Engagements"
      : sortKey === "er"
      ? "Engagement Rate"
      : sortKey === "singleRoi"
      ? "Single ROI"
      : "Avg ROI";

  return (
    <div className="space-y-4">
      {/* Title + subtitle (row 1) */}
      <div>
        <h1 className="text-xl font-semibold">KOL Leaderboard</h1>
        <p className="text-sm text-gray-400">
          Ranked by {scopeLabel} {metricLabel} in last {daysFromUrl} days.
        </p>
      </div>

      {/* Full controls bar (row 2) */}
      <div className="w-full">
        <KolsHeaderControls
          days={daysFromUrl}
          sortKey={sortKey}
          scope={scope}
          query={query}
          coinKey={coinKey}
          coins={coinOptions}
          basis={basis}
          onSetDays={setDays}
          onSetSortKey={setSortKey}
          onSetScope={setScope}
          onQueryChange={setQuery}
          onSetCoinKey={setCoinKey}
          onSetBasis={setBasis}
          hideScope
          /* loading indicators in controls */
          loadingDays={loadingDays}
          loadingSort={
            loadingSort ||
            (sortKey === "avgRoi" && waitingAvgRoi) ||
            (sortKey === "singleRoi" && waitingSingleRoi)
          }
          loadingBasis={loadingBasis}
          waitingAvgRoi={
            (sortKey === "avgRoi" && waitingAvgRoi) ||
            (sortKey === "singleRoi" && waitingSingleRoi)
          }
        />
      </div>

      {/* === Mobile list (cards) === */}
      <div
        className={[
          "md:hidden space-y-3 transition-opacity",
          tableBusy ? "opacity-60 pointer-events-none animate-pulse" : "",
        ].join(" ")}
      >
        {ranked.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-gray-400">
            No KOLs found.
          </div>
        ) : (
          ranked.map((x, idx) => (
            <MobileRow
              key={(x.row as any).twitterUsername || idx}
              r={x.row}
              rank={idx + 1}
              totals={{
                tweets: x.totalTweets,
                views: x.totalViews,
                engs: x.totalEngs,
                er: x.totalER,
              }}
              shills={{
                tweets: x.shTweets,
                views: x.shViews,
                engs: x.shEngs,
                er: x.shER,
              }}
              coinsAll={
                (x.coins || (x.row as any).coinsTop || []) as CoinStat[]
              }
              basis={basis}
              days={daysFromUrl}
            />
          ))
        )}
      </div>

      {/* Top pagination */}
      <Pagination
        total={total}
        page={safePage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      {/* === Desktop table === */}
      <div
        className={[
          "relative z-0 hidden overflow-visible rounded-2xl border border-white/10 bg-white/5 md:block transition-opacity",
          tableBusy ? "opacity-60 pointer-events-none animate-pulse" : "",
        ].join(" ")}
      >
        {/* Thin amber top bar while busy */}
        {tableBusy && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-400/80" />
        )}

        <LeaderboardHeader
          days={daysFromUrl}
          totalTooltip={totalTooltip}
          shillTooltip={shillTooltip}
        />

        {/* BODY */}
        <div className="divide-y divide-white/10">
          {empty ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">
              No KOLs found.
            </div>
          ) : (
            paged.map((x, idx) => (
              <LeaderboardRow
                key={(x.row as any).twitterUsername || idx}
                r={x.row}
                rank={start + idx + 1}
                totals={{
                  tweets: x.totalTweets,
                  views: x.totalViews,
                  engs: x.totalEngs,
                  er: x.totalER,
                }}
                shills={{
                  tweets: x.shTweets,
                  views: x.shViews,
                  engs: x.shEngs,
                  er: x.shER,
                }}
                coinsAll={
                  (x.coins || (x.row as any).coinsTop || []) as CoinStat[]
                }
                basis={basis}
                days={daysFromUrl}
                onOpen={(info) => setSelectedKol(info)}
              />
            ))
          )}
        </div>
      </div>

      {selectedKol && (
        <KolTweetsModal
          open={!!selectedKol}
          onClose={() => setSelectedKol(null)}
          handle={selectedKol.twitterUsername}
          displayName={selectedKol.displayName}
          avatar={selectedKol.profileImgUrl}
          initialDays={daysFromUrl as 7 | 30}
        />
      )}

      {/* Bottom pagination */}
      <Pagination
        total={total}
        page={safePage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </div>
  );
}
