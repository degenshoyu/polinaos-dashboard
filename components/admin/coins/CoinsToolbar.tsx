"use client";

import { Preset, SortKey } from "./types";

type Props = {
  // filters
  preset: Preset;
  fromISO: string;
  toISO: string;
  onPresetChange: (p: Preset) => void;
  onFromChange: (iso: string) => void;
  onToChange: (iso: string) => void;
  onApply: () => void;
  loading: boolean;

  // search
  q: string;
  onQChange: (v: string) => void;
  onSearch: () => void;

  // sort & size
  sort: SortKey;
  asc: boolean;
  onSortChange: (s: SortKey) => void;
  onToggleOrder: () => void;
  pageSize: number;
  onSizeChange: (n: number) => void;

  // duplicates
  dupesOpen: boolean;
  onToggleDupes: () => void;
};

export default function CoinsToolbar({
  preset, fromISO, toISO, onPresetChange, onFromChange, onToChange, onApply, loading,
  q, onQChange, onSearch, sort, asc, onSortChange, onToggleOrder, pageSize, onSizeChange,
  dupesOpen, onToggleDupes
}: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Date presets & custom range */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value as Preset)}
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
          aria-label="Date range preset"
        >
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
          <option value="all">All time</option>
          <option value="custom">Custom</option>
        </select>

        {preset === "custom" && (
          <>
            <input
              type="datetime-local"
              value={fromISO.slice(0, 16)}
              onChange={(e) => onFromChange(new Date(e.target.value).toISOString())}
              className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
              aria-label="From (UTC)"
            />
            <input
              type="datetime-local"
              value={toISO.slice(0, 16)}
              onChange={(e) => onToChange(new Date(e.target.value).toISOString())}
              className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
              aria-label="To (UTC)"
            />
          </>
        )}

        <button
          onClick={onApply}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm disabled:opacity-60"
        >
          {loading ? "Loading…" : "Apply"}
        </button>

        <button
          onClick={onToggleDupes}
          className="px-3 py-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-sm"
          aria-expanded={dupesOpen}
          aria-controls="duplicates-panel"
        >
          {dupesOpen ? "Hide Duplicates" : "Show Duplicates"}
        </button>
      </div>

      {/* Search + sort + page size */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => onQChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
          placeholder="Search $TICKER or CA…"
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm w-56"
          aria-label="Search ticker or CA"
        />
        <button
          onClick={onSearch}
          className="px-2 py-2 rounded-md border border-white/10 hover:bg-white/10 text-sm"
        >
          Search
        </button>

        <select
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as any)}
          aria-label="Sort"
        >
          <option value="views">Sort: Views</option>
          <option value="tweets">Sort: Tweets</option>
          <option value="engs">Sort: Engagements</option>
          <option value="er">Sort: ER</option>
          <option value="kols">Sort: KOLs</option>
          <option value="followers">Sort: Followers</option>
          <option value="ticker">Sort: Ticker</option>
          <option value="ca">Sort: CA</option>
        </select>

        <button
          className="px-2 py-2 rounded-md border border-white/10 hover:bg-white/10 text-sm"
          onClick={onToggleOrder}
          aria-label="Toggle order"
        >
          {asc ? "Asc" : "Desc"}
        </button>

        <select
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          value={pageSize}
          onChange={(e) => onSizeChange(parseInt(e.target.value, 10))}
          aria-label="Rows per page"
        >
          {[20, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>
    </div>
  );
}
