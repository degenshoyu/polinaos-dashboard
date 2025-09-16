// app/admin/kols/coins/page.tsx

"use client";

import { useEffect, useState } from "react";
import { subDays } from "date-fns";
import CoinsToolbar from "@/components/admin/coins/CoinsToolbar";
import CoinsTable from "@/components/admin/coins/CoinsTable";
import DuplicatesPanel from "@/components/admin/coins/DuplicatesPanel";
import TweetListModal from "@/components/admin/coins/TweetListModal";
import type { Preset, SortKey, CoinRow } from "@/components/admin/coins/types";

export default function AdminKolsCoinsPage() {
  // ---- filters (ISO strings)
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState<string>(() =>
    subDays(new Date(), 7).toISOString(),
  );
  const [to, setTo] = useState<string>(() => new Date().toISOString());

  // ---- table + search + sort
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sort, setSort] = useState<SortKey>("views");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");
  const [selectedKols, setSelectedKols] = useState<string[]>([]);
  const [coinFilter, setCoinFilter] = useState<"all" | "no-price">("all");

  // ---- data state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CoinRow[]>([]);
  const [total, setTotal] = useState(0);

  // ---- duplicates panel visibility
  const [dupesOpen, setDupesOpen] = useState(false);

  // ---- inline CA edit state
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  const [pendingCa, setPendingCa] = useState<Record<number, string>>({});

  // ---- tweets modal state
  const [tweetModalOpen, setTweetModalOpen] = useState(false);
  const [tweetScope, setTweetScope] = useState<{
    ticker?: string | null;
    ca?: string | null;
  }>({});

  // Preset apply
  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "7d") {
      setFrom(subDays(new Date(), 7).toISOString());
      setTo(new Date().toISOString());
    } else if (p === "30d") {
      setFrom(subDays(new Date(), 30).toISOString());
      setTo(new Date().toISOString());
    } else if (p === "all") {
      setFrom("1970-01-01T00:00:00.000Z");
      setTo(new Date().toISOString());
    } else if (p === "custom") {

    }
    setPage(1);
  };

  // Fetch table data
  const fetchData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("from", from);
      sp.set("to", to);
      sp.set("page", String(page));
      sp.set("pageSize", String(size));
      sp.set("sort", sort);
      sp.set("order", asc ? "asc" : "desc");
      if (q.trim()) sp.set("q", q.trim());
      if (selectedKols.length) sp.set("kols", selectedKols.join(","));
      sp.set("coins", coinFilter);

      const r = await fetch(`/api/kols/coins/admin?${sp.toString()}`, {
        cache: "no-store",
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await r.text();
        throw new Error(`Unexpected response (${r.status}). ${text.slice(0, 180)}`);
      }
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setRows((data.items ?? []) as CoinRow[]);
      setTotal(Number(data.total ?? 0));
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  };

  // trigger search from duplicates panel
  const searchByTicker = (ticker: string) => {
    setQ(ticker);
    setPage(1);
    fetchData();
  };

  // open tweets modal (table & duplicates)
  const openTweets = (scope: { ticker?: string | null; ca?: string | null }) => {
    setTweetScope(scope);
    setTweetModalOpen(true);
  };

  // Initial + reactive fetch
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to, page, size, sort, asc, selectedKols, coinFilter]);

  // Inline CA edit handlers
  const startEdit = (idx: number, current?: string | null) => {
    setEditing((m) => ({ ...m, [idx]: true }));
    setPendingCa((m) => ({ ...m, [idx]: current ?? "" }));
  };
  const cancelEdit = (idx: number, current?: string | null) => {
    setEditing((m) => ({ ...m, [idx]: false }));
    setPendingCa((m) => ({ ...m, [idx]: current ?? "" }));
  };
  const onPendingChange = (idx: number, v: string) => {
    setPendingCa((m) => ({ ...m, [idx]: v }));
  };
  const saveCa = async (idx: number) => {
    const toCa = (pendingCa[idx] ?? "").trim();
    if (!toCa) return;
    const fromCa = rows[idx]?.ca ?? null;
    const scopeTicker = rows[idx]?.ticker ?? undefined;
    try {
      const r = await fetch("/api/kols/coins/update-ca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromCa, toCa, scopeTicker }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "update failed");
      setEditing((m) => ({ ...m, [idx]: false }));
      await fetchData();
      // DuplicatesPanel has its own refresh button;不在这里强刷它
    } catch (e: any) {
      alert(e?.message ?? "update failed");
    }
  };

  // Sorting toggle for header buttons
  const toggleSort = (key: SortKey) => {
    if (sort === key) setAsc((v) => !v);
    else {
      setSort(key);
      setAsc(false);
    }
    setPage(1);
  };

  // Pagination math
  const pageCount = Math.max(1, Math.ceil((total || 0) / size));
  const safePage = Math.min(page, pageCount);

  // Delete a CA (and related mentions) then refresh — receives the mode from the dialog
  const deleteRow = async (ca: string, excludeTweets: boolean) => {
    if (!ca) return;
    try {
      const r = await fetch("/api/kols/coins/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ca, excludeTweets }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      // Optional: keep a lightweight success hint; admin简洁为主
      // console.info("Delete done", data);
      await fetchData();
    } catch (e: any) {
      alert(e?.message ?? "delete failed");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">
        KOL Leaderboard - Mentioned Coins Manager
        {selectedKols.length > 0 && (
          <span className="ml-2 align-middle px-2 py-0.5 text-xs rounded-full border border-emerald-400/50 bg-emerald-400/10 text-emerald-200">
            Filtered by KOLs ({selectedKols.length})
          </span>
        )}
      </h1>

      <CoinsToolbar
        preset={preset}
        fromISO={from}
        toISO={to}
        onPresetChange={applyPreset}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={fetchData}
        loading={loading}
        q={q}
        onQChange={setQ}
        onSearch={() => {
          setPage(1);
          fetchData();
        }}
        sort={sort}
        asc={asc}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        onToggleOrder={() => {
          setAsc((v) => !v);
          setPage(1);
        }}
        pageSize={size}
        onSizeChange={(n) => {
          setSize(n);
          setPage(1);
        }}
        dupesOpen={dupesOpen}
        onToggleDupes={() => setDupesOpen((v) => !v)}
        selectedKols={selectedKols}
        onSelectedKolsChange={(list) => {
          setSelectedKols(list);
          setPage(1);
        }}
        // coins filter props
        coinFilter={coinFilter}
        onCoinFilterChange={(v) => {
          setCoinFilter(v);
          setPage(1);
        }}
      />

      {dupesOpen && (
        <DuplicatesPanel
          fromISO={from}
          toISO={to}
          onSearchTicker={searchByTicker}
          onShowTweets={openTweets}
        />
      )}

      <CoinsTable
        rows={rows}
        loading={loading}
        sort={sort}
        asc={asc}
        onHeaderSort={toggleSort}
        editing={editing}
        pendingCa={pendingCa}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onPendingChange={onPendingChange}
        onSaveCa={saveCa}
        onShowTweets={openTweets}
        onDeleteRow={(idx, ca, exclude) => deleteRow(ca, exclude)}
      />

      {/* Pagination */}
      <div className="p-3 flex items-center justify-between text-xs text-gray-400">
        <div>
          Page <b className="text-white">{safePage}</b> / {pageCount} ·{" "}
          <span className="text-gray-300">{total}</span> items
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(1)}
            disabled={safePage <= 1}
            aria-label="First page"
          >
            «
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(Math.min(pageCount, safePage + 1))}
            disabled={safePage >= pageCount}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(pageCount)}
            disabled={safePage >= pageCount}
            aria-label="Last page"
          >
            »
          </button>
        </div>
      </div>

      {/* Tweet list modal */}
      <TweetListModal
        open={tweetModalOpen}
        onClose={() => setTweetModalOpen(false)}
        fromISO={from}
        toISO={to}
        scope={tweetScope}
      />
    </div>
  );
}
