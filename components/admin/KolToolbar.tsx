"use client";

import { RefreshCw, History } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  onRefreshVisible: () => void;
  onReloadList?: () => void;
  refreshing?: boolean;
  loading?: boolean;
  canRefresh?: boolean;
};

export default function KolToolbar({
  query,
  onQueryChange,
  pageSize,
  onPageSizeChange,
  onRefreshVisible,
  onReloadList,
  refreshing = false,
  loading = false,
  canRefresh = true,
}: Props) {
  return (
    <div className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <input
          className="px-3 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          placeholder="Search handle or name…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <select
          className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
          value={pageSize}
          onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
          aria-label="Rows per page"
        >
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRefreshVisible}
          disabled={refreshing || loading || !canRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm disabled:opacity-60"
          aria-busy={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh visible"}
        </button>
        <button
          onClick={() => onReloadList?.()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm disabled:opacity-60"
          title="Reload list from server"
        >
          <History className={`w-4 h-4 ${loading ? "animate-pulse" : ""}`} />
          Reload list
        </button>
      </div>
    </div>
  );
}
