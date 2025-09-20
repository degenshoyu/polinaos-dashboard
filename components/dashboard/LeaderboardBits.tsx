// components/dashboard/LeaderboardBits.tsx
"use client";

/**
 * Shared UI bits for leaderboard-style lists:
 * - rankEmoji: returns 🥇🥈🥉 for top3, then #4, #5...
 * - AvatarCircle: standalone avatar bubble with configurable size
 * - HandlePill: pill for @handle (no avatar inside to keep layout flexible)
 * - TickerPill: pill for a coin ticker (no avatar)
 * - fmt helpers: compact numbers / percentage
 *
 * Design notes:
 * - We keep avatar outside the pill so we can scale it (e.g. 22–28px) without
 *   altering the pill or card height. This makes the avatar feel larger while
 *   the row stays compact.
 */

import * as React from "react";
import clsx from "clsx";

/** Rank emoji for top positions; falls back to #N for non-top3. */
export function rankEmoji(idx: number) {
  if (idx === 0) return "🥇";
  if (idx === 1) return "🥈";
  if (idx === 2) return "🥉";
  return `#${idx + 1}`;
}

/** Compact formatter, e.g. 12.3K / 4.5M. */
export function fmtCompact(n?: number | null) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n ?? 0));
}

/** Percentage formatter, e.g. 12.34%. */
export function fmtPct(v?: number | null) {
  if (typeof v !== "number" || !isFinite(v)) return "0.00%";
  return `${(v * 100).toFixed(2)}%`;
}

/** Standalone avatar bubble (no fallback to image if missing). */
export function AvatarCircle({
  src,
  sizePx = 22,
  className,
  alt = "",
}: {
  src?: string | null;
  sizePx?: number;
  className?: string;
  alt?: string;
}) {
  const style = { width: sizePx, height: sizePx };
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        style={style}
        className={clsx("rounded-full border border-white/10 object-cover", className)}
      />
    );
  }
  return (
    <span
      style={style}
      className={clsx("rounded-full border border-white/10 bg-white/10", className)}
      aria-hidden
    />
  );
}

/** Pill that wraps "@handle" (no avatar inside). */
export function HandlePill({
  handle,
  href,
  title,
  className,
}: {
  handle: string;
  href?: string;
  title?: string;
  className?: string;
}) {
  const content = (
    <span
      title={title ?? `@${handle}`}
      className={clsx(
        "inline-flex items-center gap-2 shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1",
        "text-xs font-semibold text-white/90 truncate hover:border-white/20 hover:bg-white/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50",
        className
      )}
    >
      @{handle}
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0">
        {content}
      </a>
    );
  }
  return content;
}

/** Pill for a coin ticker, e.g. $PUMP. */
export function TickerPill({ text, title, className }: { text: string; title?: string; className?: string }) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/90",
        "hover:border-white/20 hover:bg-white/10",
        className
      )}
      title={title ?? text}
    >
      {text}
    </span>
  );
}

