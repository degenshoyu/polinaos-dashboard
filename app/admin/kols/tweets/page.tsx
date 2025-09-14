// app/admin/kols/tweets/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { subDays } from "date-fns";
import TweetsToolbar, {
  Preset,
  SourceFilter,
} from "@/components/admin/tweets/TweetsToolbar";
import TweetsTable, {
  SortKey,
  TweetRow,
} from "@/components/admin/tweets/TweetsTable";
import EditCoinPanel from "@/components/admin/tweets/EditCoinPanel";

/** Map UI sort key to API column name. Keep in sync with backend. */
function mapSortKeyToApi(k: SortKey) {
  switch (k) {
    case "username":
      return "username";
    case "tweet_id":
      return "tweet_id";
    case "views":
      return "views";
    case "likes":
      return "likes";
    case "retweets":
      return "retweets";
    case "replies":
      return "replies";
    case "engs":
      return "engagements";
    case "publish":
      return "publish_date_time";
    case "last_seen":
      return "last_seen_at";
    case "coins":
      return "coins";
  }
}

export default function AdminKolsTweetsPage() {
  // ---------- toolbar state ----------
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState<string>(() =>
    subDays(new Date(), 7).toISOString(),
  );
  const [to, setTo] = useState<string>(() => new Date().toISOString());
  const [query, setQuery] = useState(""); // @username
  const [size, setSize] = useState(50);

  // NEW: source filter: all | coins | ca | ticker | phrase
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // ---------- table / backend controls ----------
  const [sortKey, setSortKey] = useState<SortKey>("publish");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  // ---------- data ----------
  const [rows, setRows] = useState<TweetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ---------- selection + edit ----------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);

  const pageCount = Math.max(1, Math.ceil((total || 0) / size));
  const safePage = Math.min(page, pageCount);

  /** Fetch tweets from `/api/kols/tweets/admin` with server-side filtering.
   *  Also keep a client-side fallback filter so UI works even if backend ignores `source` param. */
  const fetchData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      // date range
      if (preset === "all") {
        sp.set("from", "1970-01-01T00:00:00.000Z");
        sp.set("to", new Date().toISOString());
      } else {
        sp.set("from", from);
        sp.set("to", to);
      }
      // paging & sort
      sp.set("page", String(page));
      sp.set("pageSize", String(size));
      sp.set("sort", mapSortKeyToApi(sortKey));
      sp.set("order", sortAsc ? "asc" : "desc");
      // username
      const handle = query.trim().replace(/^@/, "");
      if (handle) sp.set("handle", handle);
      // NEW: source filter -> backend param
      // - "all"    => do not set `source`
      // - "coins"  => source=any   (any coin mention)
      // - "ca|ticker|phrase" => pass as-is
      if (sourceFilter === "coins") {
        sp.set("source", "any");
      } else if (sourceFilter !== "all") {
        sp.set("source", sourceFilter);
      }

      const r = await fetch(`/api/kols/tweets/admin?${sp.toString()}`, {
        cache: "no-store",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "failed to load tweets");

      const incoming = (data.items ?? []) as TweetRow[];
      const backendTotal = Number(data.total ?? 0);

      // Client-side fallback filtering (in case backend doesn't support `source` yet).
      // This guarantees the visible rows match the UI selection.
      const filtered =
        sourceFilter === "all"
          ? incoming
          : sourceFilter === "coins"
          ? incoming.filter((t) => (t.coins ?? []).length > 0)
          : incoming.filter((t) =>
              (t.coins ?? []).some(
                (c) => (c.source ?? "").toLowerCase() === sourceFilter,
              ),
            );

      setRows(filtered);
      setTotal(backendTotal); // NOTE: if backend ignores `source`, total may be wider than `rows.length`.
      setSelectedIds(new Set());
      setEditOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  };

  // Initial load & whenever any dependency changes.
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to, page, size, sortKey, sortAsc, query, sourceFilter]);

  // ---------- selection helpers ----------
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (idsOnPage: string[], allSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) idsOnPage.forEach((id) => next.delete(id));
      else idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  // ---------- sort handler ----------
  const onSortChange = (k: SortKey) => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
    setPage(1);
  };

  // ---------- delete one tweet ----------
  const onDeleteTweet = async (tweetId: string) => {
    const ok = window.confirm(
      "Remove mentions for this tweet and mark excluded?",
    );
    if (!ok) return;
    try {
      const r = await fetch("/api/kols/mentions/delete-and-exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweetId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      await fetchData();
    } catch (e: any) {
      alert(e?.message ?? "delete failed");
    }
  };

  // ---------- preset helper ----------
  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "7d") {
      setFrom(subDays(new Date(), 7).toISOString());
      setTo(new Date().toISOString());
    } else if (p === "30d") {
      setFrom(subDays(new Date(), 30).toISOString());
      setTo(new Date().toISOString());
    }
    setPage(1);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">KOL Tweets</h1>

      {/* Toolbar */}
      <TweetsToolbar
        preset={preset}
        from={from}
        to={to}
        onPresetChange={applyPreset}
        onFromChange={(iso) => {
          setFrom(iso);
          setPage(1);
        }}
        onToChange={(iso) => {
          setTo(iso);
          setPage(1);
        }}
        query={query}
        onQueryChange={(v) => {
          setQuery(v);
          setPage(1);
        }}
        size={size}
        onSizeChange={(n) => {
          setSize(n);
          setPage(1);
        }}
        loading={loading}
        onApply={fetchData}
        sourceFilter={sourceFilter}
        onSourceFilterChange={(v) => {
          setSourceFilter(v);
          setPage(1);
        }}
        selectedCount={selectedIds.size}
        onToggleEdit={() => setEditOpen((v) => !v)}
        canEdit={selectedIds.size > 0}
      />

      {/* Edit coin panel */}
      <EditCoinPanel
        open={editOpen}
        selectedCount={selectedIds.size}
        selectedTweetIds={Array.from(selectedIds)}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          await fetchData();
          setEditOpen(false);
        }}
      />

      {/* Table */}
      <TweetsTable
        rows={rows}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSortChange={onSortChange}
        selectedIds={selectedIds}
        onToggleOne={toggleOne}
        onToggleAll={toggleAll}
        onDeleteTweet={onDeleteTweet}
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

      {err && <div className="text-sm text-red-400">{err}</div>}
    </div>
  );
}

