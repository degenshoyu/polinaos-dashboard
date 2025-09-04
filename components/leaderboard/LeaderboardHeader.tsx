"use client";

import { Info } from "lucide-react";
import { Tooltip } from "./primitives";

export function LeaderboardHeader({
  days,
  totalTooltip,
  shillTooltip,
}: {
  days: number;
  totalTooltip: React.ReactNode;
  shillTooltip: React.ReactNode;
}) {
  return (
    <div className="px-3 pt-3 pb-2">
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* KOL card */}
        <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="text-sm font-extrabold text-white">KOL</div>
          <div className="text-[11px] text-gray-400">Handle / followers</div>
        </div>

        {/* Total card */}
        <div className="col-span-4 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-2 pb-1">
            <span className="text-sm font-extrabold text-white">Total</span>
            <Tooltip text={totalTooltip}><Info size={14} className="text-gray-300" /></Tooltip>
          </div>
          <div className="grid grid-cols-4 text-[11px] text-gray-400">
            <div className="text-left">Tweets</div>
            <div className="text-left">Views</div>
            <div className="text-left">Engs</div>
            <div className="text-left">ER</div>
          </div>
        </div>

        {/* Shills card */}
        <div className="col-span-4 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-2 pb-1">
            <span className="text-sm font-extrabold text-white">Shills</span>
            <Tooltip text={shillTooltip}><Info size={14} className="text-gray-300" /></Tooltip>
          </div>
          <div className="grid grid-cols-4 text-[11px] text-gray-400">
            <div className="text-left">Tweets</div>
            <div className="text-left">Views</div>
            <div className="text-left">Engs</div>
            <div className="text-left">ER</div>
          </div>
        </div>

        {/* Coins card */}
        <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="text-sm font-extrabold text-white">Coins</div>
          <div className="text-[11px] text-gray-400">Top shilled (last {days}d)</div>
        </div>
      </div>
    </div>
  );
}
