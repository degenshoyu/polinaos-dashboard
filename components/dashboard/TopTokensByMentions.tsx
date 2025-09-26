// components/dashboard/TopTokensByMentions.tsx
"use client";

/**
 * Top Coins with token preview popup
 * - Row: avatar + rank + $TICKER(click-to-copy) + MktCap pill + score
 * - Popup: metrics + token preview (image / price / mcap / 24h vol / liq / socials) + top KOLs
 */

import * as React from "react";
import { CircleHelp, Coins, Link as LinkIcon } from "lucide-react";
import clsx from "clsx";
import {
  TickerPill,
  rankEmoji,
  fmtCompact,
  fmtPct,
  HandlePill,
  AvatarCircle,
} from "./LeaderboardBits";

// ===== Inline Age helpers (no name clash with bottom helpers) =====
const createdAtCache = new Map<string, string>(); // CA -> ISO string (inline cache)

function normalizeCreatedAtInline(v: unknown, allowFutureDays = 3): string | undefined {
  if (v == null) return undefined;
  let ms: number | null = null;
  if (typeof v === "number") {
    ms = v < 2_000_000_000 ? v * 1000 : v;
  } else if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      ms = n < 2_000_000_000 ? n * 1000 : n;
    } else {
      const t = Date.parse(v);
      ms = Number.isNaN(t) ? null : t;
    }
  }
  if (ms == null || !Number.isFinite(ms)) return undefined;
  const now = Date.now();
  const maxFuture = now + allowFutureDays * 86400000;
  if (ms > maxFuture) return undefined;
  if (ms > now) ms = now;
  const min = Date.UTC(2013, 0, 1);
  if (ms < min) return undefined;
  return new Date(ms).toISOString();
}

function pickBestPairCreatedAtInline(pairs: any[]): unknown {
  if (!Array.isArray(pairs) || pairs.length === 0) return undefined;
  const pref = new Set(["SOL", "WETH", "ETH", "USDC", "USDT"]);
  const scored = pairs
    .map((p) => ({
      liq: Number(p?.liquidity?.usd ?? p?.liquidityUSD ?? p?.reserveUsd ?? p?.liquidity ?? 0),
      isPref: pref.has(p?.quoteToken?.symbol?.toUpperCase?.() || ""),
      created: p?.pairCreatedAt ?? p?.createdAtMs ?? p?.createdAt,
    }))
    .filter((x) => x.created != null)
    .sort((a, b) => (a.isPref !== b.isPref ? (a.isPref ? -1 : 1) : b.liq - a.liq));
  return scored[0]?.created;
}

function useCreatedAt(row: any, index: number) {
  const [createdAt, setCreatedAt] = React.useState<string | undefined>(() => {
    if (row?.createdAt) return normalizeCreatedAtInline(row.createdAt);
    if (row?.contractAddress && createdAtCache.has(row.contractAddress)) {
      return createdAtCache.get(row.contractAddress);
    }
    return undefined;
  });

  React.useEffect(() => {
    if (createdAt) return;
    if (!row?.contractAddress) return;
    if (index >= 20) return; // 首屏前 20 行懒取

    let aborted = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          chain: String(row?.networkId || "solana"),
          address: String(row?.contractAddress),
        });
        const r = await fetch(`/api/dexscreener/info?${qs.toString()}`);
        if (!r.ok) return;
        const data = await r.json();
        const picked =
          normalizeCreatedAtInline(data?.createdAt) ||
          normalizeCreatedAtInline(pickBestPairCreatedAtInline(data?.pairs));
        if (!aborted && picked) {
          createdAtCache.set(String(row.contractAddress), picked);
          setCreatedAt(picked);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      aborted = true;
    };
  }, [createdAt, row?.contractAddress, row?.networkId, index]);

  return createdAt;
}

