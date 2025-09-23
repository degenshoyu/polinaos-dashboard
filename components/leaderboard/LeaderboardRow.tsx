"use client";

import { Crown, Medal } from "lucide-react";
import React from "react";
import { usePriceRefreshQueue } from "@/hooks/usePriceRefreshQueue";
import { useMaxRoiProgress, beginBatch as beginMaxBatch, markDone as markMaxDone } from "@/hooks/useMaxRoiProgress";

/** Price formatter with fixed 6 decimals and $ prefix */
function formatDollar6(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toFixed(6)}`;
}

/** Reusable cell: white blinking until fresh, then emerald; with industrial warning light */
function RealtimeCell({
  text,
  isFresh,
  srWhenFresh,
  srWhenRefreshing,
}: {
  text: string;
  isFresh: boolean;
  srWhenFresh: string;
  srWhenRefreshing: string;
}) {
  const needBlink = !isFresh;
  const cls = [
    "tabular-nums",
    needBlink
      ? "text-white animate-pulse"
      : isFresh
      ? "text-emerald-400 font-medium"
      : "text-gray-300",
  ].join(" ");
  return (
    <div className={cls} aria-live="polite">
      {text}
      <span className="relative inline-flex ml-1 align-middle" aria-hidden>
        <span className={`h-2 w-2 rounded-full ${isFresh ? "bg-emerald-400" : "bg-amber-400"}`} />
        {!isFresh && (
          <span className="absolute inline-flex h-2 w-2 rounded-full animate-ping bg-amber-400 opacity-75" />
        )}
      </span>
      <span className="sr-only">{isFresh ? srWhenFresh : srWhenRefreshing}</span>
    </div>
  );
}

export type CoinStat = { tokenKey: string; tokenDisplay: string; count: number };
type RoiItem = {
  tokenKey: string;            // Contract address or raw key (keep original casing; Solana is case-sensitive)
  tokenDisplay: string;
  isCA?: boolean;
  mentionPrice: number | null;
  currentPrice: number | null; // DB snapshot (may be overridden by live price)
  currentMc?: number | null;
  roi: number | null;
  mentionCount?: number;
  maxPriceSinceMention?: number | null;
  maxPriceAtSinceMention?: string | null; // ISO
  maxRoi?: number | null;
  chosenMentionId?: string | null;
  maxRoiFreshAt?: string | null;
};

function looksLikeCA(s: string) {
  try { return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(String(s)); } catch { return false; }
}

/** Compact number formatter (tweets, views, etc.) */
export function nCompact(n: number) {
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

/** Engagement rate text helper */
export function pct(engs: number, views: number) {
  if (!views) return "0.0%";
  const v = (engs / views) * 100;
  return `${v.toFixed(1)}%`;
}

export function LeaderboardRow({
  r,
  rank,
  totals,
  shills,
  coinsAll,
  onOpen,
  basis = "earliest",
  days = 7,
}: {
  r: any;
  rank: number;
  totals: { tweets: number; views: number; engs: number; er: number };
  shills: { tweets: number; views: number; engs: number; er: number };
  coinsAll: CoinStat[];
  onOpen?: (info: {
    twitterUsername: string;
    displayName?: string;
    profileImgUrl?: string;
  }) => void;
  basis?: "earliest" | "latest" | "lowest" | "highest";
  days?: 7 | 30;
}) {
  /** Rank medal (unchanged UI) */
  const medal =
    rank === 1 ? <Crown size={16} className="text-yellow-300" /> :
    rank === 2 ? <Medal size={16} className="text-gray-300" /> :
    rank === 3 ? <Medal size={16} className="text-amber-500" /> : null;

  const open = () => {
    onOpen?.({
      twitterUsername: r.twitterUsername,
      displayName: r.displayName,
      profileImgUrl: r.profileImgUrl,
    });
  };

  return (
    <div
      className="grid grid-cols-12 items-center gap-2 px-3 py-3 cursor-pointer hover:bg-white/5 transition"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open()}
    >
      {/* KOL (2 cols) */}
      <div className="col-span-2 flex items-center gap-3 min-w-0 border-r border-white/10">
        <img
          src={r.profileImgUrl || "/favicon.ico"}
          alt={r.displayName || r.twitterUsername || "KOL"}
          className="h-8 w-8 rounded-full object-cover"
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
              onClick={(e) => e.stopPropagation()}
            >
              {r.displayName || r.twitterUsername}
            </a>
            {medal}
          </div>
          <div className="truncate text-xs text-gray-400">
            {nCompact(r.followers || 0)} followers
          </div>
        {(() => {
          const v = r?.avgRoi;
          const ready = typeof v === "number" && Number.isFinite(v);
          const txt = ready ? `${(v * 100).toFixed(1)}%` : "—";
          const cls = ready ? (v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-gray-400") : "text-gray-400";
          return (
            <div className="mt-0.5 text-[11px]">
              <span className="text-gray-400">AVG ROI: </span>
              <span className={`tabular-nums font-medium ${cls}`}>{txt}</span>
            </div>
          );
        })()}
        </div>
      </div>

      {/* Twitter Metrics (4 cols) — four rows: Total/values + Shills/values */}
      <div className="col-span-4 pr-2 sm:pr-3 border-r border-white/10">
        <div className="text-[11px] font-medium text-gray-400 mb-1">Total</div>
        <div className="grid grid-cols-4 gap-x-2">
          <div className="text-sm tabular-nums text-white text-left">{nCompact(totals.tweets)}</div>
          <div className="text-sm tabular-nums text-white text-left">{nCompact(totals.views)}</div>
          <div className="text-sm tabular-nums text-white text-left">{nCompact(totals.engs)}</div>
          <div className="text-sm tabular-nums text-white text-left">{pct(totals.engs, totals.views)}</div>
        </div>

        <div className="mt-2 text-[11px] font-medium text-gray-400">Shills</div>
        <div className="grid grid-cols-4 gap-x-2">
          <div className="text-sm tabular-nums text-emerald-300 text-left">{nCompact(shills.tweets)}</div>
          <div className="text-sm tabular-nums text-emerald-300 text-left">{nCompact(shills.views)}</div>
          <div className="text-sm tabular-nums text-emerald-300 text-left">{nCompact(shills.engs)}</div>
          <div className="text-sm tabular-nums text-emerald-300 text-left">{pct(shills.engs, shills.views)}</div>
        </div>
      </div>

      {/* Coins (ROI) — 6 cols: Token | Mention | Current | ROI Now | MAX ROI | MC */}
      <div className="col-span-6">
        <CoinsRoiList handle={r.twitterUsername} basis={basis} days={days} />
      </div>
    </div>
  );
}

/**
 * CoinsRoiList:
 * - Loads DB-based coin ROI list via /api/kols/coin-roi
 * - Enqueues tokens missing currentPrice into a global single-flight queue
 *   (queue will: DB probe → GeckoTerminal fetch with 429 logging/backoff → POST snapshots to DB)
 * - UI prefers live price from queue, falling back to DB currentPrice
 * - ROI always uses the latest available current price
 */
function CoinsRoiList({
  handle,
  basis,
  days,
}: {
  handle: string;
  basis: "earliest" | "latest" | "lowest" | "highest";
  days: 7 | 30;
}) {
  const [items, setItems] = React.useState<RoiItem[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [openAll, setOpenAll] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const didEnqueueRef = React.useRef(false);

  /** Global, shared queue (prevents multi-row concurrency; logs 429 with backoff) */
  const queue = usePriceRefreshQueue({ delayMs: [600, 1200], maxRetries: 2 });
  const liveGet = queue.get;
  const enqueueMany = queue.enqueueMany;
  const { progress: maxProg } = useMaxRoiProgress();

  /** Load DB-based ROI list once (and on filters change) */
  async function load(): Promise<RoiItem[]> {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({
        handle,
        days: String(days),
        mode: basis,
        limitPerKol: "32", // request generously; UI will slice
      });
      // pass-through debug=1 if present in page URL
      if (typeof window !== "undefined" && window.location.search.includes("debug=1")) {
        qs.set("debug", "1");
      }
      const r = await fetch(`/api/kols/coin-roi?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || r.statusText);
      const arr = (j?.items || []) as RoiItem[];
      setItems(arr);
      return arr;
    } catch (e: any) {
      setErr(e?.message || "Failed to load ROI");
      return [];
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let aborted = false;
    didEnqueueRef.current = false;
    (async () => {
      const first = await load();
      if (aborted) return;

      // Enqueue ALL tokens once. The queue itself will skip refresh if the DB snapshot is within 10min.
      const targets = first.filter((x) => (x.isCA ?? looksLikeCA(x.tokenKey)) && !!x.tokenKey);
      if (targets.length && !didEnqueueRef.current) {
        didEnqueueRef.current = true;
        enqueueMany(targets.map((x) => ({ ca: x.tokenKey, network: "solana" as const })));
      }

      try {
        const now = Date.now();
        const stale = first.filter((x) => {
          const at = x.maxPriceAtSinceMention ? Date.parse(x.maxPriceAtSinceMention) : 0;
          const tooOld = !at || now - at > 10 * 60 * 1000;
          const isCA = x.isCA ?? looksLikeCA(x.tokenKey);
          return isCA && tooOld && x.chosenMentionId && x.tokenKey;
        });
        if (stale.length) {
          beginMaxBatch(stale.length);
          const staleIds = new Set(stale.map(s => String(s.chosenMentionId)));
          const refreshedAt = new Date().toISOString();
          const body = {
            items: stale.map((s) => ({
              ca: s.tokenKey!,
              mentionId: s.chosenMentionId!,
              network: "solana",
              minutePatch: true,
              minuteAgg: 15,
              poolMode: "primary",
            })),
          };
          const debugSuffix =
            (typeof window !== "undefined" && window.location.search.includes("debug=1"))
              ? "?debug=1"
              : "";
          const r2 = await fetch(`/api/kols/maxroi/refresh${debugSuffix}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const j2 = await r2.json();
          if (r2.ok && Array.isArray(j2?.updated)) {
            const map = new Map(j2.updated.map((u: any) => [String(u.id), u]));
            setItems((prev) => {
              const arr: RoiItem[] = (prev ?? []) as RoiItem[];
              return arr.map((it: RoiItem) => {
                if (!it.chosenMentionId) return it;

                const id = String(it.chosenMentionId);
                const u = map.get(id) as any | undefined;

                if (u) {
                  const maxPxRaw = u.maxPriceSinceMention ?? u.maxPrice ?? null;
                  const maxAtRaw = u.maxPriceAtSinceMention ?? u.maxAt ?? null;
                  const maxPx = maxPxRaw != null ? Number(maxPxRaw) : null;
                  return {
                    ...it,
                    maxPriceSinceMention: maxPx ?? it.maxPriceSinceMention ?? null,
                    maxPriceAtSinceMention: maxAtRaw ?? it.maxPriceAtSinceMention ?? null,
                    maxRoiFreshAt: u.refreshedAt ?? refreshedAt,
                    maxRoi:
                      maxPx != null && it.mentionPrice != null && it.mentionPrice > 0
                        ? (maxPx - it.mentionPrice) / it.mentionPrice
                        : 0,
                  };
                }
                if (staleIds.has(id)) {
                  return { ...it, maxRoiFreshAt: refreshedAt };
                }
                return it;
              });
            });
          }
          if (!aborted) markMaxDone(stale.length);
        }
      } catch {}
      // No immediate reload: UI reads live prices from queue state
    })();
    return () => { aborted = true; };
  }, [handle, basis, days, enqueueMany]);

  if (err) return <div className="text-xs text-rose-300">ROI error: {err}</div>;

  const INITIAL_LIMIT = 3;
  const data = items && items.length ? (openAll ? items : items.slice(0, INITIAL_LIMIT)) : null;

  return (
    <div className="space-y-1">
      {/* Initial skeleton rows while loading (unchanged style) */}
      {!data && (<><SkeletonRow/><SkeletonRow/><SkeletonRow/></>)}

      {data?.map((it) => {
        const mpTxt = formatDollar6(it.mentionPrice);

        // Prefer live price from queue; fallback to DB current
        const ca = (it.isCA ?? looksLikeCA(it.tokenKey)) ? it.tokenKey : null;
        const liveCp = ca ? liveGet(ca) : undefined;
        const cur = (liveCp ?? it.currentPrice) ?? null;
        const cpTxt = formatDollar6(cur);

        // ROI uses the latest 'cur' (live or DB)
        const roiTxt = (it.mentionPrice == null || cur == null)
          ? "—"
          : `${(((cur - it.mentionPrice) / it.mentionPrice) * 100).toFixed(1)}%`;
        // Placeholder for MAX ROI until backend provides it (optional field)
        const maxRoiTxt =
          typeof it.maxRoi === "number" && isFinite(it.maxRoi)
            ? `${(it.maxRoi * 100).toFixed(1)}%`
            : "—";
        const freshMs = it.maxRoiFreshAt ? Date.parse(it.maxRoiFreshAt) : 0;
        const isMaxFresh = !ca
          ? true
          : (!maxProg.updating
              ? true
              : freshMs
                ? (Date.now() - freshMs) <= 10 * 60 * 1000
                : (it.maxPriceAtSinceMention
                    ? (Date.now() - Date.parse(it.maxPriceAtSinceMention) <= 10 * 60 * 1000)
                    : false)
            );

        const liveMc = ca ? (queue as any).getMc?.(ca) : undefined;
        const curMc = (liveMc ?? it.currentMc) ?? null;
        const mcTxt = curMc == null ? "—" : `$${nCompact(curMc)}`;

        const cnt = it.mentionCount ?? 1;
        const isFresh = ca ? queue.isDbFresh(ca) : true;

        return (
          <div
            key={`${it.tokenKey}::${it.tokenDisplay}`}
            className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 text-xs"
          >
            {/* Ticker pill + mention count */}
            <div className="truncate" title={it.tokenDisplay}>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5
                                bg-emerald-400/10 border-emerald-400/20 text-emerald-200
                                shadow-[0_0_0_1px_rgba(16,185,129,0.15)_inset] backdrop-blur-[1px]
                                hover:bg-emerald-400/15 hover:border-emerald-400/30 transition-colors">
                <span className="truncate">{it.tokenDisplay}</span>
                <span className="text-[10px] text-emerald-300/80">×{cnt}</span>
              </span>
            </div>

            {/* Ref. Px */}
            <div className="tabular-nums text-gray-300">{mpTxt}</div>

            <RealtimeCell
              text={cpTxt}
              isFresh={isFresh}
              srWhenFresh="Price up to date"
              srWhenRefreshing="Refreshing price"
            />



            {/* ROI Now (colored by gain/loss) */}
            <div
              className={[
                "tabular-nums",
                it.mentionPrice != null && cur != null
                  ? cur >= it.mentionPrice ? "text-emerald-300" : "text-rose-300"
                  : "text-gray-400",
              ].join(" ")}
            >
              {roiTxt}
            </div>

            {/* MAX ROI (RealtimeCell same as price/MC) */}
            <RealtimeCell
              text={maxRoiTxt}
              isFresh={isMaxFresh}
              srWhenFresh="Max ROI up to date"
              srWhenRefreshing="Refreshing MAX ROI"
            />

            <RealtimeCell
              text={mcTxt}
              isFresh={isFresh}
              srWhenFresh="Market cap up to date"
              srWhenRefreshing="Refreshing market cap"
            />
          </div>
        );
      })}

      {/* Expand/collapse if there are more than INITIAL_LIMIT rows (unchanged UI) */}
      {items && items.length > INITIAL_LIMIT && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpenAll(v => !v); }}
          className="text-[11px] text-gray-400 underline underline-offset-2"
        >
          {openAll ? "Show less" : `Show all (${items.length - INITIAL_LIMIT})`}
        </button>
      )}
    </div>
  );
}

/** Simple skeleton row for initial loading state (unchanged style) */
const SkeletonRow = React.memo(function SkeletonRow() {
  return (
    <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 text-xs">
      <div className="h-5 w-32 rounded-full bg-white/10" />
      <div className="h-4 w-16 rounded bg-white/10" />
      <div className="h-4 w-16 rounded bg-white/10" />
      <div className="h-4 w-10 rounded bg-white/10" />
      <div className="h-4 w-10 rounded bg-white/10" />
      <div className="h-4 w-16 rounded bg-white/10" />
    </div>
  );
});
