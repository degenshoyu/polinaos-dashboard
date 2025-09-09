// components/CampaignLeftPane.tsx
"use client";

import { useState, useEffect } from "react";
import { AiUnderstanding } from "@/components/AiUnderstanding";
import InputCard from "@/components/InputCard";
import type { AnalysisInput } from "@/components/types";
import EmotionalLandscapeCard from "@/components/EmotionalLandscapeCard";
import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";
import CommitmentIndex from "@/components/CommitmentIndex";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Share2 } from "lucide-react";

export default function CampaignLeftPane({
  onRun,
  onMetaUpdate,
  aiSummary,
  emotions,
  emotionsInsight,
  deepLinkUrl,
  ticker,
  contractAddress,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
  onMetaUpdate?: (meta: {
    marketCapUsd?: number;
    volume24hUsd?: number;
    createdAt?: string | number;
  } | null) => void;
  aiSummary?: string | null;
  emotions?: EmotionalLandscape | null;
  emotionsInsight?: string | null;
  deepLinkUrl?: string;
  ticker?: string | null;
  contractAddress?: string | null;
  className?: string;
}) {
  const [localTicker, setLocalTicker] = useState<string | null>(ticker ?? null);

  return (
    <div className={`flex flex-col gap-6 w-full ${className}`}>
      {/* === Search card === */}
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Search
          </h2>
          {deepLinkUrl ? <ShareDropdown url={deepLinkUrl} ticker={localTicker ?? ticker ?? null} /> : null}
        </div>

        <InputCard
          onRun={onRun}
          deepLinkUrl={deepLinkUrl}
          onMetaUpdate={(meta) => {
          if (meta?.symbol) setLocalTicker(meta.symbol);
          onMetaUpdate?.(meta);
          }}
        />
      </div>

      <AiUnderstanding aiSummary={aiSummary} />

      {emotions ? (
        <div className="p-0">
          <EmotionalLandscapeCard
            data={emotions}
            insight={emotionsInsight ?? undefined}
            ticker={ticker}
            contractAddress={contractAddress}
          />
        </div>
      ) : null}

      {/* Commitment Index */}
      <CommitmentIndex
        deepLinkUrl={deepLinkUrl}
        ticker={ticker}
        contractAddress={contractAddress}
      />
    </div>
  );
}

/* ─────────────────────────────
 * Share Dropdown (robust ticker)
 * ───────────────────────────── */
function ShareDropdown({ url, ticker }: { url: string; ticker?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [localTicker, setLocalTicker] = useState<string | null>(null);

  const parseTickerFromUrl = (u?: string) => {
    try {
      if (!u) return null;
      const usp = new URL(u, typeof window !== "undefined" ? window.location.origin : "https://example.com").searchParams;
      return usp.get("ticker") || usp.get("symbol") || usp.get("t");
    } catch {
      return null;
    }
  };

  const normalizeTicker = (t?: string | null) => {
    if (!t) return null;
    const v = t.trim();
    if (!v) return null;
    const up = v.toUpperCase();
    return up.startsWith("$") ? up : `$${up}`;
  };

  useEffect(() => {
    const pref = normalizeTicker(ticker);
    if (pref) {
      setLocalTicker(pref);
    } else {
      setLocalTicker(normalizeTicker(parseTickerFromUrl(url)));
    }
  }, [ticker, url]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const onShareX = () => {
    const text = localTicker
      ? `Check out this CT analysis on ${localTicker} by @PolinaAIOS 👉 ${url}`
      : `Check out this CT analysis by @PolinaAIOS 👉 ${url}`;
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const onEmbed = async () => {
    const code = `<iframe src="${url}" style="width:100%;height:600px;border:0;border-radius:12px;" loading="lazy" allowfullscreen></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1500);
    } catch {
      window.prompt("Copy embed code:", code);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-emerald-400/20
                     bg-emerald-400/10 hover:bg-emerald-400/15 text-[12px] font-medium text-emerald-200"
        >
          <Share2 size={14} />
          <span>Share</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onCopy}>
          {copied ? "Copied ✓" : "Copy Link"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onShareX}>
          {localTicker ? `Share to X` : "Share to X"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEmbed}>
          {copiedEmbed ? "Embed copied ✓" : "Embed Code"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