// ---------- types ----------
export type TopCoinRow = {
  tokenKey: string;
  tokenDisplay: string;
  contractAddress?: string | null;

  mentions: number;
  shillers: number;
  views: number;
  engs: number;
  er: number; // 0..1
  velocity: number; // ratio
  score: number; // 0..1

  topKols?: Array<{
    handle: string;
    avatarUrl?: string | null;
    followers?: number | null;
    /** Tweets about this coin within the selected window */
    tweets?: number;
    /** Aggregated views from those tweets (used for ranking) */
    views: number;
    /** Total engagements = likes + retweets + replies */
    engs?: number;
  }>;
};

type Props = {
  rows: TopCoinRow[];
  days: 7 | 30;
  title?: string;
};

type TokenPreviewData = {
  imageUrl?: string | null;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  volume24hUsd?: number | null;
  reserveUsd?: number | null;
  dex?: string | null;
  dexUrl?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  createdAt?: number | string | null;
};
type TokenPreview = { loading: boolean; data?: TokenPreviewData };

// ---------- component ----------
export default function TopTokensByMentions({ rows, days, title = "Top Coins" }: Props) {
  const MCAP_MIN = 100_000;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [previews, setPreviews] = React.useState<Record<string, TokenPreview>>({});
  const inflightRef = React.useRef<Record<string, boolean>>({});
  const queueRef = React.useRef<Array<{ id: string; row: TopCoinRow }>>([]);
  const runningRef = React.useRef(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // click outside
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // ESC
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // data window switch -> close popups
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

  const enqueuePreview = React.useCallback((id: string, row: TopCoinRow) => {
    if (!row?.contractAddress) return;
    if (inflightRef.current[id]) return;
    if (previews[id]?.data) return;
    inflightRef.current[id] = true;
    queueRef.current.push({ id, row });
    (async function runQueue() {
      if (runningRef.current) return;
      runningRef.current = true;
      const sleep = (ms:number)=>new Promise(res=>setTimeout(res, ms));
      while (queueRef.current.length > 0) {
        const { id: curId, row: curRow } = queueRef.current.shift()!;
        setPreviews((m) => ({ ...m, [curId]: { loading: true, data: m[curId]?.data } }));
        const data = await fetchPreview(curRow).catch(() => null);
        setPreviews((m) => ({ ...m, [curId]: { loading: false, data: data ?? m[curId]?.data } }));
        inflightRef.current[curId] = false;
        await sleep(220);
      }
      runningRef.current = false;
    })();
  }, [previews]);

  const { sortedRows, scoreMap } = React.useMemo(() => computeClientRanking(rows ?? []), [rows]);
  const candidateRows = React.useMemo(() => sortedRows.slice(0, 20), [sortedRows]);
  const top10 = React.useMemo(() => {
    const out: typeof sortedRows = [];
    for (const r of candidateRows) {
      if (out.length >= 10) break;
      const id = `${r.tokenKey}-${r.contractAddress ?? "noca"}`;
      const mcap = previews[id]?.data?.marketCapUsd;
      if (typeof mcap === "number" && isFinite(mcap) && mcap < MCAP_MIN) continue;
      out.push(r);
    }
    return out;
  }, [candidateRows, previews]);

  React.useEffect(() => {
    const PRELOAD_COUNT_CANDIDATES = 20;
    candidateRows.slice(0, PRELOAD_COUNT_CANDIDATES).forEach((r) => {
      const id = `${r.tokenKey}-${r.contractAddress ?? "noca"}`;
      enqueuePreview(id, r);
    });
  }, [days, rows?.length, enqueuePreview, candidateRows]);

  return (
    <div
      ref={rootRef}
      className="group/card relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Coins className="h-[18px] w-[18px] text-emerald-300" />
          <div className="font-medium">
            {title} <span className="opacity-70">({days}d)</span>
          </div>
        </div>

        <div className="relative group/help">
          <CircleHelp
            className="h-4 w-4 text-gray-300/90 hover:text-white cursor-help"
            aria-label="Score formula"
            role="img"
          />
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
            <div className="font-medium mb-1 text-white/90">How the score is calculated</div>
            <div className="text-white/80">
              <p className="mb-1">We compute ranks over the selected window (7d/30d):</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><span className="font-medium">Views</span> (35%) and <span className="font-medium">Views / Tweet</span> (35%).</li>
                <li><span className="font-medium">Shillers</span> (20%).</li>
                <li><span className="font-medium">Others</span> 10% total: Mentions, Engagements, ER, Velocity (2.5% each).</li>
              </ul>
              <p className="mt-1 text-white/70">All metrics use log1p then min–max normalization before weighting. Score ranges 0–1.</p>
            </div>
          </div>
        </div>
      </div>

      {top10.length === 0 ? (
        <div className="text-sm text-gray-400">No coins found in this range.</div>
      ) : (
        <ul className="relative space-y-2 text-sm">
          {top10.map((r, idx) => {
            const rowId = `${r.tokenKey}-${r.contractAddress ?? "noca"}`;
            const pinned = openId === rowId;
            const copied = copiedId === rowId;
            const hasCA = !!r.contractAddress;
            const createdInline = useCreatedAt(r, idx);

            const cleanTicker = (r.tokenDisplay || r.tokenKey || "")
              .replace(/^\$+/, "")
              .toUpperCase();
            const chipText = `$${cleanTicker}`;
            const pv = previews[rowId];
            const imageUrl = pv?.data?.imageUrl ?? undefined;
            const mcapInline = pv?.data?.marketCapUsd;

            return (
              <li key={rowId} className="relative">
                {/* Row head */}
                <div
                  role="button"
                  onClick={() => toggleRow(rowId)}
                  className={clsx(
                    "group/row flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30",
                    "transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5",
                    "hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AvatarCircle src={imageUrl} sizePx={24} />
                    <span className="w-8 text-center">{rankEmoji(idx)}</span>

                    {/* Click ticker to copy CA */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasCA) onCopy(rowId, r.contractAddress);
                      }}
                      className="group/ticker -m-0.5 rounded-md p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                      title={hasCA ? "Click to copy contract" : undefined}
                      aria-label={hasCA ? "Copy contract address" : undefined}
                    >
                      <TickerPill text={chipText} title={`$${cleanTicker}`} />
                    </button>

                    {/* inline MktCap pill right after ticker */}
                    <span
                      className={clsx(
                        "inline-flex items-center gap-1 rounded-md border border-white/10",
                        "bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/90 tabular-nums"
                      )}
                      title="Market Cap"
                    >
                      <span className="text-gray-300/90">MktCap</span>
                      <span>{typeof mcapInline === "number" ? moneyShort(mcapInline) : "-"}</span>
                    </span>

                    {/* copied toast */}
                    {copied ? (
                      <span
                        className={clsx(
                          "select-none rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          "bg-emerald-500/95 text-black border border-emerald-300/80 shadow"
                        )}
                      >
                        Copied!
                      </span>
                    ) : null}
                  </div>

                  {/* Right side: score only */}
                  <div className="tabular-nums text-gray-200 font-semibold">
                    {`score ${(scoreMap[`${r.tokenKey}-${r.contractAddress ?? "noca"}`] ?? 0).toFixed(2)}`}
                  </div>
                </div>

                {/* Popup (inside li; uses hover + pinned) */}
                <div
                  data-open={pinned ? "true" : "false"}
                  className={clsx(
                    "absolute left-0 right-0 top-[calc(100%+6px)] z-30",
                    "invisible opacity-0 translate-y-1",
                    "group-hover/row:visible group-hover/row:opacity-100 group-hover/row:translate-y-0",
                    "data-[open=true]:visible data-[open=true]:opacity-100 data-[open=true]:translate-y-0",
                    "transition-all duration-200"
                  )}
                  onMouseEnter={() => enqueuePreview(rowId, r)}
                  onFocus={() => enqueuePreview(rowId, r)}
                >
                  <div
                    className={clsx(
                      "relative overflow-hidden rounded-2xl border border-white/12 backdrop-blur-xl px-4 py-3",
                      "bg-[linear-gradient(135deg,rgba(20,34,32,0.96),rgba(12,19,18,0.96))]",
                      "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                    )}
                  >
                    <div
                      className="pointer-events-none absolute -inset-px rounded-2xl opacity-80"
                      style={{
                        background:
                          "radial-gradient(120% 80% at 0% 0%, rgba(47,212,128,0.18) 0%, rgba(62,242,172,0.10) 35%, transparent 70%)",
                      }}
                      aria-hidden
                    />

                    <TokenPreviewBlock
                      loading={previews[rowId]?.loading}
                      data={previews[rowId]?.data}
                      ticker={cleanTicker}
                      contractAddress={r.contractAddress ?? undefined}
                      createdOverride={createdInline}
                    />

                    {/* activity metrics */}
                    <div className="mt-3">
                      <div className="text-[11px] text-gray-400 mb-1">CT Activity</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {chip("Mentions", fmtCompact(r.mentions))}
                        {chip("Shillers", fmtCompact(r.shillers))}
                        {chip("Views", fmtCompact(r.views))}
                        {chip("Engs", fmtCompact(r.engs))}
                        {chip("ER", fmtPct(r.er))}
                      </div>
                    </div>

                    {Array.isArray(r.topKols) && r.topKols.length > 0 ? (
                      <div className="relative mt-3">
                        <div className="text-[11px] text-gray-400 mb-1">Top KOLs · by views</div>
                        <ul className="space-y-1">
                          {([...r.topKols]
                            .sort((a, b) => (Number(b?.views ?? 0) - Number(a?.views ?? 0)))
                            .slice(0, 3)
                          ).map((k, i) => (
                            <li
                              key={k.handle}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <AvatarCircle src={k.avatarUrl ?? undefined} sizePx={24} />
                               <span className="w-6 text-center text-[13px]">{rankEmoji(i)}</span>
                                <HandlePill handle={k.handle} href={`https://x.com/${k.handle}`} className="px-2 py-0.5" />
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-gray-300 shrink-0">
                                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 tabular-nums">
                                  <span className="text-gray-400">Tweets</span>
                                  <span>{typeof k.tweets === "number" ? fmtCompact(k.tweets) : "-"}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 tabular-nums">
                                  <span className="text-gray-400">Views</span>
                                  <span>{fmtCompact(k.views)}</span>
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 tabular-nums">
                                  <span className="text-gray-400">Engs</span>
                                  <span>{typeof k.engs === "number" ? fmtCompact(k.engs) : "-"}</span>
                                </span>
                              </div>
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

/* ---------- bits ---------- */

function Metric({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.07] px-2.5 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-0.5 tabular-nums text-sm font-semibold text-white/90">{value}</div>
    </div>
  );
}

/** small pill used in preview to display Price/Mcap/Vol/Liq/Age/DEX */
function chip(label: string, value: React.ReactNode) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.08] px-2 py-1 text-[11px] text-white/90">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums">{value ?? "-"}</span>
    </span>
  );
}

function TokenPreviewBlock({
  loading,
  data,
  ticker,
  contractAddress,
  createdOverride,
}: {
  loading?: boolean;
  data?: TokenPreviewData;
  ticker: string;
  contractAddress?: string;
  createdOverride?: string | undefined;
}) {
  const imageUrl = data?.imageUrl ?? null;
  const price = data?.priceUsd ?? null;
  const mcap = data?.marketCapUsd ?? null;
  const vol = data?.volume24hUsd ?? null;
  const liq = data?.reserveUsd ?? null;
  const dex = data?.dex ?? null;
  const dexUrl =
    data?.dexUrl ??
    (contractAddress ? `https://dexscreener.com/search?q=${encodeURIComponent(contractAddress)}` : null);
  const website = data?.website ?? null;
  const twitter = data?.twitter ?? null;
  const telegram = data?.telegram ?? null;
  const created = data?.createdAt ?? createdOverride;

  return (
    <div className="relative mt-3 rounded-xl border border-white/10 bg-white/[0.06] p-3">
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 overflow-hidden rounded-full bg-white/10 shrink-0">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={ticker} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-300">
              {ticker?.slice(0, 2) || "?"}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-white/90 truncate">
            <span className="font-semibold">${ticker}</span>
            {dex ? (
              <span className="inline-flex items-center rounded-md border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {dex}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-gray-400 truncate">TOKEN: {shortAddr(contractAddress)}</div>
        </div>
        <div className="ml-auto text-right text-xs text-gray-300 shrink-0">
          <div>{typeof price === "number" ? `$${price.toFixed(6)}` : "-"}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chip("MktCap", moneyShort(mcap))}
        {chip("Liq", moneyShort(liq))}
        {chip("24H Vol", moneyShort(vol))}
        {chip("Age", ageText(created))}
        {chip(
          "DEX",
          dexUrl ? (
            <a href={dexUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-90">
              {dex || "Dexscreener"}
            </a>
          ) : (
            dex || "-"
          )
        )}
      </div>

      {loading && <div className="mt-2 text-[11px] text-gray-400">Loading token info…</div>}

      {(website || twitter || telegram) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 hover:bg-white/[0.08]"
            >
              <LinkIcon className="h-3 w-3" />
              Website
            </a>
          )}
          {twitter && (
            <a
              href={twitter}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 hover:bg-white/[0.08]"
            >
              <LinkIcon className="h-3 w-3" />
              Twitter
            </a>
          )}
          {telegram && (
            <a
              href={telegram}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 hover:bg-white/[0.08]"
            >
              <LinkIcon className="h-3 w-3" />
              Telegram
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function shortAddr(addr?: string) {
  if (!addr) return "-";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function moneyShort(v?: number | null) {
  if (typeof v !== "number" || !isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

function ageText(createdAt?: string | number | null) {
  const iso = normalizeCreatedAt(createdAt ?? undefined);
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days < 1) return "new";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  return `${months}mo${rest ? ` ${rest}d` : ""}`;
}

// choose best createdAt from pairs (Dexscreener)
function pickBestPairCreatedAt(info: any): number | string | undefined {
  const ps = Array.isArray(info?.pairs) ? info.pairs : [];
  if (!ps.length) return undefined;

  const preferred = new Set(["SOL", "WETH", "ETH", "USDC", "USDT"]);

  type PairScore = { liq: number; pref: boolean; created: number | string };
  const scored: PairScore[] = ps
    .map((p: any) => {
      const liq = p?.liquidity?.usd ?? p?.liquidityUSD ?? p?.reserveUsd ?? p?.liquidity ?? 0;
      const quote = p?.quoteToken?.symbol?.toUpperCase?.();
      const created = p?.pairCreatedAt ?? p?.createdAtMs ?? p?.createdAt;
      return { liq: Number(liq) || 0, pref: quote ? preferred.has(quote) : false, created } as PairScore;
    })
    .filter((x: PairScore): x is PairScore => x.created != null);

  if (!scored.length) return undefined;

  scored.sort((a: PairScore, b: PairScore) =>
    a.pref !== b.pref ? (a.pref ? -1 : 1) : b.liq - a.liq
  );

  return scored[0].created;
}

function normalizeCreatedAt(
  v: unknown,
  opts: { allowFutureDays?: number } = {}
): string | undefined {
  if (v == null) return undefined;
  const allowFutureDays = opts.allowFutureDays ?? 3;
  let ms: number | null = null;

  if (typeof v === "number") {
    ms = v < 2_000_000_000 ? v * 1000 : v;
  } else if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      ms = n < 2_000_000_000 ? n * 1000 : n;
    } else {
      const t = Date.parse(v);
      ms = Number.isNaN(t) ? null : t;
    }
  }

  if (ms == null || !Number.isFinite(ms)) return undefined;

  const now = Date.now();
  const maxFuture = now + allowFutureDays * 86400000;
  if (ms > maxFuture) return undefined;
  if (ms > now) ms = now;

  const min = Date.UTC(2013, 0, 1);
  if (ms < min) return undefined;

  return new Date(ms).toISOString();
}

// ---------- pull numbers from GeckoTerminal, socials from /api/dexscreener/info ----------
async function fetchPreview(r: TopCoinRow): Promise<TokenPreviewData | null> {
  const ca = r.contractAddress?.trim();
  if (!ca) return null;

  try {
    const gtUrl = `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(
      ca
    )}&include=base_token,quote_token`;
    const gtRes = await fetch(gtUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!gtRes.ok) throw new Error(`GeckoTerminal HTTP ${gtRes.status}`);
    const gt = (await gtRes.json()) as any;
    const pools: any[] = Array.isArray(gt?.data) ? gt.data : [];
    const included: any[] = Array.isArray(gt?.included) ? gt.included : [];
    const tokenById = new Map<string, any>();
    const dexById = new Map<string, any>();
    for (const inc of included) {
      if (inc?.type === "token") tokenById.set(inc.id, inc);
      else if (inc?.type === "dex") dexById.set(inc.id, inc);
    }
    const candidates = pools.map((p) => {
      const baseId = p?.relationships?.base_token?.data?.id || "";
      const dexId = p?.relationships?.dex?.data?.id || null;
      const base = tokenById.get(baseId);
      const chain = chainFromId(base?.id || baseId);
      const priceUsd = toNum(p?.attributes?.base_token_price_usd);
      const vol24h = toNum(p?.attributes?.volume_usd?.h24);
      const liq = toNum(p?.attributes?.reserve_in_usd);
      const mcap = toNum(p?.attributes?.market_cap_usd);
      const fdv  = toNum(p?.attributes?.fdv_usd);
      const capOrFdv = mcap || fdv || 0;
      const score = scorePool(vol24h, liq, capOrFdv);
      const createdRaw =
        p?.attributes?.pool_created_at ??
        p?.attributes?.pair_created_at ??
        p?.attributes?.created_at ??
        p?.attributes?.launched_at ??
        null;
      return {
        chain,
        score,
        priceUsd,
        vol24h,
        liq,
        mcap,
        fdv,
        logo: base?.attributes?.image_url ?? null,
        dexName: (dexId && (dexById.get(dexId)?.attributes?.name || dexId)) || null,
        createdRaw,
      };
    });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    let dexInfo: any = null;
    try {
      const qs = new URLSearchParams(best?.chain ? { chain: best.chain, address: ca } : { address: ca });
      const r2 = await fetch(`/api/dexscreener/info?${qs.toString()}`, { headers: { "cache-control": "no-store" } });
      if (r2.ok) dexInfo = await r2.json();
    } catch {}

    // Prefer GeckoTerminal createdAt
    const createdGecko =
      best?.createdRaw != null
        ? normalizeCreatedAt(best.createdRaw, { allowFutureDays: 7 })
        : undefined;
    // Fallback to Dexscreener
    const createdBestPair = pickBestPairCreatedAt(dexInfo);
    const createdDexTop   = normalizeCreatedAt(dexInfo?.createdAt, { allowFutureDays: 3 });
    const createdDexPair  = normalizeCreatedAt(createdBestPair, { allowFutureDays: 3 });
    const created = createdGecko || createdDexTop || createdDexPair || undefined;

    return {
      imageUrl: best?.logo ?? dexInfo?.imageUrl ?? dexInfo?.logo ?? null,
      priceUsd: best?.priceUsd ?? undefined,
      marketCapUsd: best?.mcap || best?.fdv || undefined,
      volume24hUsd: best?.vol24h ?? undefined,
      reserveUsd: best?.liq ?? undefined,
      dex: dexInfo?.dex ?? dexInfo?.dexName ?? best?.dexName ?? null,
      dexUrl:
        dexInfo?.dexUrl ??
        (best?.chain ? `https://dexscreener.com/${best.chain}/${ca}` : null),
      twitter: dexInfo?.twitter ?? null,
      telegram: dexInfo?.telegram ?? null,
      website: dexInfo?.website ?? null,
      createdAt: created,
    };
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function scorePool(vol24h: number | undefined, liq: number | undefined, cap: number | undefined) {
  const sVol = Math.log10(1 + Math.max(0, vol24h ?? 0));
  const sLiq = Math.log10(1 + Math.max(0, liq ?? 0));
  const sCap = Math.log10(1 + Math.max(0, cap ?? 0));
  return 3.0 * sVol + 1.6 * sLiq + 1.2 * sCap;
}

function chainFromId(id?: string) {
  if (!id) return "";
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : "";
}

/* ----------------- client-side ranking (views/vpt/shillers first) ----------------- */
type Ranked = { row: TopCoinRow; score: number; id: string };

function computeClientRanking(rows: TopCoinRow[]) {
  if (!Array.isArray(rows) || rows.length === 0) return { sortedRows: [], scoreMap: {} as Record<string, number> };

  // raw metrics
  const xs = rows.map((r) => {
    const id = `${r.tokenKey}-${r.contractAddress ?? "noca"}`;
    const mentions = safeNum(r.mentions);
    const views = safeNum(r.views);
    const shillers = safeNum(r.shillers);
    const engs = safeNum(r.engs);
    const er = clamp01(r.er ?? 0);           // already 0..1
    const velocity = Math.max(0, Number(r.velocity ?? 0)); // ratio >=0
    const vpt = mentions > 0 ? views / mentions : 0;       // views per tweet
    return { id, r, mentions, views, vpt, shillers, engs, er, velocity };
  });

  // log1p then min-max normalize for heavy-tailed metrics
  const norm = (arr: number[]) => minMax(arr.map((v) => Math.log1p(Math.max(0, v))));
  const n_views    = norm(xs.map((x) => x.views));
  const n_vpt      = norm(xs.map((x) => x.vpt));
  const n_shillers = norm(xs.map((x) => x.shillers));
  const n_mentions = norm(xs.map((x) => x.mentions));
  const n_engs     = norm(xs.map((x) => x.engs));
  const n_velocity = norm(xs.map((x) => x.velocity));
  const n_er       = minMax(xs.map((x) => clamp01(x.er))); // already bounded

  const W = {
    views: 0.35,
    vpt: 0.35,
    shillers: 0.20,
    mentions: 0.025,
    engs: 0.025,
    er: 0.025,
    velocity: 0.025,
  };

  const ranked: Ranked[] = xs.map((x, i) => {
    const score =
      W.views    * n_views[i] +
      W.vpt      * n_vpt[i] +
      W.shillers * n_shillers[i] +
      W.mentions * n_mentions[i] +
      W.engs     * n_engs[i] +
      W.er       * n_er[i] +
      W.velocity * n_velocity[i];
    return { row: x.r, score, id: x.id };
  });

  ranked.sort((a, b) => b.score - a.score);
  const sortedRows = ranked.map((k) => k.row);
  const scoreMap: Record<string, number> = Object.fromEntries(ranked.map((k) => [k.id, k.score]));
  return { sortedRows, scoreMap };
}

function minMax(arr: number[]) {
  if (!arr.length) return arr;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  if (!isFinite(min) || !isFinite(max)) return arr.map(() => 0);
  if (max === min) return arr.map(() => 0);
  const d = max - min;
  return arr.map((v) => (v - min) / d);
}
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function safeNum(v: unknown) { return Math.max(0, Number(v ?? 0)) || 0; }
