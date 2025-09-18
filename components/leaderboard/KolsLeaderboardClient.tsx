"use client";

import { useEffect, useMemo, useState } from "react";
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

function computeAvgRoi(items: Array<{ roi: number | null }>): number | null {
  if (!Array.isArray(items)) return null;
  const vals = items
    .map((x) => (typeof x?.roi === "number" && isFinite(x.roi) ? x.roi : null))
    .filter((v): v is number => v !== null);
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number(mean.toFixed(4));
}

async function fetchAvgRoi(handle: string, basis: BasisKey, days: 7 | 30) {
  const qs = new URLSearchParams({
    handle,
    mode: basis,               // earliest | latest | lowest | highest
    days: String(days),
    limitPerKol: "64",
  });
  const r = await fetch(`/api/kols/coin-roi?${qs.toString()}`, { cache: "no-store" });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => ({}));
  const items: Array<{ roi: number | null }> = Array.isArray(j?.items) ? j.items : [];
  return computeAvgRoi(items);
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
  const [basis, setBasis] = useState<BasisKey>("earliest");
  const [coinKey, setCoinKey] = useState<string | null>(null); // <-- added
  const [page, setPage] = useState<number>(1); // 1-based
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [avgRoiMap, setAvgRoiMap] = useState<Record<string, number | null>>({});
  const keyFor = (h: string) => `${h}|${basis}|${daysFromUrl}`;

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

  // Load missing avg ROI for the current filtered set (basis/days aware)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // which handles are missing in cache?
      const missing = filtered
        .map((r) => r.twitterUsername)
        .filter((h) => avgRoiMap[keyFor(h)] === undefined);
      if (!missing.length) return;
      // fetch sequentially to be gentle on API
      for (const handle of missing) {
        if (cancelled) break;
        const val = await fetchAvgRoi(handle, basis, daysFromUrl as 7 | 30);
        if (cancelled) break;
        setAvgRoiMap((m) => ({ ...m, [keyFor(handle)]: val }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filtered, basis, daysFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Enrich, compute totals & shills metrics, then sort by (scope × sortKey) */
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

      switch (sortKey) {
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
          return B.engs - A.engs;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, scope]);

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
        />
      </div>

      {/* === Mobile list (cards) === */}
      <div className="md:hidden space-y-3">
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
              basis={basis}              // pass for consistency
              days={daysFromUrl}         // pass for consistency
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
      <div className="relative z-0 hidden overflow-visible rounded-2xl border border-white/10 bg-white/5 md:block">
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
