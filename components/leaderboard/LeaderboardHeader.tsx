"use client";

import { Info } from "lucide-react";
import { Tooltip, Dropdown, MenuItem } from "./primitives";
import { usePriceRefreshQueue } from "@/hooks/usePriceRefreshQueue";
import { useMaxRoiProgress } from "@/hooks/useMaxRoiProgress";

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
  const price = usePriceRefreshQueue();
  const { total: pTotal, done: pDone, inFlight: pInFlight } = price.progress;
  const pUpdating = price.updating;
  const { progress: m } = useMaxRoiProgress(); // MAX ROI 进度
  const total = pTotal + m.total;
  const done = pDone + m.done;
  const inFlight = pInFlight + m.inFlight;
  const updating = pUpdating || m.updating;
  const initializing = total === 0 && done === 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const completed = !updating && total > 0 && done >= total;
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
        <div className="col-span-4 rounded-xl border border-white/10 bg-white/[0.03] p-2">
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
        <div className="col-span-6 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {/* Header row: title + mention price mode dropdown */}
          <div className="flex items-center justify-between pb-1">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-white">Coins</div>
            </div>

            <div className="flex items-center gap-3">
              {/* Fancy progress bar (shows only when updating / has remaining) */}
              <div
                className="flex items-center gap-2"
                aria-live="polite"
                aria-label={
                  updating
                    ? `Updating ${done} of ${total}${inFlight ? `, ${inFlight} in flight` : ""}`
                    : (completed ? "Update completed" : "Up to date")
                }
              >
                <div
                  className={[
                    "relative h-1.5 w-28 overflow-hidden rounded-full ring-1",
                    updating ? "bg-white/10 ring-amber-300/30" : "bg-white/10 ring-emerald-300/30",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "h-full transition-[width] duration-300",
                      updating ? "bg-amber-400 animate-pulse" : "bg-emerald-400",
                    ].join(" ")}
                    style={{ width: `${pct}%` }}
                  />
                  <div
                    className={[
                      "pointer-events-none absolute -inset-0.5 rounded-full blur-md",
                      updating ? "bg-amber-400/20" : "bg-emerald-400/20",
                    ].join(" ")}
                  />
                </div>

                <div
                  className={[
                    "text-[10px] tabular-nums",
                    updating ? "text-amber-200/90" : "text-emerald-200/90",
                  ].join(" ")}
                >
                  <span className="mr-1">
                    {initializing ? "Initializing..." : (updating ? "Updating..." : completed ? "Update completed" : "Up to date")}
                  </span>
                  {total > 0 && <span>{done}/{total}</span>}
                </div>
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
          </div>

          {/* Sub-headers for the ROI columns */}
          <div className="grid grid-cols-6 text-[11px] text-gray-400">
            <div className="text-left">Ticker</div>
            <div className="text-left">Ref. Px</div>
            <div className="text-left">Last Px</div>
            <div className="text-left">ROI Now</div>
            <div className="text-left">MAX ROI</div>
            <div className="text-left">MC</div>
          </div>
        </div>
      </div>
    </div>
  );
}
