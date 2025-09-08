"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { Dropdown, MenuItem } from "./primitives";

/**
 * Pagination bar for internal/ client-side pagination.
 * - Keyboard accessible
 * - Condensed page numbers: 1 … 4 5 [6] 7 8 … 20
 * - Page size dropdown (10/20/50)
 */
export type PageSize = 10 | 20 | 50;

export const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 50];

export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className = "",
}: {
  total: number;
  page: number;                 // 1-based
  pageSize: PageSize;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: PageSize) => void;
  className?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);

  const { items, from, to } = useMemo(() => {
    // build condensed page array
    const pages: number[] = [];
    const push = (n: number) => { if (n >= 1 && n <= pageCount) pages.push(n); };

    // always show first/last
    push(1);
    push(2);
    // window around current
    for (let i = clampedPage - 2; i <= clampedPage + 2; i++) push(i);
    push(pageCount - 1);
    push(pageCount);

    // unique + sorted
    const uniq = Array.from(new Set(pages)).filter(p => p >= 1 && p <= pageCount).sort((a,b)=>a-b);

    // insert ellipsis markers (-1) when gaps exist
    const items: (number | "ellipsis")[] = [];
    for (let i = 0; i < uniq.length; i++) {
      if (i > 0 && uniq[i] !== uniq[i - 1] + 1) items.push("ellipsis");
      items.push(uniq[i]);
    }

    const from = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
    const to = Math.min(clampedPage * pageSize, total);
    return { items, from, to };
  }, [clampedPage, pageSize, pageCount, total]);

  const goto = (p: number) => onPageChange(Math.min(Math.max(1, p), pageCount));

  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2",
        className,
      ].join(" ")}
      role="navigation"
      aria-label="Pagination"
    >
      {/* Left: range + total */}
      <div className="text-xs text-gray-300">
        {total === 0 ? "No results" : `${from}–${to} of ${total}`}
      </div>

      {/* Middle: pager */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => goto(clampedPage - 1)}
          disabled={clampedPage <= 1}
          className="inline-flex items-center rounded-md border border-white/10 bg-white/5 p-1.5 text-gray-200 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex items-center gap-1">
          {items.map((it, idx) =>
            it === "ellipsis" ? (
              <span
                key={`e-${idx}`}
                className="inline-flex items-center rounded-md border border-white/10 bg-white/0 px-2 py-1 text-xs text-gray-400"
                aria-hidden
              >
                <MoreHorizontal size={14} />
              </span>
            ) : (
              <button
                key={it}
                onClick={() => goto(it)}
                aria-current={it === clampedPage ? "page" : undefined}
                className={[
                  "inline-flex items-center rounded-md border px-2 py-1 text-xs tabular-nums",
                  it === clampedPage
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-gray-200 hover:bg-white/10",
                ].join(" ")}
              >
                {it}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => goto(clampedPage + 1)}
          disabled={clampedPage >= pageCount}
          className="inline-flex items-center rounded-md border border-white/10 bg-white/5 p-1.5 text-gray-200 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Right: page size */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Rows</span>
        <Dropdown label={String(pageSize)}>
          {PAGE_SIZE_OPTIONS.map((s) => (
            <MenuItem key={s} active={s === pageSize} onClick={() => onPageSizeChange(s)}>
              {s}
            </MenuItem>
          ))}
        </Dropdown>
      </div>
    </div>
  );
}

