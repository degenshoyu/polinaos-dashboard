"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Preset, SortKey } from "./types";

/** Option shape from /api/kols/list */
type KolOption = {
  value: string;        // twitter_username (lowercase, no leading @)
  label: string;        // "Display Name (@username)"
  followers: number;
  avatar?: string | null;
};

type Props = {
  // ----- date filters -----
  preset: Preset;
  fromISO: string;
  toISO: string;
  onPresetChange: (p: Preset) => void;
  onFromChange: (iso: string) => void;
  onToChange: (iso: string) => void;
  onApply: () => void;
  loading: boolean;

  // ----- search -----
  q: string;
  onQChange: (v: string) => void;
  onSearch: () => void;

  // ----- sort & size -----
  sort: SortKey;
  asc: boolean;
  onSortChange: (s: SortKey) => void;
  onToggleOrder: () => void;
  pageSize: number;
  onSizeChange: (n: number) => void;

  // ----- duplicates panel -----
  dupesOpen: boolean;
  onToggleDupes: () => void;

  // ----- NEW: select one or multiple KOLs (by twitter_username) -----
  selectedKols: string[]; // e.g. ["elonmusk", "binance"]
  onSelectedKolsChange: (list: string[]) => void;

  // (Deprecated) Kept only for backward compatibility of parent signature.
  // This prop is ignored in UI now.
  topKolsOnly?: boolean;
  onTopKolsOnlyChange?: (v: boolean) => void;
};

export default function CoinsToolbar({
  preset, fromISO, toISO, onPresetChange, onFromChange, onToChange, onApply, loading,
  q, onQChange, onSearch, sort, asc, onSortChange, onToggleOrder, pageSize, onSizeChange,
  dupesOpen, onToggleDupes,
  selectedKols, onSelectedKolsChange,
}: Props) {
  // ---------- KOL multi-select dropdown state ----------
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<KolOption[]>([]);
  const [fetching, setFetching] = useState(false);
  const popref = useRef<HTMLDivElement | null>(null);

  // Close on click outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      if (!popref.current) return;
      if (!popref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Debounced fetch of options from /api/kols/list
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        setFetching(true);
        const params = new URLSearchParams();
        if (search.trim()) params.set("q", search.trim());
        params.set("limit", "200");
        const r = await fetch(`/api/kols/list?${params.toString()}`);
        const data = await r.json();
        if (!alive) return;
        const items: any[] = Array.isArray(data?.items) ? data.items : [];
        setOptions(
          items.map((it) => ({
            value: (it.value || it.username || "").toLowerCase(),
            label: it.label || (it.displayName ? `${it.displayName} (@${it.username})` : `@${it.username}`),
            followers: Number(it.followers ?? 0),
            avatar: it.avatar ?? it.profileImgUrl ?? null,
          })),
        );
      } catch {
        if (alive) setOptions([]);
      } finally {
        if (alive) setFetching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, search]);

  // Helpers
  const selectedSet = useMemo(() => new Set(selectedKols.map((s) => s.toLowerCase())), [selectedKols]);

  const toggleValue = (v: string) => {
    const key = v.toLowerCase();
    if (selectedSet.has(key)) {
      onSelectedKolsChange(selectedKols.filter((x) => x.toLowerCase() !== key));
    } else {
      onSelectedKolsChange([...selectedKols, key]);
    }
  };

  const removeValue = (v: string) => {
    const key = v.toLowerCase();
    onSelectedKolsChange(selectedKols.filter((x) => x.toLowerCase() !== key));
  };

  const clearAll = () => onSelectedKolsChange([]);

  const selectAllPage = () => {
    // Add all currently listed options
    const union = new Set<string>(selectedKols.map((x) => x.toLowerCase()));
    for (const o of options) union.add(o.value.toLowerCase());
    onSelectedKolsChange(Array.from(union));
  };

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

      {/* Search + KOLs multi-select + sort + size */}
      <div className="flex items-center gap-2">
        {/* NEW: KOLs multi-select */}
        <div className="relative" ref={popref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-2 py-2 rounded-md border border-white/10 bg-black/30 hover:bg-white/10 text-sm"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            KOLs
            {selectedKols.length > 0 && (
              <span className="text-xs rounded-full px-1.5 py-0.5 bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                {selectedKols.length}
              </span>
            )}
          </button>

          {open && (
            <div
              className="absolute right-0 z-20 mt-2 w-[360px] rounded-xl border border-white/10 bg-[#0B0B0E] shadow-xl p-3"
              role="dialog"
            >
              {/* Search box */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search KOL…"
                  className="w-full px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
                  aria-label="Search KOL"
                />
                <button
                  onClick={clearAll}
                  className="px-2 py-2 rounded-md border border-white/10 hover:bg-white/10 text-xs"
                  title="Clear all selected"
                >
                  Clear
                </button>
              </div>

              {/* Selected chips */}
              {selectedKols.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedKols.map((u) => (
                    <span
                      key={u}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-xs"
                    >
                      @{u}
                      <button
                        onClick={() => removeValue(u)}
                        className="ml-0.5 -mr-0.5 h-4 w-4 inline-flex items-center justify-center rounded hover:bg-white/20"
                        aria-label={`Remove @${u}`}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Options list */}
              <div className="max-h-72 overflow-auto rounded-md border border-white/10">
                {fetching ? (
                  <div className="p-3 text-sm text-gray-400">Loading…</div>
                ) : options.length === 0 ? (
                  <div className="p-3 text-sm text-gray-400">No results</div>
                ) : (
                  <ul role="listbox" aria-label="KOL options" className="divide-y divide-white/10">
                    {options.map((o) => {
                      const checked = selectedSet.has(o.value.toLowerCase());
                      return (
                        <li
                          key={o.value}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer"
                          onClick={() => toggleValue(o.value)}
                          role="option"
                          aria-selected={checked}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleValue(o.value)}
                            className="h-4 w-4"
                            aria-label={`Select @${o.value}`}
                          />
                          <div className="flex items-center gap-2">
                            {o.avatar ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={o.avatar}
                                alt=""
                                className="h-6 w-6 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-6 w-6 rounded-full bg-white/10" />
                            )}
                            <div className="flex flex-col leading-tight">
                              <span className="text-sm text-gray-100">{o.label}</span>
                              <span className="text-[11px] text-gray-400">
                                {Intl.NumberFormat("en", { notation: "compact" }).format(o.followers)} followers
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Footer actions */}
              <div className="mt-2 flex items-center justify-between">
                <button
                  className="px-2 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-xs"
                  onClick={selectAllPage}
                >
                  Select all results
                </button>
                <button
                  className="px-2 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-xs"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Free-text search */}
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

        {/* Sort */}
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

        {/* Order */}
        <button
          className="px-2 py-2 rounded-md border border-white/10 hover:bg-white/10 text-sm"
          onClick={onToggleOrder}
          aria-label="Toggle order"
        >
          {asc ? "Asc" : "Desc"}
        </button>

        {/* Page size */}
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
