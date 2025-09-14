"use client";

import { ChevronDown, CheckSquare, Edit3, Filter as FilterIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Preset = "7d" | "30d" | "all" | "custom";
export type SourceFilter = "all" | "coins" | "ca" | "ticker" | "phrase";

export default function TweetsToolbar({
  // date & preset
  preset, from, to,
  onPresetChange, onFromChange, onToChange,
  // username filter
  query, onQueryChange,
  // server controls
  size, onSizeChange, loading, onApply,
  // source filter
  sourceFilter, onSourceFilterChange,
  // edit coin control
  selectedCount, onToggleEdit, canEdit,
}: {
  preset: Preset;
  from: string;
  to: string;
  onPresetChange: (p: Preset) => void;
  onFromChange: (iso: string) => void;
  onToChange: (iso: string) => void;

  query: string;
  onQueryChange: (v: string) => void;

  size: number;
  onSizeChange: (n: number) => void;

  loading: boolean;
  onApply: () => void;

  sourceFilter: SourceFilter;
  onSourceFilterChange: (v: SourceFilter) => void;

  selectedCount: number;
  onToggleEdit: () => void;
  canEdit: boolean;
}) {
  // dropdown for source
  const [srcOpen, setSrcOpen] = useState(false);
  const srcRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!srcOpen) return;
      if (!srcRef.current) return;
      if (!srcRef.current.contains(e.target as Node)) setSrcOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [srcOpen]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: username + preset + custom range */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="px-3 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          placeholder="Filter by @username…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
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
              value={from.slice(0, 16)}
              onChange={(e) => onFromChange(new Date(e.target.value).toISOString())}
              className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
              aria-label="From (UTC)"
            />
            <input
              type="datetime-local"
              value={to.slice(0, 16)}
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
      </div>

      {/* Right: source filter + edit coin + size */}
      <div className="flex items-center gap-2">
        {/* Source filter dropdown */}
        <div className="relative" ref={srcRef}>
          <button
            type="button"
            onClick={() => setSrcOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-2 py-2 rounded-md border border-white/10 bg-black/30 hover:bg-white/10 text-sm"
            aria-haspopup="listbox"
            aria-expanded={srcOpen}
            title="Filter by mention source"
          >
            <FilterIcon size={14} />
            <span>
              {sourceFilter === "all"
                ? "Source (All)"
                : sourceFilter === "coins"
                ? "Source (All coins)"
                : `Source (${sourceFilter})`}
            </span>
            <ChevronDown size={14} />
          </button>
          {srcOpen && (
            <div
              className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-white/10 bg-[#0B0B0E] shadow-xl p-2"
              role="listbox"
              aria-label="Source filter"
            >
              {(["all", "coins", "ca", "ticker", "phrase"] as const).map((opt) => (
                <button
                  key={opt}
                  className={`w-full text-left px-2 py-2 rounded-md text-sm hover:bg-white/10 ${
                    sourceFilter === opt ? "bg-white/10" : ""
                  }`}
                  onClick={() => {
                    onSourceFilterChange(opt);
                    setSrcOpen(false);
                  }}
                  role="option"
                  aria-selected={sourceFilter === opt}
                >
                  {opt === "all" ? "All" : opt === "coins" ? "All coins" : opt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Edit coin */}
        <button
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md border border-white/10 hover:bg-white/10 text-sm disabled:opacity-60"
          onClick={onToggleEdit}
          disabled={!canEdit}
          title="Edit selected tweets' coin"
        >
          <Edit3 size={16} /> Edit coin
        </button>

        {/* Rows per page */}
        <select
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          value={size}
          onChange={(e) => onSizeChange(parseInt(e.target.value, 10))}
          aria-label="Rows per page"
        >
          {[20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
