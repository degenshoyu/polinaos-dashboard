"use client";

import React from "react";
import { Crown, Medal } from "lucide-react";

/** Coin count stat used by the parent list (kept for props compatibility). */
export type CoinStat = { tokenKey: string; tokenDisplay: string; count: number };

/** ROI item returned by /api/kols/coin-roi. */
type RoiItem = {
  tokenKey: string;
  tokenDisplay: string;
  mentionPrice: number | null;
  currentPrice: number | null;
  roi: number | null;
};

/** Compact number formatter with a safe fallback (for older browsers/locales). */
function nCompact(n: number) {
  const num = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(num);
  } catch {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return String(num);
  }
}

/** Engagement rate as percentage string. */
function pct(engs: number, views: number) {
  if (!views) return "0.0%";
  const v = (engs / views) * 100;
  return `${v.toFixed(1)}%`;
}

export default function MobileRow({
  r,
  rank,
  totals,
  shills,
  coinsAll, // kept for API compatibility; no longer used here
  basis = "earliest",
  days = 7,
}: {
  r: any;
  rank: number;
  totals: { tweets: number; views: number; engs: number; er: number };
  shills: { tweets: number; views: number; engs: number; er: number };
  coinsAll: CoinStat[];
  basis?: "earliest" | "latest" | "lowest" | "highest";
  days?: 7 | 30;
}) {
  const medal =
    rank === 1 ? <Crown size={16} className="text-yellow-300" /> :
    rank === 2 ? <Medal size={16} className="text-gray-300" /> :
    rank === 3 ? <Medal size={16} className="text-amber-500" /> : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      {/* Header: avatar + name + rank */}
      <div className="flex items-center gap-3">
        <img
          src={r.profileImgUrl || "/favicon.ico"}
          alt={r.displayName || r.twitterUsername || "KOL"}
          className="h-10 w-10 rounded-full object-cover"
          loading="lazy"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={`https://x.com/${r.twitterUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm text-white hover:underline"
              title={r.bio || ""}
            >
              {r.displayName || r.twitterUsername}
            </a>
            {medal}
            <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-gray-300">
              #{rank}
            </span>
          </div>
          <div className="truncate text-xs text-gray-400">
            {nCompact(r.followers || 0)} followers
          </div>
        </div>
      </div>

      {/* Metrics: Total + Shills */}
      <div className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
        <div className="col-span-4 text-[11px] font-semibold text-white/90">Total</div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Tweets</div>
          <div className="tabular-nums text-white">{nCompact(totals.tweets)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Views</div>
          <div className="tabular-nums text-white">{nCompact(totals.views)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Engs</div>
          <div className="tabular-nums text-white">{nCompact(totals.engs)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">ER</div>
          <div className="tabular-nums text-white">{pct(totals.engs, totals.views)}</div>
        </div>

        <div className="col-span-4 mt-1 text-[11px] font-semibold text-white/90">Shills</div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Tweets</div>
          <div className="tabular-nums text-white">{nCompact(shills.tweets)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Views</div>
          <div className="tabular-nums text-white">{nCompact(shills.views)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Engs</div>
          <div className="tabular-nums text-white">{nCompact(shills.engs)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">ER</div>
          <div className="tabular-nums text-white">{pct(shills.engs, shills.views)}</div>
        </div>
      </div>

      {/* Coins with ROI */}
      <div className="mt-3">
        <CoinsRoiListMobile handle={r.twitterUsername} basis={basis} days={days} />
      </div>
    </div>
  );
}

/** Mobile ROI list: 1 coin per line, show up to 4, expandable. */
function CoinsRoiListMobile({
  handle,
  basis,
  days,
}: {
  handle: string;
  basis: "earliest" | "latest" | "lowest" | "highest";
  days: 7 | 30;
}) {
  const [items, setItems] = React.useState<RoiItem[] | null>(null);
  const [openAll, setOpenAll] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Fetch ROI data for the given KOL handle and window
        const qs = new URLSearchParams({
          handle,
          days: String(days),
          mode: basis,
          // fetch more and then slice on client for "see more"
          limitPerKol: "32",
        });
        const res = await fetch(`/api/kols/coin-roi?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        if (!aborted) setItems((json?.items || []) as RoiItem[]);
      } catch (e: any) {
        if (!aborted) setErr(e?.message || "Failed to load ROI");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [handle, basis, days]);

  if (loading) return <div className="text-xs text-gray-400">Loading ROI…</div>;
  if (err) return <div className="text-xs text-rose-300">ROI error: {err}</div>;
  if (!items || items.length === 0)
    return <div className="text-xs text-gray-400">No coins</div>;

  const limit = 4;
  const visible = openAll ? items : items.slice(0, limit);

  const fmt = (n: number | null, percent = false) => {
    if (n == null || Number.isNaN(n)) return "—";
    return percent ? `${(n * 100).toFixed(1)}%` : `$${n.toFixed(6)}`;
  };

  return (
    <div className="space-y-1">
      {visible.map((c) => (
        <div
          key={c.tokenKey}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2 py-1"
        >
          <div className="truncate text-xs text-white">{c.tokenDisplay}</div>
          <div className="ml-2 grid grid-cols-3 gap-2 text-[11px] tabular-nums text-gray-300">
            <span title="Mention Price">{fmt(c.mentionPrice)}</span>
            <span title="Current Price">{fmt(c.currentPrice)}</span>
            <span
              title="Current ROI"
              className={
                c.roi != null && c.roi >= 0 ? "text-emerald-300" : "text-rose-300"
              }
            >
              {fmt(c.roi, true)}
            </span>
          </div>
        </div>
      ))}

      {items.length > limit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenAll((v) => !v);
          }}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/10"
          aria-expanded={openAll}
        >
          {openAll ? "see less" : "see more"}
        </button>
      )}

      <div className="text-[10px] text-gray-400">Basis: {basis}</div>
    </div>
  );
}
