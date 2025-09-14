// components/admin/coins/TweetListModal.tsx

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TweetItem, TopKol } from "./types";
import { fmtNum } from "./types";
import {
  X,
  RefreshCcw,
  DollarSign,
  Edit3,
  Trash2,
  Search,
  ChevronDown,
  CheckSquare,
  Filter as FilterIcon,
} from "lucide-react";

/** Compute days so that the backend window (now - days) covers the 'from' time. */
function daysSince(fromISO: string) {
  const ms = Date.now() - new Date(fromISO).getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Format USD price from string/number into a readable value. */
function fmtPrice(p?: string | number | null) {
  if (p == null) return "—";
  const n = typeof p === "string" ? Number(p) : p;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(n);
}

/** Row status for per-tweet progress */
type RowStatus = "idle" | "pending" | "ok" | "err";

/** Coin option from coin_ca_ticker search */
type CoinOption = {
  id: string;
  tokenTicker: string;
  contractAddress: string;
};

/** Small helper for shortening a contract address */
const shortCa = (ca?: string | null) =>
  !ca ? "" : ca.length >= 8 ? `${ca.slice(0, 4)}…${ca.slice(-4)}` : ca;

/** Build token_display text */
const buildDisplay = (opt: CoinOption) => `$${opt.tokenTicker}`;

// ---- API endpoints (fixed to your paths)
const API_TWEETS = "/api/kols/coins/tweets"; // list tweets for scope
const API_SEARCH_COINS = "/api/kols/coins/search"; // search coin_ca_ticker
const API_BULK_SET_COIN = "/api/kols/mentions/bulk-set-coin"; // bulk update selected tweets' coin
const API_DELETE_AND_EXCLUDE = "/api/kols/mentions/delete-and-exclude"; // delete one tweet mentions + excluded=true

export default function TweetListModal({
  open,
  onClose,
  fromISO,
  toISO,
  scope, // { ticker?: string | null; ca?: string | null }
}: {
  open: boolean;
  onClose: () => void;
  fromISO: string;
  toISO: string;
  scope: { ticker?: string | null; ca?: string | null };
}) {
  // data
  const [items, setItems] = useState<TweetItem[]>([]);
  const [topKols, setTopKols] = useState<TopKol[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // paging
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // filters
  const [selectedKols, setSelectedKols] = useState<Set<string>>(new Set());
  const [kolMenuOpen, setKolMenuOpen] = useState(false);
  const [onlyNoPrice, setOnlyNoPrice] = useState(false);

  type SourceFilter = "all" | "ca" | "ticker" | "phrase";
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)

  // light loading flags
  const [pageLoading, setPageLoading] = useState(false);

  // per-row status + bulk progress
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  // selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // edit coin panel
  const [editOpen, setEditOpen] = useState(false);
  const [coinTerm, setCoinTerm] = useState("");
  const [coinOpts, setCoinOpts] = useState<CoinOption[]>([]);
  const [coinLoading, setCoinLoading] = useState(false);
  const [coinErr, setCoinErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CoinOption | null>(null);
  const searchDebounce = useRef<NodeJS.Timeout | null>(null);

  const title = useMemo(() => {
    if (scope.ticker) return `Tweets for $${scope.ticker}`;
    if (scope.ca) return `Tweets for CA ${scope.ca}`;
    return "Tweets";
  }, [scope]);

  /** Visible rows (respect TopKOL filter) */
  const visibleItems = useMemo(() => {
    const byKols =
      selectedKols.size === 0
        ? items
        : items.filter((it) => selectedKols.has(it.username));
    return onlyNoPrice ? byKols.filter((it) => !it.priceUsdAt) : byKols;
  }, [items, selectedKols, onlyNoPrice]);
  const allSelected =
    visibleItems.length > 0 &&
    visibleItems.every((it) => selectedIds.has(it.tweetId));

  const clearSelection = () => setSelectedIds(new Set());
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleItems.forEach((it) => next.delete(it.tweetId));
      } else {
        visibleItems.forEach((it) => next.add(it.tweetId));
      }
      return next;
    });
  };
  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Load a page from /api/kols/coins/tweets (does NOT block per-row buttons) */
  const fetchPage = async (p: number) => {
    setPageLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("from", fromISO);
      sp.set("to", toISO);
      sp.set("page", String(p));
      sp.set("pageSize", String(pageSize));
      if (scope.ticker) sp.set("ticker", scope.ticker);
      if (scope.ca) sp.set("ca", scope.ca);
      if (sourceFilter !== "all") sp.set("source", sourceFilter);
      const r = await fetch(`${API_TWEETS}?${sp.toString()}`, {
        cache: "no-store",
      });
      const ct = r.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await r.json()
        : { ok: false, error: "invalid response" };
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "load failed");
      setItems(data.items as TweetItem[]);
      setTopKols(data.topKols as TopKol[]);
      setTotal(Number(data.total || 0));
      setPage(p);
      // reset state after fresh load
      setRowStatus({});
      clearSelection();
      setEditOpen(false);
      setChosen(null);
      setCoinTerm("");
      setCoinOpts([]);
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // reset when opening or scope changes
    setItems([]);
    setTopKols([]);
    setPage(1);
    setTotal(0);
    setSelectedKols(new Set());
    setOnlyNoPrice(false);
    setSourceFilter("all");
    setRowStatus({});
    setBulkRunning(false);
    setBulkDone(0);
    setBulkTotal(0);
    clearSelection();
    setEditOpen(false);
    setChosen(null);
    setCoinTerm("");
    setCoinOpts([]);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope?.ticker, scope?.ca, fromISO, toISO]);

  // Whenever `sourceFilter` changes, refetch page 1 with the latest value.
  useEffect(() => {
    if (!open) return;
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter]);

  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));

  /** Broad fill (backend fills ONLY NULL prices). Supports optional author + current scope. */
  const fillPricesBroad = async (opts: { screenName?: string }) => {
    const body = {
      screen_name: opts.screenName, // optional: narrow to a single user
      days: daysSince(fromISO),
      limit: 300,
      onlyCA: true,
      network: "solana",
      debug: false,
      tryPools: 3,
      graceSeconds: 90,
      // pass current modal scope so backend only touches relevant mentions
      ticker: scope.ticker ?? undefined,
      ca: scope.ca ?? undefined,
    };
    const r = await fetch("/api/kols/fill-mention-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json")
      ? await r.json()
      : { ok: false, error: "invalid response" };
    if (!r.ok || !data?.ok)
      throw new Error(data?.error ?? `Fill prices failed (HTTP ${r.status})`);
    return data as { ok: true; updated: number; scanned: number };
  };

  /** Precise fill for a single mention scope: tweetId + tokenKey (CA). */
  const fillExactForMention = async (tweetId: string, tokenKey: string) => {
    const r = await fetch("/api/kols/fill-mention-prices-tweet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tweetId,
        tokenKey,
        network: "solana",
        tryPools: 3,
        graceSeconds: 90,
        debug: false,
      }),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json")
      ? await r.json()
      : { ok: false, error: "invalid response" };
    if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
    return data as { ok: true; updated: number; price?: number };
  };

  /** Update one row: prefer precise (has CA), fallback to broad (by author). */
  const updateOneRow = async (tweetId: string, username: string) => {
    setRowStatus((m) => ({ ...m, [tweetId]: "pending" }));
    try {
      if (scope.ca) {
        await fillExactForMention(tweetId, scope.ca);
      } else {
        await fillPricesBroad({ screenName: username });
      }
      setRowStatus((m) => ({ ...m, [tweetId]: "ok" }));
      await fetchPage(page);
    } catch (e: any) {
      setRowStatus((m) => ({ ...m, [tweetId]: "err" }));
      setErr(e?.message ?? "update failed");
    }
  };

  /** Bulk update helper over a list of tweet rows (sequential, with progress). */
  const runBulk = async (targetRows: TweetItem[]) => {
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(targetRows.length);

    // If CA exists in scope, use precise for each row; else dedupe authors and use broad.
    const processedUsers = new Set<string>();

    for (const it of targetRows) {
      setRowStatus((m) => ({ ...m, [it.tweetId]: "pending" }));
      try {
        if (scope.ca) {
          await fillExactForMention(it.tweetId, scope.ca);
        } else {
          if (!processedUsers.has(it.username)) {
            await fillPricesBroad({ screenName: it.username });
            processedUsers.add(it.username);
          }
        }
        setRowStatus((m) => ({ ...m, [it.tweetId]: "ok" }));
      } catch {
        setRowStatus((m) => ({ ...m, [it.tweetId]: "err" }));
      } finally {
        setBulkDone((d) => d + 1);
      }
    }

    await fetchPage(page);
    setBulkRunning(false);
  };

  /** Bulk: update all rows currently visible (backend still fills NULL only). */
  const onUpdateAllPage = async () => {
    await runBulk(visibleItems);
  };

  /** Bulk: update only rows with NULL prices (UI-level filter). */
  const onUpdateNullOnly = async () => {
    const nulls = visibleItems.filter((it) => !it.priceUsdAt);
    await runBulk(nulls);
  };

  /** Debounced search coins from coin_ca_ticker for "Edit coin" panel */
  useEffect(() => {
    if (!editOpen) return;
    setCoinErr(null);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      const q = coinTerm.trim();
      if (!q) {
        setCoinOpts([]);
        return;
      }
      setCoinLoading(true);
      try {
        const sp = new URLSearchParams();
        sp.set("q", q);
        sp.set("limit", "20");
        const r = await fetch(`${API_SEARCH_COINS}?${sp.toString()}`, {
          cache: "no-store",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data?.ok)
          throw new Error(data?.error ?? `HTTP ${r.status}`);
        setCoinOpts((data.items ?? []) as CoinOption[]);
      } catch (e: any) {
        setCoinErr(e?.message ?? "search failed");
      } finally {
        setCoinLoading(false);
      }
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinTerm, editOpen]);

  /** Save the selected coin to all selected tweets */
  const onSaveEdit = async () => {
    if (!chosen || selectedIds.size === 0) return;
    try {
      const body = {
        tweetIds: Array.from(selectedIds),
        newTokenKey: chosen.contractAddress,
        newTokenDisplay: buildDisplay(chosen),
      };
      const r = await fetch(API_BULK_SET_COIN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      await fetchPage(page);
      setEditOpen(false);
      setChosen(null);
      setCoinTerm("");
      setCoinOpts([]);
      clearSelection();
    } catch (e: any) {
      setErr(e?.message ?? "edit failed");
    }
  };

  /** Delete this tweet's mentions and mark excluded=true */
  const onDeleteTweet = async (tweetId: string) => {
    const ok = window.confirm(
      "Remove mentions for this tweet and mark it excluded?",
    );
    if (!ok) return;
    try {
      const r = await fetch(API_DELETE_AND_EXCLUDE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweetId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      await fetchPage(page);
    } catch (e: any) {
      setErr(e?.message ?? "delete failed");
    }
  };

  const bulkPct = bulkTotal > 0 ? Math.round((bulkDone / bulkTotal) * 100) : 0;

  return (
    <div
      className={`fixed inset-0 z-[100] ${
        open ? "" : "pointer-events-none opacity-0"
      } transition`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Panel */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1000px,95vw)] max-h-[92vh]
                      rounded-2xl border border-white/15 bg-black/90 backdrop-blur p-4 overflow-hidden shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <div className="flex items-center gap-2">
            {/* Bulk price actions */}
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
              title="Fill prices for all tweets in the list (backend fills NULL only)"
              onClick={onUpdateAllPage}
              disabled={bulkRunning || pageLoading}
            >
              <DollarSign size={14} /> Update all on page
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
              title="Fill prices for tweets with NULL price only (backend fills NULL only)"
              onClick={onUpdateNullOnly}
              disabled={bulkRunning || pageLoading}
            >
              <RefreshCcw size={14} /> Update null prices
            </button>
            {/* New: Edit coin (requires selection) */}
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
              title="Edit selected tweets' coin (token_key/display) and reset price_usd_at"
              onClick={() => setEditOpen((v) => !v)}
              disabled={bulkRunning || pageLoading || selectedIds.size === 0}
            >
              <Edit3 size={14} /> Edit coin
            </button>
            <button
              aria-label="Close"
              onClick={onClose}
              className="p-1 rounded-md border border-white/10 hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Edit coin panel */}
        {editOpen && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2">
              <Search size={14} className="opacity-70" />
              <input
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-500"
                placeholder="Search coin by ticker or contract address…"
                value={coinTerm}
                onChange={(e) => setCoinTerm(e.target.value)}
                autoFocus
              />
              <div className="text-xs text-gray-400">
                Selected:{" "}
                <b className="text-white">
                  {chosen ? buildDisplay(chosen) : "—"}
                </b>
              </div>
            </div>
            {coinErr && (
              <div className="mt-2 text-xs text-red-400">{coinErr}</div>
            )}
            <div className="mt-2 max-h-40 overflow-auto rounded border border-white/10">
              {coinLoading && (
                <div className="p-2 text-xs text-gray-400">Searching…</div>
              )}
              {!coinLoading && coinOpts.length === 0 && coinTerm && (
                <div className="p-2 text-xs text-gray-400">No results</div>
              )}
              {!coinLoading && coinOpts.length > 0 && (
                <ul className="text-sm">
                  {coinOpts.map((opt) => (
                    <li
                      key={opt.id}
                      className={`px-3 py-2 cursor-pointer hover:bg-white/10 ${
                        chosen?.id === opt.id ? "bg-white/10" : ""
                      }`}
                      onClick={() => setChosen(opt)}
                      title={opt.contractAddress}
                    >
                      <span className="font-medium">${opt.tokenTicker}</span>{" "}
                      <span className="text-gray-400">
                        ({shortCa(opt.contractAddress)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
              <div>{selectedIds.size} selected</div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                  onClick={() => {
                    setEditOpen(false);
                    setChosen(null);
                    setCoinTerm("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                  onClick={onSaveEdit}
                  disabled={!chosen || selectedIds.size === 0}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk progress bar */}
        {(bulkRunning || bulkTotal > 0) && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div>
                Updating prices… {bulkDone}/{bulkTotal}
              </div>
              <div>{bulkPct}%</div>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-white/60"
                style={{ width: `${bulkPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Top KOLs filter row */}
        <div className="mt-3 flex items-center gap-3">
          {/* Multi-select KOL dropdown */}
          <div className="relative">
            <button
              className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => setKolMenuOpen((v) => !v)}
              disabled={bulkRunning}
              aria-haspopup="menu"
              aria-expanded={kolMenuOpen}
              title="Filter by KOLs (multi-select)"
            >
              <FilterIcon size={14} />
              {selectedKols.size > 0 ? (
                <span>Filter KOLs ({selectedKols.size})</span>
              ) : (
                <span>Filter KOLs (All)</span>
              )}
              <ChevronDown size={14} />
            </button>
            {kolMenuOpen && (
              <div
                className="absolute z-10 mt-1 w-64 rounded-md border border-white/10 bg-black/90 backdrop-blur p-2 shadow-xl"
                role="menu"
              >
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs text-gray-400">Top KOLs</span>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10"
                      onClick={() =>
                        setSelectedKols(new Set(topKols.map((k) => k.username)))
                      }
                    >
                      Select all
                    </button>
                    <button
                      className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 hover:bg-white/10"
                      onClick={() => setSelectedKols(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto">
                  {(topKols ?? []).map((k) => {
                    const checked = selectedKols.has(k.username);
                    return (
                      <label
                        key={k.username}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-white/5 cursor-pointer text-xs"
                        title={`@${k.username} · ${k.count} tweets`}
                      >
                        <input
                          type="checkbox"
                          className="accent-white"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedKols((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(k.username);
                              else next.delete(k.username);
                              return next;
                            });
                          }}
                        />
                        <span className="font-mono">@{k.username}</span>
                        <span className="ml-auto text-gray-400">{k.count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* NEW: Source filter dropdown (between KOLs and Only no price) */}
          <div className="relative">
            <button
              className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => setSourceMenuOpen((v) => !v)}
              disabled={bulkRunning}
              aria-haspopup="menu"
              aria-expanded={sourceMenuOpen}
              title="Filter by mention source (ca / ticker / phrase)"
            >
              <FilterIcon size={14} />
              <span>
                {sourceFilter === "all" ? "Filter Source (All)" : `Filter Source (${sourceFilter})`}
              </span>
              <ChevronDown size={14} />
            </button>
            {sourceMenuOpen && (
              <div
                className="absolute z-10 mt-1 w-48 rounded-md border border-white/10 bg-black/90 backdrop-blur p-2 shadow-xl"
                role="menu"
              >
                {/* Tip: keep options explicit to avoid typos */}
                {(["all", "ca", "ticker", "phrase"] as SourceFilter[]).map((opt) => {
                  const active = sourceFilter === opt;
                  return (
                    <button
                      key={opt}
                      className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-white/10 ${active ? "bg-white/10" : ""}`}
                      onClick={() => {
                        setSourceFilter(opt);
                        setSourceMenuOpen(false);
                      }}
                      role="menuitemradio"
                      aria-checked={active}
                    >
                      {opt === "all" ? "All sources" : opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Only no price toggle */}
          <button
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
              onlyNoPrice
                ? "border-emerald-400/50 bg-emerald-400/10"
                : "border-white/10 hover:bg-white/10"
            }`}
            onClick={() => setOnlyNoPrice((v) => !v)}
            disabled={bulkRunning}
            title="Show only tweets with NULL price"
          >
            <CheckSquare size={14} />
            Only no price
          </button>
        </div>

        {/* List */}
        <div
          className="mt-3 rounded-xl border border-white/10 bg-white/5 overflow-auto"
          style={{ maxHeight: "64vh" }}
        >
          {pageLoading && (
            <div className="p-4 text-sm text-gray-400">Loading…</div>
          )}
          {err && <div className="p-4 text-sm text-red-400">{err}</div>}
          {!pageLoading && !err && items.length === 0 && (
            <div className="p-4 text-sm text-gray-400">No tweets</div>
          )}
          {!pageLoading && !err && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-black/50 text-xs text-gray-400">
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left whitespace-nowrap">
                  {/* New: selection checkbox in header */}
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all on page"
                    />
                  </th>
                  <th>Tweet ID</th>
                  <th>User</th>
                  <th>Views</th>
                  <th>Engs</th>
                  <th>Published</th>
                  <th className="text-right pr-3">Price</th>
                  <th className="w-[210px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {visibleItems.map((it) => {
                  const st = rowStatus[it.tweetId] ?? "idle";
                  return (
                    <tr key={it.tweetId} className="hover:bg-white/5">
                      {/* New: per-row checkbox */}
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(it.tweetId)}
                          onChange={() => toggleSelectOne(it.tweetId)}
                          aria-label={`Select ${it.tweetId}`}
                        />
                      </td>
                      {/* Requirement 1: Tweet ID is clickable to open in new tab */}
                      <td className="px-3 py-2 font-mono text-xs">
                        <a
                          className="underline decoration-dotted"
                          href={`https://x.com/i/web/status/${it.tweetId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {it.tweetId}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <a
                          className="underline decoration-dotted"
                          href={`https://x.com/${it.username}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          @{it.username}
                        </a>
                      </td>
                      <td className="px-3 py-2">{fmtNum(it.views)}</td>
                      <td className="px-3 py-2">{fmtNum(it.engagements)}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">
                        {new Date(it.publish).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtPrice(it.priceUsdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {/* Keep: per-row fill (precise/broad) */}
                          <button
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
                            title={
                              scope.ca
                                ? "Fill price for this tweet (exact CA)"
                                : "Fill price by author scope"
                            }
                            onClick={() => updateOneRow(it.tweetId, it.username)}
                            disabled={bulkRunning}
                          >
                            <RefreshCcw size={14} />
                            {st === "pending" && (
                              <span className="animate-spin inline-block ml-1">
                                ⟳
                              </span>
                            )}
                            {st === "ok" && (
                              <span className="ml-1 text-emerald-400">ok</span>
                            )}
                            {st === "err" && (
                              <span className="ml-1 text-red-400">err</span>
                            )}
                          </button>
                          {/* New: per-row delete */}
                          <button
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-400/40 hover:bg-red-400/10 text-xs disabled:opacity-50"
                            title="Delete mentions for this tweet and mark excluded"
                            onClick={() => onDeleteTweet(it.tweetId)}
                            disabled={bulkRunning}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pager */}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
          <div>
            Page <b className="text-white">{page}</b> / {pageCount} · {total} tweets
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => fetchPage(1)}
              disabled={page <= 1 || bulkRunning}
            >
              «
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => fetchPage(Math.max(1, page - 1))}
              disabled={page <= 1 || bulkRunning}
            >
              ‹
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => fetchPage(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount || bulkRunning}
            >
              ›
            </button>
            <button
              className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
              onClick={() => fetchPage(pageCount)}
              disabled={page >= pageCount || bulkRunning}
            >
              »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
