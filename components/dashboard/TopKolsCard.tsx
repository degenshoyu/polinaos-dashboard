// components/dashboard/TopKolsCard.tsx
"use client";

/**
 * Top KOLs card (list-only, no charts).
 * - Header icon: Users (theme-appropriate).
 * - Each row: Avatar(left, larger) + Rank + HandlePill + followers + right metric value.
 * - Avatar is moved out of the pill so we can scale it up without altering row height.
 * - Show up to 10 rows.
 * - Fully keyboard accessible.
 */

import * as React from "react";
import { Users } from "lucide-react";
import clsx from "clsx";
import { HandlePill, rankEmoji, fmtCompact, fmtPct, AvatarCircle } from "./LeaderboardBits";

type KolRow = { handle: string; avatarUrl: string | null; followers: number; value: number };

export type TopKolsData = {
  avgRoi: KolRow[];
  coinShills: KolRow[];
  coinsViews: KolRow[];
  coinsEngs: KolRow[];
};

type Metric = "avgRoi" | "coinShills" | "coinsViews" | "coinsEngs";

export default function TopKolsCard({ days, data }: { days: 7 | 30; data: TopKolsData }) {
  const [metric, setMetric] = React.useState<Metric>("avgRoi");
  const rows = (data[metric] ?? []).slice(0, 10);

  const metricLabel = (k: Metric) =>
    k === "avgRoi" ? "Avg ROI" : k === "coinShills" ? "Coin Shills" : k === "coinsViews" ? "Coins Views" : "Coins Engs";

  const rightValue = (r: KolRow) => (metric === "avgRoi" ? fmtPct(r.value) : fmtCompact(r.value));

  return (
    <div
      className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
    >
      {/* Glow */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
        }}
        aria-hidden
      />

      {/* Header */}
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-[18px] w-[18px] text-emerald-300" />
          <div className="font-medium">
            Top KOLs <span className="opacity-70">({days}d)</span>
          </div>
        </div>

        {/* Metric tabs */}
        <div className="flex items-center gap-2">
          {(["avgRoi", "coinShills", "coinsViews", "coinsEngs"] as const).map((k) => {
            const active = metric === k;
            return (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={clsx(
                  "text-xs rounded-full px-2.5 py-1 border transition-colors",
                  active ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-gray-300 hover:bg-white/5"
                )}
              >
                {metricLabel(k)}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No data for this metric.</div>
      ) : (
        <ul className="relative space-y-2 text-sm">
          {rows.map((r, idx) => (
            <li
              key={r.handle}
              className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30
                         transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                         hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* Avatar on the far left (larger, does not change row height) */}
                <AvatarCircle src={r.avatarUrl ?? undefined} sizePx={24} />

                {/* Rank medal / index */}
                <span className="w-8 text-center">{rankEmoji(idx)}</span>

                {/* @handle pill (no avatar inside) */}
                <HandlePill handle={r.handle} href={`https://x.com/${r.handle}`} />

                {/* Followers (tiny note) */}
                <span className="text-[11px] text-gray-400 tabular-nums">· {fmtCompact(r.followers)} followers</span>
              </div>

              <span className="tabular-nums text-gray-200 font-semibold">{rightValue(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

