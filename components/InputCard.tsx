// components/InputCard.tsx
"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import type { AnalysisInput } from "./types";
import { useGeckoSearch, type TokenOption } from "@/hooks/useGeckoSearch";

export type SelectedMeta = {
  networkId?: string;
  symbol?: string;
  name?: string;
  imageUrl?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  reserveUsd?: number;
  volume24hUsd?: number;
  createdAt?: string | number;
  dex?: string;
  dexUrl?: string;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
};

export default function InputCard({
  onRun,
  onMetaUpdate,
  deepLinkUrl,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
  onMetaUpdate?: (meta: SelectedMeta | null) => void;
  deepLinkUrl?: string;
  className?: string;
}) {
  type Mode = "editing" | "frozen";
  const [mode, setMode] = useState<Mode>("editing");

  const [form, setForm] = useState<AnalysisInput>({
    projectName: "",
    website: "",
    xProfile: "",
    xCommunity: "",
    telegram: "",
    tokenAddress: "",
  });

  const [selectedMeta, setSelectedMeta] = useState<SelectedMeta | null>(null);

  const preferredChains = useMemo(() => ["solana", "ethereum"], []);
  const { query: hookQuery, setQuery: setHookQuery, results, loading, error } =
    useGeckoSearch({ preferredChains, debounceMs: 300, limit: 10 });

  const [localQuery, setLocalQuery] = useState(hookQuery ?? "");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (results?.length) {
      console.log("[GECKO] sample result", results[0]);
    }
  }, [results]);

  const canRun = useMemo(() => Boolean(form.tokenAddress?.trim()), [form.tokenAddress]);

  const applySelection = async (opt: TokenOption | null) => {
    if (!opt) return;
    const next: AnalysisInput = {
      ...form,
      projectName: opt.symbol || "",
      tokenAddress: opt.tokenAddress || "",
      website: "",
      xProfile: "",
      xCommunity: "",
      telegram: "",
    };
    setForm(next);
    setLocalQuery(`${opt.symbol} · ${shortAddr(opt.tokenAddress)}`);

    console.log("[GECKO] raw opt.createdAt =", (opt as any).createdAt, typeof (opt as any).createdAt);

    setSelectedMeta({
      networkId: opt.chain,
      symbol: opt.symbol,
      name: opt.name,
      imageUrl: opt.logo ?? undefined,
      priceUsd: opt.priceUsd ?? undefined,
      marketCapUsd: (opt as any).marketCap ?? (opt as any).fdv ?? undefined,
      reserveUsd: (opt as any).liquidity,
      volume24hUsd: (opt as any).vol24h,
      createdAt: normalizeCreatedAt((opt as any).createdAt),
      dex: opt.dex ?? undefined,
    });
    onMetaUpdate?.({
      symbol: opt.symbol,
      marketCapUsd: (opt as any).marketCap ?? (opt as any).fdv ?? undefined,
      volume24hUsd: (opt as any).vol24h,
      createdAt: normalizeCreatedAt((opt as any).createdAt),
    });

    onRun(next);
    setMode("frozen");

    try {
      const qs = new URLSearchParams({ chain: opt.chain, address: opt.tokenAddress || "" });
      const r = await fetch(`/api/dexscreener/info?${qs.toString()}`);
    if (r.ok) {
      const data = await r.json();
      console.log("[DEXSCR] info.createdAt =", data?.createdAt, typeof data?.createdAt);

      const bestPairCreated = pickBestPairCreatedAt(data);
      if (bestPairCreated != null) {
        console.log("[DEXSCR] bestPairCreated =", bestPairCreated);
      }

      setSelectedMeta((prev) => {
        const fixedTop  = normalizeCreatedAt(data?.createdAt, { allowFutureDays: 3 });
        const fixedPair = normalizeCreatedAt(bestPairCreated, { allowFutureDays: 3 });

        const nextCreated = fixedTop || fixedPair || prev?.createdAt;

        return {
          ...(prev || {}),
          dexUrl:
            data?.dexUrl ||
            (opt.chain && opt.tokenAddress
              ? `https://dexscreener.com/${opt.chain}/${opt.tokenAddress}`
              : undefined),
          twitter: data?.twitter ?? null,
          telegram: data?.telegram ?? null,
          website: data?.website ?? null,
          createdAt: nextCreated,
        };
       });
       onMetaUpdate?.({
        marketCapUsd: (opt as any).marketCap ?? (opt as any).fdv ?? undefined,
        volume24hUsd: (opt as any).vol24h,
        createdAt: normalizeCreatedAt(data?.createdAt) ?? normalizeCreatedAt(bestPairCreated),
      });
     } else {
      }
    } catch {
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const len = results?.length ?? 0;
    if (len === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, len - 1));
      scrollToIdx(Math.min(activeIdx + 1, len - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      scrollToIdx(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      applySelection(results?.[activeIdx] ?? null);
    }
  };

  const scrollToIdx = (idx: number) => {
    const el = listRef.current?.querySelectorAll('[role="option"]')?.[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className={`p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 ${className}`}>
      {mode === "editing" ? (
        <div className="relative">
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="Search token or address (e.g. popcat / 0x... / 9n4...)"
            value={localQuery}
            onChange={(e) => {
              const v = e.target.value;
              setLocalQuery(v);
              setActiveIdx(0);
              setHookQuery(v);
              if (!v.trim()) {
                setForm((f) => ({ ...f, projectName: "", tokenAddress: "" }));
                setSelectedMeta(null);
              }
            }}
            onKeyDown={onKeyDown}
            aria-expanded={(results?.length ?? 0) > 0}
            aria-controls="token-suggest-listbox"
            role="combobox"
            autoFocus
          />

          {(loading || error || (results?.length ?? 0) > 0) && (
            <div
              ref={listRef}
              id="token-suggest-listbox"
              role="listbox"
              className="absolute z-20 mt-1 w-full max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-[#0c1111]/95 backdrop-blur-xl shadow-2xl"
            >
              {loading && <div className="px-3 py-2 text-xs text-gray-400">Loading…</div>}
              {error && !loading && <div className="px-3 py-2 text-xs text-red-400">Error: {error}</div>}
              {!loading && !error && (results?.length ?? 0) === 0 && localQuery.trim() && (
                <div className="px-3 py-2 text-xs text-gray-400">No results. Try pasting a contract address.</div>
              )}
              {!loading && !error &&
                (results ?? []).map((it, i) => (
                  <ResultCard
                    key={`${it.chain}:${it.tokenAddress || it.baseTokenId}`}
                    active={i === activeIdx}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => applySelection(it)}
                    networkId={it.chain}
                    symbol={it.symbol}
                    name={it.name}
                    imageUrl={it.logo ?? undefined}
                    tokenAddress={it.tokenAddress ?? ""}
                    dex={it.dex ?? undefined}
                    priceUsd={it.priceUsd ?? undefined}
                    marketCapUsd={(it as any).marketCap ?? (it as any).fdv ?? undefined}
                    reserveUsd={(it as any).liquidity}
                    volume24hUsd={(it as any).vol24h}
                    createdAt={(it as any).createdAt ?? undefined}
                  />
                ))}
            </div>
          )}
        </div>
      ) : (
        /* ====== FROZEN: display-only token selection ====== */
        <FrozenView
          projectName={form.projectName}
          tokenAddress={form.tokenAddress}
          frozenText={localQuery || `${form.projectName} · ${shortAddr(form.tokenAddress)}`}
          onChange={() => setMode("editing")}
          meta={selectedMeta || undefined}
        />
      )}
      {/* */}
    </div>
  );
}

/* ----------------- Frozen (display) view ----------------- */
function FrozenView({
  projectName,
  tokenAddress,
  frozenText,
  onChange,
  meta,
}: {
  projectName?: string;
  tokenAddress?: string;
  frozenText?: string;
  onChange?: () => void;
  meta?: {
    networkId?: string;
    symbol?: string;
    name?: string;
    imageUrl?: string;
    priceUsd?: number;
    marketCapUsd?: number;
    reserveUsd?: number;
    volume24hUsd?: number;
    createdAt?: string | number;
    dex?: string;
    dexUrl?: string;
    twitter?: string | null;
    telegram?: string | null;
    website?: string | null;
  };
}) {
  const dexUrl =
    meta?.dexUrl ||
    (meta?.networkId && tokenAddress
      ? `https://dexscreener.com/${meta.networkId}/${tokenAddress}`
      : tokenAddress
      ? `https://dexscreener.com/search?q=${encodeURIComponent(tokenAddress)}`
      : undefined);

  const socialsFallback = tokenAddress
    ? `https://dexscreener.com/search?q=${encodeURIComponent(tokenAddress)}`
    : undefined;

  const btn = (href?: string | null, label?: string, extraClass = "") =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`px-2.5 py-1.5 rounded-md border border-white/10 bg-white/10 hover:bg-white/15 text-[12px] font-medium text-gray-100 ${extraClass}`}
      >
        {label}
      </a>
    ) : null;

  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="relative h-8 w-8 rounded-full overflow-hidden bg-white/10 shrink-0">
            {meta?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.imageUrl} alt={meta.symbol || projectName || "token"} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-300">
                {(meta?.symbol || projectName || "?").slice(0, 2)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm text-white truncate">{projectName || "-"}</div>
            <div className="text-[11px] text-gray-400 truncate">
              {frozenText || shortAddr(tokenAddress)}
            </div>
          </div>
        </div>

        <div className="ml-3 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onChange}
            className="px-2.5 py-1.5 rounded-md border border-white/10 bg-white/10 hover:bg-white/15 text-xs font-medium text-gray-100"
            title="Change token"
          >
            Change
          </button>
        </div>
      </div>

      {/* 统计 chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {chip("Price", typeof meta?.priceUsd === "number" ? `$${meta?.priceUsd.toFixed(6)}` : "-")}
        {chip("MktCap", moneyShort(meta?.marketCapUsd))}
        {chip("24H Vol", moneyShort(meta?.volume24hUsd))}
        {chip("Liq", moneyShort(meta?.reserveUsd))}
        {chip("Age", ageText(meta?.createdAt))}
        {chip("DEX", meta?.dex || "-")}
      </div>

      {/* 外链按钮：真实 socials，没数据再兜底 */}
      <div className="mt-2 flex flex-wrap gap-2">
        {btn(dexUrl, "View on Dexscreener", "border-emerald-400/20 bg-emerald-400/10 hover:bg-emerald-400/15 text-emerald-200")}
        {btn(meta?.twitter, "Twitter")}
        {btn(meta?.telegram, "Telegram")}
        {btn(meta?.website, "Website")}
        {!meta?.twitter && !meta?.telegram && !meta?.website && socialsFallback && (
          <a
            href={socialsFallback}
            target="_blank"
            rel="noreferrer"
            className="px-2.5 py-1.5 rounded-md border border-indigo-400/20 bg-indigo-400/10 hover:bg-indigo-400/15 text-[12px] font-medium text-indigo-200"
            title="Open socials panel on Dexscreener (via search)"
          >
            Socials (Dexscreener)
          </a>
        )}
      </div>
    </div>
  );
}

