"use client";

export type SortDir = "asc" | "desc";

export default function SortableHeader({
  label,
  active = false,
  dir = "desc",
  sortable = true,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  active?: boolean;
  dir?: SortDir;
  sortable?: boolean;
  onSort?: (nextDir: SortDir) => void;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const next = dir === "asc" ? "desc" : "asc";
  const canClick = sortable && !!onSort;

  return (
    <button
      type="button"
      disabled={!canClick}
      onClick={() => canClick && onSort?.(next)}
      className={[
        "inline-flex items-center gap-1 select-none",
        align === "right" ? "justify-end" : align === "center" ? "justify-center w-full" : "",
        !canClick ? "cursor-default opacity-80" : "hover:text-white",
        className,
      ].join(" ")}
      role="button"
      aria-pressed={active || undefined}
      title={sortable ? (active ? `Sort ${next}` : "Click to sort") : undefined}
    >
      <span>{label}</span>
      {sortable ? (
        <span
          className={[
            "text-[10px] leading-none opacity-80",
            active ? "opacity-100" : "opacity-60",
          ].join(" ")}
          aria-hidden
        >
          {active ? (dir === "asc" ? "▲" : "▼") : "↕︎"}
        </span>
      ) : null}
    </button>
  );
}
