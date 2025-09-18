"use client";

import { Info } from "lucide-react";
import { Tooltip, Dropdown, MenuItem } from "./primitives";

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

          {/* Sub-headers for the ROI columns */}
          <div className="grid grid-cols-4 text-[11px] text-gray-400">
            <div className="text-left">Token</div>
            <div className="text-left">Mention</div>
            <div className="text-left">Current</div>
            <div className="text-left">ROI</div>
          </div>
        </div>
      </div>
    </div>
  );
}