/* ----------------- Result Card (dropdown row) ----------------- */
type ResultCardProps = {
  networkId: string;
  symbol: string;
  name?: string;
  imageUrl?: string;
  tokenAddress: string;
  dex?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  reserveUsd?: number;
  volume24hUsd?: number;
  createdAt?: string | number;
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
};

function ResultCard({
  networkId,
  symbol,
  name,
  imageUrl,
  tokenAddress,
  dex,
  priceUsd,
  marketCapUsd,
  reserveUsd,
  volume24hUsd,
  createdAt,
  active = false,
  onClick,
  onMouseEnter,
}: ResultCardProps) {
  const age = React.useMemo(() => ageText(createdAt), [createdAt]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full text-left px-3 py-2 border-b border-white/5 last:border-0 transition rounded-lg ${active ? "bg-white/10" : "hover:bg-white/5"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-7 w-7 rounded-full overflow-hidden bg-white/10 shrink-0">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={symbol} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-300">
                {symbol?.slice(0, 2) || "?"}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-white/90 truncate">
              <span className="font-semibold">{symbol || "-"}</span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-white/10 bg-white/10 text-[10px] uppercase tracking-wide">
                {networkId}
              </span>
            </div>
            <div className="text-xs text-gray-400 truncate">{name || "-"}</div>
          </div>
        </div>

        <div className="text-right text-xs text-gray-300 shrink-0">
          <div>{typeof priceUsd === "number" ? `$${priceUsd.toFixed(6)}` : "-"}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chip("MktCap", moneyShort(marketCapUsd))}
        {chip("Liq", moneyShort(reserveUsd))}
        {chip("24H Vol", moneyShort(volume24hUsd))}
        {chip("Age", age)}
        {chip("DEX", dex || "-")}
      </div>

      <div className="mt-1 text-[11px] text-gray-500 truncate">
        TOKEN: {shortAddr(tokenAddress)}
      </div>
    </button>
  );
}

