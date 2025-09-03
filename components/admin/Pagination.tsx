"use client";

type Props = {
  page: number;
  pageCount: number;
  totalCount: number;
  onPageChange: (p: number) => void;
};

export default function Pagination({ page, pageCount, totalCount, onPageChange }: Props) {
  const safePage = Math.min(Math.max(1, page), Math.max(1, pageCount));
  return (
    <div className="p-3 flex items-center justify-between text-xs text-gray-400">
      <div>
        Page <b className="text-white">{safePage}</b> / {Math.max(1, pageCount)} ·{" "}
        <span className="text-gray-300">{totalCount}</span> items
      </div>
      <div className="flex items-center gap-2">
        <button
          className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
          onClick={() => onPageChange(1)}
          disabled={safePage <= 1}
          aria-label="First page"
        >
          «
        </button>
        <button
          className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <button
          className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
          aria-label="Next page"
        >
          ›
        </button>
        <button
          className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
          onClick={() => onPageChange(pageCount)}
          disabled={safePage >= pageCount}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}
