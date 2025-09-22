// components/dashboard/TopTokensByMentions.tsx
"use client";

/**
 * Top Coins with token preview popup
 * - Row: rank + $TICKER + copy CA + score
 * - Popup: metrics + token preview (image / price / mcap / 24h vol / liq / socials) + top KOLs
 */

import * as React from "react";
import { Copy, CircleHelp, Coins, Link as LinkIcon } from "lucide-react";
import clsx from "clsx";
import {
  TickerPill,
  rankEmoji,
  fmtCompact,
  fmtPct,
  HandlePill,
  AvatarCircle,
} from "./LeaderboardBits";

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

export default function TopTokensByMentions({
  rows,
  days,
  title = "Top Coins",
}: Props) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [previews, setPreviews] = React.useState<Record<string, TokenPreview>>(
    {}
  );
  const inflightRef = React.useRef<Record<string, boolean>>({});
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

  const toggleRow = (id: string) =>
    setOpenId((prev) => (prev === id ? null : id));

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

  const maybeLoadPreview = React.useCallback(
    async (id: string, r: TopCoinRow) => {
      if (!r?.contractAddress) return;
      if (previews[id]?.data || inflightRef.current[id]) return;
      inflightRef.current[id] = true;
      setPreviews((m) =>
        m[id]?.loading ? m : { ...m, [id]: { loading: true } }
      );
      const data = await fetchPreview(r).catch(() => null);
      setPreviews((m) => ({
        ...m,
        [id]: { loading: false, data: data ?? undefined },
      }));
      inflightRef.current[id] = false;
    },
    [previews]
  );

  const top10 = (rows ?? []).slice(0, 10);

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
            <div className="font-medium mb-1 text-white/90">
              How the score is calculated
            </div>
            <div className="text-white/80">
              <p className="mb-1">
                We combine five signals over the selected window (7d/30d):
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><span className="font-medium">Mentions</span>: number of posts that mention the token.</li>
                <li><span className="font-medium">Shillers</span>: unique accounts posting about it.</li>
                <li><span className="font-medium">Views</span>: total post impressions.</li>
                <li><span className="font-medium">Engagements</span>: likes + replies + quotes.</li>
                <li><span className="font-medium">Velocity</span>: last 24h mentions ÷ average daily mentions in the rest of the window.</li>
              </ul>
              <p className="mt-1 text-white/70">
                Each metric is min–max normalized and weighted. Score ranges 0–1 (higher = hotter).
              </p>
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

            const cleanTicker = (r.tokenDisplay || r.tokenKey || "")
              .replace(/^\$+/, "")
              .toUpperCase();
            const chipText = `$${cleanTicker}`;
            const pv = previews[rowId];

            return (
              <li key={rowId} className="relative">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={pinned}
                  onClick={() => {
                    toggleRow(rowId);
                    if (!pinned) maybeLoadPreview(rowId, r);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      toggleRow(rowId);
                      if (!pinned) maybeLoadPreview(rowId, r);
                    }
                  }}
                  className={clsx(
                    "group/row flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30",
                    "transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5",
                    "hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-8 text-center">{rankEmoji(idx)}</span>
                    <TickerPill text={chipText} title={`$${cleanTicker}`} />
                    {hasCA ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
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
                        <span
                          className={clsx(
                            "pointer-events-none absolute -top-2 -right-1 select-none rounded-full px-1.5 py-0.5",
                            "text-[10px] font-medium",
                            "bg-emerald-500/95 text-black border border-emerald-300/80 shadow",
                            "transition-all",
                            copied
                              ? "opacity-100 translate-y-0"
                              : "opacity-0 -translate-y-1"
                          )}
                          aria-hidden
                        >
                          Copied!
                        </span>
                      </button>
                    ) : null}
                  </div>

                  <div className="tabular-nums text-xs md:text-sm font-semibold text-white/90">
                    score {r.score.toFixed(2)}
                  </div>
                </div>

                {/* popup */}
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
                    onMouseEnter={() => maybeLoadPreview(rowId, r)}
                    onFocus={() => maybeLoadPreview(rowId, r)}
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
                      loading={pv?.loading}
                      data={pv?.data}
                      ticker={cleanTicker}
                      contractAddress={r.contractAddress ?? undefined}
                    />

                    {/* metrics (moved below token preview) */}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Metric label="Mentions" value={fmtCompact(r.mentions)} />
                      <Metric label="Shillers" value={fmtCompact(r.shillers)} />
                      <Metric label="Views" value={fmtCompact(r.views)} />
                      <Metric label="Engs" value={fmtCompact(r.engs)} />
                      <Metric label="ER" value={fmtPct(r.er)} />
                      <Metric label="Velocity" value={r.velocity?.toFixed(2)} />
                    </div>

                    {Array.isArray(r.topKols) && r.topKols.length > 0 ? (
                      <div className="relative mt-3">
                        <div className="text-[11px] text-gray-400 mb-1">
                          Top KOLs by this coin’s views
                        </div>
                        <ul className="space-y-1">
                          {r.topKols.slice(0, 10).map((k, i) => (
                            <li
                              key={k.handle}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <AvatarCircle
                                  src={k.avatarUrl ?? undefined}
                                  sizePx={24}
                                />
                                <span className="w-6 text-center text-[13px]">
                                  {rankEmoji(i)}
                                </span>
                                <HandlePill
                                  handle={k.handle}
                                  href={`https://x.com/${k.handle}`}
                                  className="px-2 py-0.5"
                                />
                                {typeof k.followers === "number" ? (
                                  <span className="text-[11px] text-gray-400 tabular-nums">
                                    · {fmtCompact(k.followers)} followers
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-[11px] text-gray-300 tabular-nums">
                                {fmtCompact(k.views)} views
                              </span>
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
      <div className="mt-0.5 tabular-nums text-sm font-semibold text-white/90">
        {value}
      </div>
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
}: {
  loading?: boolean;
  data?: TokenPreviewData;
  ticker: string;
  contractAddress?: string;
}) {
  const imageUrl = data?.imageUrl ?? null;
  const price = data?.priceUsd ?? null;
  const mcap = data?.marketCapUsd ?? null;
  const vol = data?.volume24hUsd ?? null;
  const liq = data?.reserveUsd ?? null;
  const dex = data?.dex ?? null;
  const dexUrl =
    data?.dexUrl ??
    (contractAddress
      ? `https://dexscreener.com/search?q=${encodeURIComponent(
          contractAddress
        )}`
      : null);
  const website = data?.website ?? null;
  const twitter = data?.twitter ?? null;
  const telegram = data?.telegram ?? null;
  const created = data?.createdAt;

  return (
    <div className="relative mt-3 rounded-xl border border-white/10 bg-white/[0.06] p-3">
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 overflow-hidden rounded-full bg-white/10 shrink-0">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={ticker}
              className="h-full w-full object-cover"
              loading="lazy"
            />
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
          <div className="text-xs text-gray-400 truncate">
            TOKEN: {shortAddr(contractAddress)}
          </div>
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
            <a
              href={dexUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:opacity-90"
            >
              {dex || "Dexscreener"}
            </a>
          ) : (
            dex || "-"
          )
        )}
      </div>

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

      {loading && (
        <div className="mt-2 text-[11px] text-gray-400">Loading token info…</div>
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

// choose best createdAt from pairs
function pickBestPairCreatedAt(info: any): number | string | undefined {
  const ps = Array.isArray(info?.pairs) ? info.pairs : [];
  if (!ps.length) return undefined;

  const preferred = new Set(["SOL", "WETH", "ETH", "USDC", "USDT"]);

  type PairScore = {
    liq: number;
    pref: boolean;
    created: number | string;
  };

  const scored: PairScore[] = ps
    .map((p: any) => {
      const liq =
        p?.liquidity?.usd ??
        p?.liquidityUSD ??
        p?.reserveUsd ??
        p?.liquidity ??
        0;
      const quote = p?.quoteToken?.symbol?.toUpperCase?.();
      const created = p?.pairCreatedAt ?? p?.createdAtMs ?? p?.createdAt;
      return {
        liq: Number(liq) || 0,
        pref: quote ? preferred.has(quote) : false,
        created,
      } as PairScore;
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

    const createdBest = pickBestPairCreatedAt(dexInfo);
    const created =
      normalizeCreatedAt(dexInfo?.createdAt, { allowFutureDays: 3 }) ||
      normalizeCreatedAt(createdBest, { allowFutureDays: 3 }) ||
      undefined;

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
