// components/leaderboard/KolsHeaderControls.tsx

"use client";

import { CalendarDays, ArrowUpDown, Search, Filter } from "lucide-react";
import { Dropdown, MenuItem } from "./primitives";

export type SortKey = "tweets" | "views" | "engs" | "er";
export type ScopeKey = "total" | "shills";

export type CoinOpt = { tokenKey: string; tokenDisplay: string; count: number };

export function KolsHeaderControls({
  days,
  sortKey,
  scope,
  query,
  coinKey,
  coins,
  onSetDays,
  onSetSortKey,
  onSetScope,
  onQueryChange,
  onSetCoinKey,
}: {
  days: 7 | 30;
  sortKey: SortKey;
  scope: ScopeKey;
  query: string;
  coinKey: string | null;
  coins: CoinOpt[];
  onSetDays: (d: 7 | 30) => void;
  onSetSortKey: (k: SortKey) => void;
  onSetScope: (s: ScopeKey) => void;
  onQueryChange: (q: string) => void;
  onSetCoinKey: (k: string | null) => void;
}) {
  return (
    <div className="relative z-[60] w-full flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-visible [-webkit-overflow-scrolling:touch]">
      {/* Search (controlled width; inline with the rest) */}
      <div className="relative z-[60] shrink-0 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 min-w-[240px] max-w-[380px] w-[min(38vw,380px)]">
        <Search size={16} className="text-gray-400" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search handle or name…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
          aria-label="Search KOLs"
        />
      </div>

      {/* Right group */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* Period */}
        <Dropdown
          label={`${days === 7 ? "7d" : "30d"} Period`}
          icon={<CalendarDays size={16} className="text-gray-300" />}
        >
          <MenuItem active={days === 7} onClick={() => onSetDays(7)}>7 days</MenuItem>
          <MenuItem active={days === 30} onClick={() => onSetDays(30)}>30 days</MenuItem>
        </Dropdown>

        {/* Sort metric (only four options) */}
        <Dropdown
          label={
            sortKey === "tweets" ? "Sort: Tweets" :
            sortKey === "views" ? "Sort: Views" :
            sortKey === "engs" ? "Sort: Engagements" :
            "Sort: ER"
          }
          icon={<ArrowUpDown size={16} className="text-gray-300" />}
        >
          <MenuItem active={sortKey === "tweets"} onClick={() => onSetSortKey("tweets")}>Tweets</MenuItem>
          <MenuItem active={sortKey === "views"} onClick={() => onSetSortKey("views")}>Views</MenuItem>
          <MenuItem active={sortKey === "engs"} onClick={() => onSetSortKey("engs")}>Engagements</MenuItem>
          <MenuItem active={sortKey === "er"} onClick={() => onSetSortKey("er")}>ER</MenuItem>
        </Dropdown>

        {/* Scope toggle: Total | Shills */}
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => onSetScope("total")}
            className={[
              "px-3 py-1 text-sm rounded-md",
              scope === "total" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={scope === "total"}
          >
            Total
          </button>
          <button
            onClick={() => onSetScope("shills")}
            className={[
              "px-3 py-1 text-sm rounded-md",
              scope === "shills" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={scope === "shills"}
          >
            Shills
          </button>
        </div>

        {/* Coin filter */}
        <Dropdown
          label={coinKey ? `Coin: ${coins.find(c => c.tokenKey === coinKey)?.tokenDisplay ?? "Selected"}` : "Coin: All"}
          icon={<Filter size={16} className="text-gray-300" />}
        >
          <MenuItem active={!coinKey} onClick={() => onSetCoinKey(null)}>All coins</MenuItem>
          <div className="my-1 h-px bg-white/10" />
          {coins.slice(0, 100).map((c) => (
            <MenuItem
              key={c.tokenKey}
              active={coinKey === c.tokenKey}
              onClick={() => onSetCoinKey(c.tokenKey)}
            >
              <span className="truncate">{c.tokenDisplay}</span>
              <span className="text-xs opacity-70">×{c.count}</span>
            </MenuItem>
          ))}
        </Dropdown>
      </div>
    </div>
  );
}
