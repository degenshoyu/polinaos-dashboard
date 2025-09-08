// components/ui/Pagination.tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  page: number;          // 1-based
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  className?: string;
  maxButtons?: number;   // 默认 5
};

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className = "",
  maxButtons = 5,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), totalPages);

  // 计算页码窗口
  const half = Math.floor(maxButtons / 2);
  let start = Math.max(1, cur - half);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);

  const pages = [];
  for (let i = start; i <= end; i++) pages.push(i);

  const btn = (label: React.ReactNode, p: number, active?: boolean, disabled?: boolean) => (
    <button
      key={`${label}-${p}`}
      onClick={() => !disabled && onPageChange(p)}
      disabled={disabled}
      className={[
        "min-w-8 h-8 px-2 rounded-md text-sm",
        active
          ? "bg-emerald-400/20 text-emerald-200 border border-emerald-400/30"
          : "text-gray-200 border border-white/10 hover:bg-white/10",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {btn(<ChevronLeft size={16} />, cur - 1, false, cur === 1)}
      {start > 1 && (
        <>
          {btn(1, 1, cur === 1)}
          {start > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}
      {pages.map((p) => btn(p, p, p === cur))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          {btn(totalPages, totalPages, cur === totalPages)}
        </>
      )}
      {btn(<ChevronRight size={16} />, cur + 1, false, cur === totalPages)}
      <div className="ml-2 text-xs text-gray-400">
        {Math.min((cur - 1) * pageSize + 1, total)}–{Math.min(cur * pageSize, total)} / {total}
      </div>
    </div>
  );
}

