"use client";

import { Info } from "lucide-react";
import { Tooltip, Dropdown, MenuItem } from "./primitives";
import { usePriceRefreshQueue } from "@/hooks/usePriceRefreshQueue";

/** Mention price picking strategy used across the leaderboard. */
export type MentionMode = "earliest" | "latest" | "lowest" | "highest";

export function LeaderboardHeader({
  days,
  totalTooltip,
  shillTooltip,
  mentionMode = "earliest",
  onChangeMentionMode,
}: {
  days: number;
  totalTooltip: React.ReactNode;
  shillTooltip: React.ReactNode;
  /** Current mention-price picking strategy shown in header's dropdown. */
  mentionMode?: MentionMode;
  /** Optional callback to notify parent when user picks a different strategy. */
  onChangeMentionMode?: (m: MentionMode) => void;
}) {
  // Global queue progress shown at header (Coins, right side)
  const queue = usePriceRefreshQueue();
  const { total, done, inFlight } = queue.progress;
  const updating = queue.updating;
  const showProg = updating || (total > 0 && done < total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // Human-friendly label for the dropdown
  const modeLabel = (m: MentionMode) =>
    m === "earliest"
      ? "Earliest"
      : m === "latest"
      ? "Latest"
      : m === "lowest"
      ? "Lowest"
      : "Highest";

  return (
    <div className="px-3 pt-3 pb-2">
      <div className="grid grid-cols-12 items-start gap-2">
        {/* KOL card */}
        <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="text-sm font-extrabold text-white">KOL</div>
          <div className="text-[11px] text-gray-400">Handle / followers</div>
        </div>

        {/* Twitter Metrics */}
        <div className="col-span-5 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center gap-3 pb-1">
            <span className="text-sm font-extrabold text-white">Twitter Metrics</span>
            <Tooltip text={totalTooltip}>
              <Info size={14} className="text-gray-300" />
            </Tooltip>
          </div>
          <div className="grid grid-cols-4 text-[11px] text-gray-400">
            <div className="text-left">Tweets</div>
            <div className="text-left">Views</div>
            <div className="text-left">Engs</div>
            <div className="text-left">ER</div>
          </div>
        </div>

        {/* Coins (ROI) card */}
        <div className="col-span-5 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {/* Header row: title + mention price mode dropdown */}
          <div className="flex items-center justify-between pb-1">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-white">Coins</div>
            </div>

            <div className="flex items-center gap-3">
              {/* Fancy progress bar (shows only when updating / has remaining) */}
              {showProg && (
                <div
                  className="flex items-center gap-2"
                  aria-live="polite"
                  aria-label={`Updating prices ${done} of ${total}${inFlight ? `, ${inFlight} in flight` : ""}`}
                >
                  {/* progress bar with amber color & pulse */}
                  <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-white/10 ring-1 ring-amber-300/30">
                    {/* fill */}
                    <div
                      className="h-full bg-amber-400 transition-[width] duration-300 animate-pulse"
                      style={{ width: `${pct}%` }}
                    />
                    {/* ambient glow */}
            <div className="pointer-events-none absolute -inset-0.5 rounded-full bg-amber-400/20 blur-md" />
          </div>

          {/* label + counter */}
          <div className="text-[10px] tabular-nums text-amber-200/90">
            <span className="mr-1">Updating price...</span>
            {done}/{total}
          </div>
        </div>
      )}

              {/* Mention price picker - optional; only shown if handler provided */}
              {onChangeMentionMode && (
                <Dropdown label={`Mention: ${modeLabel(mentionMode)}`}>
                  <MenuItem
                    active={mentionMode === "earliest"}
                    onClick={() => onChangeMentionMode("earliest")}
                  >
                    Earliest
                  </MenuItem>
                  <MenuItem
                    active={mentionMode === "latest"}
                    onClick={() => onChangeMentionMode("latest")}
                  >
                    Latest
                  </MenuItem>
                  <MenuItem
                    active={mentionMode === "lowest"}
                    onClick={() => onChangeMentionMode("lowest")}
                  >
                    Lowest
                  </MenuItem>
                  <MenuItem
                    active={mentionMode === "highest"}
                    onClick={() => onChangeMentionMode("highest")}
                  >
                    Highest
                  </MenuItem>
                </Dropdown>
              )}
            </div>
          </div>

          {/* Sub-headers for the ROI columns */}
          <div className="grid grid-cols-5 text-[11px] text-gray-400">
            <div className="text-left">Token</div>
            <div className="text-left">Mention</div>
            <div className="text-left">Current</div>
            <div className="text-left">ROI</div>
            <div className="text-left">MC</div>
          </div>
        </div>
      </div>
    </div>
  );
}
