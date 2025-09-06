"use client";

import { useMemo, useState } from "react";
import type { KolRow } from "@/components/types";
import { totalsFromRow } from "@/lib/kols";
import { useKolAggregations } from "@/hooks/useKolAggregations";
import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { KolsHeaderControls } from "./KolsHeaderControls";
import { LeaderboardHeader } from "./LeaderboardHeader";
import { LeaderboardRow, type CoinStat } from "./LeaderboardRow";

/* ---------- local utils ---------- */

type SortKey =
  | "views"
  | "engs"
  | "tweets"
  | "totalER"
  | "shills"
  | "shillViews"
  | "shillEngs"
  | "shillsER";

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
  const [sortKey, setSortKey] = useState<SortKey>("shills");
  const { refreshing, refreshVisible } = useKolAggregations();

  const rows = initialRows ?? [];

  // Filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const u = (r.twitterUsername || "").toLowerCase();
      const d = (r.displayName || "").toLowerCase();
      return u.includes(q) || d.includes(q);
    });
  }, [rows, query]);

  // Enrich & sort
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
      switch (sortKey) {
        case "tweets": return b.totalTweets - a.totalTweets;
        case "engs": return b.totalEngs - a.totalEngs;
        case "views": return b.totalViews - a.totalViews;
        case "totalER": return b.totalER - a.totalER;
        case "shills": return b.shTweets - a.shTweets;
        case "shillViews": return b.shViews - a.shViews;
        case "shillEngs": return b.shEngs - a.shEngs;
        case "shillsER": return b.shER - a.shER;
        default: return 0;
      }
    });
    return arr;
  }, [filtered, sortKey]);

  const empty = ranked.length === 0;

  // URL setter for days
  function setDays(d: 7 | 30) {
    const params = new URLSearchParams(sp?.toString() || "");
    params.set("days", String(d));
    router.replace(`?${params.toString()}`);
    router.refresh();
  }

  // Refresh visible (recompute server-side)
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

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">KOL Leaderboard</h1>
          <p className="text-sm text-gray-400">
            Ranked by {
              sortKey === "views" ? "Total Views" :
              sortKey === "engs" ? "Total Engagements" :
              sortKey === "tweets" ? "Total Tweets" :
              sortKey === "totalER" ? "Total Engagement Rate" :
              sortKey === "shills" ? "Shill Tweets" :
              sortKey === "shillViews" ? "Shill Views" :
              sortKey === "shillEngs" ? "Shill Engagements" :
              "Shill Engagement Rate"
            } in last {daysFromUrl} days.
          </p>
        </div>

        <KolsHeaderControls
          days={daysFromUrl}
          sortKey={sortKey}
          onSetDays={setDays}
          onSetSortKey={setSortKey}
        />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <Search size={16} className="text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search handle or name…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-500"
          aria-label="Search KOLs"
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
