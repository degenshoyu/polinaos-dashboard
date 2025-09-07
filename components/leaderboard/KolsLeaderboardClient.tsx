"use client";

import { useMemo, useState } from "react";
import type { KolRow } from "@/components/types";
import { totalsFromRow } from "@/lib/kols";
import { useKolAggregations } from "@/hooks/useKolAggregations";
import { useRouter, useSearchParams } from "next/navigation";

import { KolsHeaderControls, type SortKey, type ScopeKey, type CoinOpt } from "./KolsHeaderControls";
import { LeaderboardHeader } from "./LeaderboardHeader";
import { LeaderboardRow, type CoinStat } from "./LeaderboardRow";

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
  const [sortKey, setSortKey] = useState<SortKey>("tweets");
  const [scope, setScope] = useState<ScopeKey>("shills");
  const [coinKey, setCoinKey] = useState<string | null>(null);

  const { refreshing, refreshVisible } = useKolAggregations();
  const rows = initialRows ?? [];

  /** Build coin options for filter (merge by tokenKey/tokenDisplay) */
  const coinOptions: CoinOpt[] = useMemo(() => {
    type Item = { tokenKey: string; tokenDisplay: string; count: number };
    const merged = new Map<string, Item>();
    for (const r of rows) {
      const list = ((r as any).coinsTop || []) as CoinStat[];
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
    return rows.filter((r) => {
      // text search
      const u = (r.twitterUsername || "").toLowerCase();
      const d = (r.displayName || "").toLowerCase();
      const textOk = !q || u.includes(q) || d.includes(q);

      // coin filter
      if (!ck) return textOk;
      const coins = (((r as any).coinsTop || []) as CoinStat[]);
      const hit = coins.some((c) => {
        const key = (c.tokenKey || c.tokenDisplay || "").trim().toLowerCase();
        return key === ck;
      });
      return textOk && hit;
    });
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

      const coins: CoinStat[] = (((r as any).coinsTop || []) as CoinStat[]);

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
      {/* Top controls (title + all controls in one line) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">KOL Leaderboard</h1>
          <p className="text-sm text-gray-400">
            Ranked by {scopeLabel} {metricLabel} in last {daysFromUrl} days.
          </p>
        </div>

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
        />
      </div>

      {/* Table container */}
      <div className="rounded-2xl border border-white/10 bg-white/5 overflow-visible">
        <LeaderboardHeader days={daysFromUrl} totalTooltip={totalTooltip} shillTooltip={shillTooltip} />

        {/* BODY */}
        <div className="divide-y divide-white/10">
          {empty ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400">No KOLs found.</div>
          ) : (
            ranked.map((x, idx) => (
              <LeaderboardRow
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
      </div>
    </div>
  );
}

