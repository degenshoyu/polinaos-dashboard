// components/dashboard/TopTokensByMentions.tsx
"use client";

/**
 * Card: Top Coins (list-only, unified style)
 * - Header icon: Coins (theme-appropriate).
 * - Each row: rank medal + TickerPill($TICKER) + [copy CA] + right "score xx.xx".
 * - Click row toggles a non-blocking popover with metrics + coin's top KOLs (by views).
 * - Show up to 10 rows.
 * - Inside the popover, KOL rows use the same layout as TopKolsCard:
 *   Avatar(left, larger) + Rank + HandlePill + followers + right views.
 */

import * as React from "react";
import { Copy, CircleHelp, Coins } from "lucide-react";
import clsx from "clsx";
import { TickerPill, rankEmoji, fmtCompact, fmtPct, HandlePill, AvatarCircle } from "./LeaderboardBits";

export type TopCoinRow = {
  tokenKey: string;
  tokenDisplay: string;
  contractAddress?: string | null;

  mentions: number;
  shillers: number;
  views: number;
  engs: number;
  er: number;       // 0..1
  velocity: number; // ratio
  score: number;    // 0..1

  // Optional: top KOLs by this coin's views (sorted desc by views)
  topKols?: Array<{
    handle: string;
    views: number;
    followers?: number | null;
    avatarUrl?: string | null;
  }>;
};

type Props = {
  rows: TopCoinRow[];
  days: 7 | 30;
  title?: string;
};

