"use client";

import { useMemo, useState } from "react";
import type { KolRow as Row } from "@/components/types";
import { mergeDisplayCoins, totalsFromRow, normalized } from "@/lib/kols";
import { useKolAggregations } from "@/hooks/useKolAggregations";
import { useScanTimeline } from "@/hooks/useScanTimeline";

import KolToolbar from "./KolToolbar";
import Pagination from "./Pagination";
import CoinsChipList from "./CoinsChipList";
import KolRow from "./KolRow";
import SortableHeader, { type SortDir } from "./SortableHeader";

/** Sort keys supported by this table */
type SortKey =
  | "handle"
  | "followers"
  | "tweets7d"
  | "views7d"
  | "engs7d"
  | "er7d"
  | "shills7d"
  | "coinsCount";

/** Column config for the table header */
type Column = {
  id: "kol" | "totals" | "shills" | "coins" | "actions";
  label: string;
  widthClass?: string;
  /** Make column sortable by providing a SortKey */
  sortKey?: SortKey;
  align?: "left" | "center" | "right";
};

export type KolTableProps = {
  rows: Row[];
  loading?: boolean;
  onRefresh?: () => void;
  onUpdateOne?: (handle: string) => void;
  updatingMap?: Record<string, boolean>;
  /** Optional default sorting (keeps backward-compat without changing defaults) */
  defaultSortKey?: SortKey | null;
  defaultSortDir?: SortDir;
};

export default function KolTable({
  rows,
  loading = false,
  onRefresh,
  onUpdateOne,
  updatingMap = {},
  defaultSortKey = null,
  defaultSortDir = "desc",
}: KolTableProps) {
  /* ---------- local UI state ---------- */
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Sorting state (opt-in via props)
  const [sortKey, setSortKey] = useState<SortKey | null>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  /* ---------- hooks: aggregations + scan ---------- */
  const {
    refreshing,
    refreshVisible,
    getTotals,
    getShillAgg,
    setTotalsOverride,
    setShillOverride,
  } = useKolAggregations();

  const { scanning, scanMsg, scan } = useScanTimeline({
    onTotals: setTotalsOverride,
    onShills: setShillOverride,
    onAfterScan: async () => {
      await onRefresh?.();
    },
  });

  /* ---------- filter first ---------- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const u = (r.twitterUsername || "").toLowerCase();
      const d = (r.displayName || "").toLowerCase();
      return u.includes(q) || d.includes(q);
    });
  }, [rows, query]);

  /* ---------- columns config ---------- */
  const columns: Column[] = useMemo(
    () => [
      { id: "kol", label: "KOL", sortKey: "handle" },
      { id: "totals", label: "Totals (7d)", widthClass: "w-[20%]", sortKey: "views7d" },
      { id: "shills", label: "Shills (7d)", widthClass: "w-[20%]", sortKey: "shills7d" },
      { id: "coins", label: "Coins", widthClass: "w-[28%]", sortKey: "coinsCount" },
      { id: "actions", label: "Actions", widthClass: "w-[22%]" },
    ],
    []
  );

  /* ---------- derive enriched rows (for sorting/pagination) ---------- */
  type Enriched = {
    row: Row;
    totals: ReturnType<typeof totalsFromRow>;
    sh: ReturnType<typeof getShillAgg>;
    coins: ReturnType<typeof mergeDisplayCoins>;
    er7d: number;
    coinsCount: number;
  };

  const enriched: Enriched[] = useMemo(() => {
    return filtered.map((r) => {
      const totals = getTotals(r) ?? totalsFromRow(r);
      const sh = getShillAgg(r.twitterUsername, r);
      const coins = mergeDisplayCoins(
        sh?.coins ?? (r.coinsShilled || []).map((c) => ({ tokenDisplay: c, count: 1 }))
      );
      const er7d = totals.totalViews > 0 ? totals.totalEngs / totals.totalViews : 0;
      return { row: r, totals, sh, coins, er7d, coinsCount: coins.length };
    });
    // Note: getTotals/getShillAgg values update via overrides; we keep this list dependent on filtered only
    // and rely on re-render triggered by state updates above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  /* ---------- sort then paginate ---------- */
  const sorted: Enriched[] = useMemo(() => {
    if (!sortKey) return enriched;
    const dirMul = sortDir === "asc" ? 1 : -1;

    const value = (e: Enriched): number | string => {
      switch (sortKey) {
        case "handle":     return (e.row.twitterUsername || "").toLowerCase();
        case "followers":  return e.row.followers ?? 0;
        case "tweets7d":   return e.totals.totalTweets;
        case "views7d":    return e.totals.totalViews;
        case "engs7d":     return e.totals.totalEngs;
        case "er7d":       return e.er7d;
        case "shills7d":   return e.sh?.totalShills || 0;
        case "coinsCount": return e.coinsCount;
      }
    };

    return [...enriched].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dirMul;
      }
      return ((va as number) - (vb as number)) * dirMul;
    });
  }, [enriched, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  /* ---------- handlers ---------- */
  const handleRefreshVisible = async () => {
    await refreshVisible(visible.map((e) => e.row.twitterUsername));
    await onRefresh?.();
  };

  const toggleSort = (k?: SortKey) => {
    if (!k) return;
    if (sortKey !== k) {
      setSortKey(k);
      setSortDir("desc"); // default new column sort to desc
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
    setPage(1); // jump back to first page when sorting changes
  };

  /* ---------- render ---------- */
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
      <KolToolbar
        query={query}
        onQueryChange={(v) => {
          setQuery(v);
          setPage(1);
        }}
        pageSize={pageSize}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        onRefreshVisible={handleRefreshVisible}
        onReloadList={onRefresh}
        refreshing={refreshing}
        loading={loading}
        canRefresh={visible.length > 0}
      />

      <div className="overflow-x-auto border-t border-white/10">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              {columns.map((c) => (
                <th
                  key={c.id}
                  className={c.widthClass}
                  aria-sort={
                    c.sortKey
                      ? sortKey === c.sortKey
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                >
                  <SortableHeader
                    label={c.label}
                    sortable={!!c.sortKey}
                    active={!!c.sortKey && sortKey === c.sortKey}
                    dir={sortDir}
                    onSort={() => toggleSort(c.sortKey)}
                    align={c.id === "actions" ? "right" : "left"}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {visible.map((e) => (
              <KolRow
                key={e.row.twitterUsername}
                row={e.row}
                totals={e.totals}
                shills={e.sh}
                coinsEl={<CoinsChipList coins={e.coins} max={6} />}
                updating={!!updatingMap[normalized(e.row.twitterUsername)]}
                scanning={!!scanning[normalized(e.row.twitterUsername)]}
                scanMsg={scanMsg[normalized(e.row.twitterUsername)]}
                onScan={(h) => scan(h)}
                onUpdate={onUpdateOne}
              />
            ))}

            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-gray-500">
                  {loading ? "Loading…" : query ? "No results" : "No data"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={safePage}
        pageCount={pageCount}
        totalCount={sorted.length}
        onPageChange={setPage}
      />
    </div>
  );
}
