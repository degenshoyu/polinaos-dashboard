"use client";

import React, { useState } from "react";

type Buckets = {
  erShares: { lt1: number; _1_2_5: number; _2_5_5: number; gt5: number };
  viewShares: { lt1k: number; _1k_2_5k: number; _2_5k_5k: number; gt5k: number };
};
type Totals = { tweets: number; views: number; engagements: number; er: number };
type Averages = {
  avgTweetsPerDay: number;
  avgViewsPerTweet: number;
  avgEngsPerTweet: number;
  avgER: number;
};

export default function TotalsCard({
  aggAll,
  aggVer,
  avgAll,
  avgVer,
  bucketsAll,
  bucketsVer,
  initialView = "all",
  className = "",
}: {
  aggAll: Totals;
  aggVer: Totals;
  avgAll: Averages;
  avgVer: Averages;
  bucketsAll: Buckets;
  bucketsVer: Buckets;
  initialView?: "all" | "verified";
  className?: string;
}) {
  const [view, setView] = useState<"all" | "verified">(initialView);

  const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v);
  const pctText = (v: number) => `${(v * 100).toFixed(1)}%`;

  const data = view === "all"
    ? { agg: aggAll, avg: avgAll, buckets: bucketsAll }
    : { agg: aggVer, avg: avgVer, buckets: bucketsVer };

  return (
    <div className={`rounded-2xl border border-white/10 bg-black/10 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400">
          {view === "all" ? "All tweets — totals" : "Verified tweets — totals"}
        </div>
        <div
          role="tablist"
          aria-label="Totals view"
          className="flex rounded-lg overflow-hidden border border-white/10 bg-white/5"
        >
          <button
            role="tab"
            aria-selected={view === "all"}
            onClick={() => setView("all")}
            className={`px-2.5 py-1 text-xs transition ${view === "all" ? "bg-emerald-500/20 text-emerald-200" : "text-white/80 hover:bg-white/10"}`}
            title="Show all tweets totals"
          >
            All
          </button>
          <button
            role="tab"
            aria-selected={view === "verified"}
            onClick={() => setView("verified")}
            className={`px-2.5 py-1 text-xs transition ${view === "verified" ? "bg-emerald-500/20 text-emerald-200" : "text-white/80 hover:bg-white/10"}`}
            title="Show verified tweets totals"
          >
            Verified
          </button>
        </div>
      </div>

      {/* Row: totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile color="#3ef2ac" label="Tweets" value={compact(data.agg.tweets)} />
        <Tile color="#7dd3fc" label="Views" value={compact(data.agg.views)} />
        <Tile color="#fcd34d" label="Engagements" value={compact(data.agg.engagements)} />
        <Tile color="#d8b4fe" label="Eng Rate" value={pctText(data.agg.er)} />
      </div>

      {/* Row: averages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Tile color="#34d399" label="Avg Tweets" value={data.avg.avgTweetsPerDay.toFixed(2)} />
        <Tile color="#34d399" label="Avg Views" value={compact(data.avg.avgViewsPerTweet)} />
        <Tile color="#34d399" label="Avg Engs" value={compact(data.avg.avgEngsPerTweet)} />
        <Tile color="#a78bfa" label="Avg ER" value={pctText(data.avg.avgER)} />
      </div>

      {/* Row: ER buckets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <Tile color="#f9a8d4" label="ER < 1%" value={pctText(data.buckets.erShares.lt1)} />
        <Tile color="#f9a8d4" label="ER 1% ~ 2.5%" value={pctText(data.buckets.erShares._1_2_5)} />
        <Tile color="#f9a8d4" label="ER 2.5% ~ 5%" value={pctText(data.buckets.erShares._2_5_5)} />
        <Tile color="#f9a8d4" label="ER > 5%" value={pctText(data.buckets.erShares.gt5)} />
      </div>

      {/* Row: Views buckets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <Tile color="#7dd3fc" label="Views < 1K" value={pctText(data.buckets.viewShares.lt1k)} />
        <Tile color="#7dd3fc" label="Views 1K ~ 2.5K" value={pctText(data.buckets.viewShares._1k_2_5k)} />
        <Tile color="#7dd3fc" label="Views 2.5K ~ 5K" value={pctText(data.buckets.viewShares._2_5k_5k)} />
        <Tile color="#7dd3fc" label="Views > 5K" value={pctText(data.buckets.viewShares.gt5k)} />
      </div>
    </div>
  );
}

/** Small KPI tile */
function Tile({ color, label, value }: { color: string; label: string; value: string | number }) {
  const isER = /eng\s*rate|avg\s*er/i.test(label);
  return (
    <div
      className={`rounded-lg border border-white/10 px-3 py-2
        ${isER ? "bg-gradient-to-r from-[#27a567]/40 to-[#2fd480]/40 shadow-lg shadow-emerald-500/20" : "bg-white/5"}
        last:bg-gradient-to-r last:from-[#27a567]/40 last:to-[#2fd480]/40 last:shadow-lg last:shadow-emerald-500/20`}
    >
      <div
        className={`text-[11px] text-left
          ${isER ? "text-emerald-300 font-semibold uppercase" : "text-gray-400"}
          last:text-emerald-300 last:font-semibold last:uppercase`}
      >
        {label}
      </div>
      <div
        className={`mt-1
          ${isER
            ? "text-lg font-bold bg-gradient-to-r from-[#2fd480] to-[#3ef2ac] text-transparent bg-clip-text"
            : "text-sm text-white font-semibold"}
          last:text-lg last:font-bold last:bg-gradient-to-r last:from-[#2fd480] last:to-[#3ef2ac] last:text-transparent last:bg-clip-text`}
      >
        {value}
      </div>
    </div>
  );
}
