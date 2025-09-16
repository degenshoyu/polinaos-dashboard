// components/leaderboard/KolsLeaderboardClient.tsx

"use client";

import { useEffect, useMemo, useState } from "react";
import type { KolRow } from "@/components/types";
import { totalsFromRow } from "@/lib/kols";
import { useKolAggregations } from "@/hooks/useKolAggregations";
import { useRouter, useSearchParams } from "next/navigation";

import { KolsHeaderControls, type SortKey, type ScopeKey, type CoinOpt } from "./KolsHeaderControls";
import { LeaderboardHeader } from "./LeaderboardHeader";
import { LeaderboardRow, type CoinStat } from "./LeaderboardRow";
import { Pagination, PAGE_SIZE_OPTIONS } from "./Pagination";
import MobileRow from "./MobileRow";
import KolTweetsModal from "./KolTweetsModal";

/* ---------- local utils ---------- */
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
  const daysFromUrl = Math.max(1, Math.min(30, Number(sp.get("days") || "7") || 7)) as 7 | 30;

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [scope, setScope] = useState<ScopeKey>("shills");
  const [coinKey, setCoinKey] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);             // 1-based
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);

  const { refreshing, refreshVisible } = useKolAggregations();
  const rows = initialRows ?? [];

  const [selectedKol, setSelectedKol] = useState<{
    twitterUsername: string; displayName?: string; profileImgUrl?: string;
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
        else merged.set(key, { tokenKey: key, tokenDisplay: display, count: Number(c.count || 0) });
      }
    }
    const out = Array.from(merged.values());
    out.sort((a, b) => (b.count - a.count) || a.tokenDisplay.localeCompare(b.tokenDisplay));
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
        const key = (c.tokenKey || c.tokenDisplay || "").trim().toLowerCase();
        return key === ck;
      });
      return textOk && hit;
    });
    return out;
  }, [rows, query, coinKey]);

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

      return {
        row: r,
        totalTweets,
        totalViews,
        totalEngs,
        totalER,
        shTweets,
        shViews,
        shEngs,
        shER,
        coins,
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
        case "tweets": return B.tweets - A.tweets;
        case "views": return B.views - A.views;
        case "engs":  return B.engs - A.engs;
        case "er":    return B.er - A.er;
        default: return 0;
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
  useEffect(() => { setPage(1); }, [query, coinKey, sortKey, scope, daysFromUrl]);

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
      <div className="font-semibold text-white text-[13px]">Total ({daysFromUrl} days)</div>
      <div className="text-gray-300">Total Tweets data in last {daysFromUrl} days</div>
    </div>
  );
  const shillTooltip = (
    <div className="space-y-1">
      <div className="font-semibold text-white text-[13px]">Shills ({daysFromUrl} days)</div>
      <div className="text-gray-300">Tweets data that shill coins in last {daysFromUrl} days</div>
    </div>
  );

  const scopeLabel = scope === "total" ? "Total" : "Shill";
  const metricLabel =
    sortKey === "tweets" ? "Tweets" :
    sortKey === "views"  ? "Views"  :
    sortKey === "engs"   ? "Engagements" : "Engagement Rate";

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
          onSetDays={setDays}
          onSetSortKey={setSortKey}
          onSetScope={setScope}
          onQueryChange={setQuery}
          onSetCoinKey={setCoinKey}
          hideScope
        />
      </div>

      {/* === Mobile list (cards) === */}
      <div className="md:hidden space-y-3">
        {ranked.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-gray-400">No KOLs found.</div>
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
              coinsAll={(x.coins || (x.row as any).coinsTop || []) as CoinStat[]}
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
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      {/* === Desktop table === */}
      <div className="relative z-0 hidden md:block rounded-2xl border border-white/10 bg-white/5 overflow-visible">
        <LeaderboardHeader days={daysFromUrl} totalTooltip={totalTooltip} shillTooltip={shillTooltip} />

        {/* BODY */}
        <div className="divide-y divide-white/10">
          {empty ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">No KOLs found.</div>
          ) : (
            paged.map((x, idx) => (
              <LeaderboardRow
                key={(x.row as any).twitterUsername || idx}
                r={x.row}
                rank={(start + idx) + 1}
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
                coinsAll={(x.coins || (x.row as any).coinsTop || []) as CoinStat[]}
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
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
    </div>
  );
}