export default function TopTokensByMentions({ rows, days, title = "Top Coins" }: Props) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  // Click outside closes (non-blocking)
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // ESC closes
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset when window/data changes
  React.useEffect(() => setOpenId(null), [days, rows?.length]);

  const toggleRow = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const onCopy = async (id: string, ca?: string | null) => {
    if (!ca) return;
    try {
      await navigator.clipboard.writeText(ca);
      setCopiedId(id);
      setTimeout(() => setCopiedId((k) => (k === id ? null : k)), 900);
    } catch {
      // ignore
    }
  };

  const top10 = (rows ?? []).slice(0, 10);

  return (
    <div
      ref={rootRef}
      className="group/card relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
    >
      {/* Card glow */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
        style={{ background: "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)" }}
        aria-hidden
      />

      {/* Header (Coins icon + a single help icon) */}
      <div className="relative mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-[18px] w-[18px] text-emerald-300" />
          <div className="font-medium">
            {title} <span className="opacity-70">({days}d)</span>
          </div>
        </div>

        {/* Tooltip: how to read the score */}
        <div className="relative group/help">
          <CircleHelp className="h-4 w-4 text-gray-300/90 hover:text-white cursor-help" aria-label="Score formula" role="img" />
          <div
            className={clsx(
              "pointer-events-none absolute right-0 top-[140%] z-40 w-[320px]",
              "rounded-xl border border-white/12 backdrop-blur-xl px-3.5 py-3 text-[11px] leading-snug",
              "bg-[linear-gradient(135deg,rgba(20,34,32,0.94),rgba(12,19,18,0.94))]",
              "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]",
              "opacity-0 translate-y-1 transition-all duration-200 group-hover/help:opacity-100 group-hover/help:translate-y-0"
            )}
            aria-hidden
          >
            <div className="font-medium mb-1 text-white/90">How is score computed?</div>
            <ul className="list-disc pl-4 space-y-0.5 text-white/80">
              <li>mentions / shillers / views / engs — min-max normalized</li>
              <li>velocity = last 24h mentions / previous daily avg</li>
              <li>retweets excluded; tweets & quotes only</li>
            </ul>
          </div>
        </div>
      </div>

      {/* List */}
      {top10.length === 0 ? (
        <div className="text-sm text-gray-400">No coins found in this range.</div>
      ) : (
        <ul className="relative space-y-2 text-sm">
          {top10.map((r, idx) => {
            const rowId = `${r.tokenKey}-${r.contractAddress ?? "noca"}`;
            const pinned = openId === rowId;
            const copied = copiedId === rowId;
            const hasCA = !!r.contractAddress;

            // prevent double dollar signs; allow raw key when display missing
            const cleanTicker = (r.tokenDisplay || r.tokenKey || "").replace(/^\$+/, "").toUpperCase();
            const chipText = `$${cleanTicker}`;

            return (
              <li key={rowId} className="relative">
                {/* Row card */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={pinned}
                  onClick={() => toggleRow(rowId)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleRow(rowId)}
                  className={clsx(
                    "group/row flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30",
                    "transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5",
                    "hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                  )}
                >
                  {/* Left: rank + $TICKER + copy */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-8 text-center">{rankEmoji(idx)}</span>

                    <TickerPill text={chipText} title={`$${cleanTicker}`} />

                    {hasCA ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation(); // keep popover state unchanged when copying
                          onCopy(rowId, r.contractAddress);
                        }}
                        className={clsx(
                          "relative inline-flex h-6 w-6 items-center justify-center rounded-md",
                          "border border-white/10 bg-white/5 hover:bg-white/10",
                          "transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                        )}
                        aria-label="Copy contract address"
                        title="Copy contract address"
                      >
                        <Copy className="h-3 w-3 opacity-75" />
                        {/* tiny badge */}
                        <span
                          className={clsx(
                            "pointer-events-none absolute -top-2 -right-1 select-none rounded-full px-1.5 py-0.5",
                            "text-[10px] font-medium",
                            "bg-emerald-500/95 text-black border border-emerald-300/80 shadow",
                            "transition-all",
                            copied ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
                          )}
                          aria-hidden
                        >
                          Copied!
                        </span>
                      </button>
                    ) : null}
                  </div>

                  {/* Right: score only */}
                  <div className="tabular-nums text-xs md:text-sm font-semibold text-white/90">
                    score {r.score.toFixed(2)}
                  </div>
                </div>

                {/* Per-row popover (non-blocking) */}
                <div
                  data-open={pinned ? "true" : "false"}
                  className={clsx(
                    "absolute left-0 right-0 top-[calc(100%+6px)] z-30",
                    "invisible opacity-0 translate-y-1",
                    "group-hover/row:visible group-hover/row:opacity-100 group-hover/row:translate-y-0",
                    "data-[open=true]:visible data-[open=true]:opacity-100 data-[open=true]:translate-y-0",
                    "transition-all duration-200"
                  )}
                >
                  <div
                    className={clsx(
                      "relative overflow-hidden rounded-2xl border border-white/12 backdrop-blur-xl px-4 py-3",
                      "bg-[linear-gradient(135deg,rgba(20,34,32,0.96),rgba(12,19,18,0.96))]",
                      "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                    )}
                  >
                    {/* inner glow */}
                    <div
                      className="pointer-events-none absolute -inset-px rounded-2xl opacity-80"
                      style={{
                        background:
                          "radial-gradient(120% 80% at 0% 0%, rgba(47,212,128,0.18) 0%, rgba(62,242,172,0.10) 35%, transparent 70%)",
                      }}
                      aria-hidden
                    />

                    {/* header */}
                    <div className="relative mb-2 flex items-center justify-between">
                      <span className="rounded-md bg-emerald-400/15 border border-emerald-400/20 text-emerald-200 text-xs px-2 py-1">
                        {chipText}
                      </span>
                      <span className="text-[11px] text-white/70">Last {days}d</span>
                    </div>

                    {/* metrics */}
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="Mentions" value={fmtCompact(r.mentions)} />
                      <Metric label="Shillers" value={fmtCompact(r.shillers)} />
                      <Metric label="Views" value={fmtCompact(r.views)} />
                      <Metric label="Engs" value={fmtCompact(r.engs)} />
                      <Metric label="ER" value={fmtPct(r.er)} />
                      <Metric label="Velocity" value={r.velocity?.toFixed(2)} />
                    </div>

                    {/* top kols by this coin (if provided) */}
                    {Array.isArray(r.topKols) && r.topKols.length > 0 ? (
                      <div className="relative mt-3">
                        <div className="text-[11px] text-gray-400 mb-1">Top KOLs by this coin’s views</div>
                        <ul className="space-y-1">
                          {r.topKols.slice(0, 10).map((k, i) => (
                            <li
                              key={k.handle}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {/* Avatar on the far left (larger, uniform with TopKolsCard) */}
                                <AvatarCircle src={k.avatarUrl ?? undefined} sizePx={24} />

                                <span className="w-6 text-center text-[13px]">{rankEmoji(i)}</span>

                                <HandlePill
                                  handle={k.handle}
                                  href={`https://x.com/${k.handle}`}
                                  className="px-2 py-0.5"
                                />
                                {typeof k.followers === "number" ? (
                                  <span className="text-[11px] text-gray-400 tabular-nums">· {fmtCompact(k.followers)} followers</span>
                                ) : null}
                              </div>

                              <span className="text-[11px] text-gray-300 tabular-nums">{fmtCompact(k.views)} views</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.07] px-2.5 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-0.5 tabular-nums text-sm font-semibold text-white/90">{value}</div>
    </div>
  );
}
