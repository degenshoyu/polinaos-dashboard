// components/InputCard.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import type { AnalysisInput } from "./types";
import { useGeckoSearch, type TokenOption } from "@/hooks/useGeckoSearch";

export default function InputCard({
  onRun,
  deepLinkUrl,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
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

  const preferredChains = useMemo(() => ["solana", "ethereum"], []);
  const { query: hookQuery, setQuery: setHookQuery, results, loading, error } =
    useGeckoSearch({ preferredChains, debounceMs: 300, limit: 10 });

  const [localQuery, setLocalQuery] = useState(hookQuery ?? "");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const canRun = useMemo(() => Boolean(form.tokenAddress?.trim()), [form.tokenAddress]);

  const applySelection = (opt: TokenOption | null) => {
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
    onRun(next);
    setMode("frozen");
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
      <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Campaign · Input
      </h2>

      {mode === "editing" ? (
        <div className="relative">
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="Search token or address (e.g. moodeng / 0x... / 9n4...)"
            value={localQuery}
            onChange={(e) => {
              const v = e.target.value;
              setLocalQuery(v);
              setActiveIdx(0);
              setHookQuery(v);
              if (!v.trim()) setForm((f) => ({ ...f, projectName: "", tokenAddress: "" }));
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
                    tokenAddress={it.tokenAddress}
                    dex={it.dex ?? undefined}
                    priceUsd={it.priceUsd ?? undefined}
                    marketCapUsd={it.marketCap ?? it.fdv ?? undefined}
                    reserveUsd={it.liquidity}
                    volume24hUsd={it.vol24h}
                    createdAt={undefined}
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
          deepLinkUrl={deepLinkUrl}
          onChange={() => setMode("editing")}
        />
      )}

      {/* Read-only summary */}
      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <div className="truncate">
          <span className="text-gray-400">Project: </span>
          <span className="text-gray-200">{form.projectName || "-"}</span>
        </div>
        <div className="truncate">
          <span className="text-gray-400">Token: </span>
          <span className="text-gray-200">{form.tokenAddress || "-"}</span>
        </div>
        {!canRun && <div className="text-[11px] text-amber-400/80">Tip: Select a token from the list to start analysis automatically.</div>}
      </div>
    </div>
  );
}

/* ----------------- Frozen (display) view ----------------- */
function FrozenView({
  projectName,
  tokenAddress,
  frozenText,
  deepLinkUrl,
  onChange,
}: {
  projectName?: string;
  tokenAddress?: string;
  frozenText?: string;
  deepLinkUrl?: string;
  onChange?: () => void;
}) {
  const copy = async () => {
    try {
      if (!deepLinkUrl) return;
      await navigator.clipboard.writeText(deepLinkUrl);
    } catch {
      window.prompt("Copy this link:", deepLinkUrl || "");
    }
  };

  return (
    <div className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm text-white truncate">{projectName || "-"}</div>
        <div className="text-[11px] text-gray-400 truncate">
          {frozenText || shortAddr(tokenAddress)}
        </div>
      </div>

      <div className="ml-3 flex items-center gap-2">
        {deepLinkUrl && (
          <button
            type="button"
            onClick={copy}
            className="px-2.5 py-1.5 rounded-md border border-white/10 bg-white/10 hover:bg-white/15 text-xs font-medium text-emerald-300"
            title="Copy sharable link"
            aria-label="Copy sharable link"
          >
            Copy link
          </button>
        )}
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
  createdAt?: string;
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
  const age = React.useMemo(() => {
    if (!createdAt) return "-";
    const t = new Date(createdAt).getTime();
    if (Number.isNaN(t)) return "-";
    const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
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

  const short = (addr?: string) => (!addr ? "-" : addr.length <= 14 ? addr : `${addr.slice(0, 8)}…${addr.slice(-6)}`);

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
        TOKEN: {short(tokenAddress)}
      </div>
    </button>
  );
}

/* ----------------- helpers ----------------- */
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