/* ----------------- helpers ----------------- */

// ---- unify createdAt no matter seconds/milliseconds/ISO ----
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


function shortAddr(addr?: string) {
  if (!addr) return "-";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function moneyShort(v?: number) {
  if (typeof v !== "number" || !isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

function ageText(createdAt?: string | number) {
  const iso = normalizeCreatedAt(createdAt);
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

// chip 小徽章
function chip(label: string, value?: React.ReactNode) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.06] text-[11px] text-gray-300">
      <span className="text-gray-400">{label}:</span>
      <span className="text-gray-200">{value ?? "-"}</span>
    </span>
  );
}

// 从 Dexscreener info.pairs 里挑“最合理”的创建时间（优先报价币 + 最大流动性）
function pickBestPairCreatedAt(info: any): number | string | undefined {
  const ps = Array.isArray(info?.pairs) ? info.pairs : [];
  if (!ps.length) return undefined;

  const preferredQuotes = new Set(["SOL", "WETH", "ETH", "USDC", "USDT"]);

  const scored = ps
    .map((p: any) => {
      const liq =
        p?.liquidity?.usd ??
        p?.liquidityUSD ??
        p?.reserveUsd ??
        p?.liquidity ??
        0;
      const quoteSym = p?.quoteToken?.symbol?.toUpperCase?.();
      const isPref = quoteSym ? preferredQuotes.has(quoteSym) : false;

      const created = p?.pairCreatedAt ?? p?.createdAtMs ?? p?.createdAt;
      return { liq: Number(liq) || 0, isPref, created };
    })
    .filter((x: any) => x.created != null);

  if (!scored.length) return undefined;

  scored.sort((a: any, b: any) => {
    if (a.isPref !== b.isPref) return a.isPref ? -1 : 1;
    return b.liq - a.liq;
  });

  return scored[0].created;
}
