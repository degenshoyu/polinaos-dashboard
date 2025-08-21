// components/token/TokenResultCard.tsx
"use client";

import * as React from "react";

export type TokenResultCardProps = {
  // Core token/pool fields (mapped from SuggestItem of useGeckoSearch)
  networkId: string;               // e.g. "solana", "eth", "base"
  symbol: string;
  name?: string;
  imageUrl?: string;
  tokenAddress: string;
  dex?: string;
  priceUsd?: number;
  change1h?: number;
  change24h?: number;
  reserveUsd?: number;
  volume24hUsd?: number;
  createdAt?: string;              // ISO 8601

  // UI state
  active?: boolean;                // highlighted (keyboard focus/hover)
  onClick?: () => void;            // select handler
  onMouseEnter?: () => void;       // for hover-highlight
};

/**
 * Dexscreener-like result card used inside the autocomplete dropdown.
 * Accessible semantics:
 * - The parent should use role="listbox" and each card should use role="option".
 * - Use `aria-selected` + `active` prop for keyboard navigation styling.
 */
export default function TokenResultCard({
  networkId,
  symbol,
  name,
  imageUrl,
  tokenAddress,
  dex,
  priceUsd,
  change1h,
  change24h,
  reserveUsd,
  volume24hUsd,
  createdAt,
  active = false,
  onClick,
  onMouseEnter,
}: TokenResultCardProps) {
  const age = React.useMemo(() => {
    if (!createdAt) return "-";
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return "-";
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    if (days < 1) return "new";
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    const rest = days % 30;
    return `${months}mo${rest ? ` ${rest}d` : ""}`;
  }, [createdAt]);

  const chip = (label: string, value?: React.ReactNode) => (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.06] text-[11px] text-gray-300">
      <span className="text-gray-400">{label}:</span>
      <span className="text-gray-200">{value ?? "-"}</span>
    </span>
  );

  const pct = (n?: number) =>
    typeof n === "number" ? `${n.toFixed(2)}%` : "-";

  const moneyShort = (n?: number) => {
    if (typeof n !== "number" || !isFinite(n)) return "-";
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const shortAddr = (addr?: string) =>
    !addr ? "-" : addr.length <= 14 ? addr : `${addr.slice(0, 8)}…${addr.slice(-6)}`;

  const trendClass = (n?: number) =>
    typeof n === "number"
      ? n >= 0
        ? "text-emerald-300"
        : "text-red-300"
      : "text-gray-400";

  // Simple pill for network id (can be swapped for icons later)
  const chainPill = (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-white/10 bg-white/10 text-[10px] uppercase tracking-wide">
      {networkId}
    </span>
  );

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full text-left px-3 py-2 border-b border-white/5 last:border-0 transition rounded-lg ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      {/* Top row: avatar + symbol/name + price & pct */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-7 w-7 rounded-full overflow-hidden bg-white/10 shrink-0">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={symbol}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-300">
                {symbol?.slice(0, 2) || "?"}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-white/90 truncate">
              <span className="font-semibold">{symbol || "-"}</span>
              {chainPill}
            </div>
            <div className="text-xs text-gray-400 truncate">{name || "-"}</div>
          </div>
        </div>

        <div className="text-right text-xs text-gray-300 shrink-0">
          <div>{typeof priceUsd === "number" ? `$${priceUsd.toFixed(6)}` : "-"}</div>
          <div className="flex items-center gap-2 justify-end">
            <span className={`${trendClass(change1h)}`}>1H {pct(change1h)}</span>
            <span className={`${trendClass(change24h)}`}>24H {pct(change24h)}</span>
          </div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chip("Liq", moneyShort(reserveUsd))}
        {chip("24H Vol", moneyShort(volume24hUsd))}
        {chip("Age", age)}
        {chip("DEX", dex || "-")}
      </div>

      {/* Footer: addresses */}
      <div className="mt-1 text-[11px] text-gray-500 truncate">
        TOKEN: {shortAddr(tokenAddress)}
      </div>
    </button>
  );
}
