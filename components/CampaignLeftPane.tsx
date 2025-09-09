// components/CampaignLeftPane.tsx
"use client";

import { useState } from "react";
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
  return (
    <div className={`flex flex-col gap-6 w-full ${className}`}>
      {/* === Search card === */}
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Search
          </h2>
          {deepLinkUrl ? <ShareDropdown url={deepLinkUrl} ticker={ticker} /> : null}
        </div>

        <InputCard
          onRun={onRun}
          deepLinkUrl={deepLinkUrl}
          onMetaUpdate={onMetaUpdate}
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
 * Share Dropdown
 * ───────────────────────────── */
function ShareDropdown({ url, ticker }: { url: string; ticker?: string | null }) {
  const [copied, setCopied] = useState(false);

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
    const text = `Check out this CT analysis on ${ticker ?? ""} by @PolinaAIOS 👉 ${url}`;
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const onEmbed = () => {
    const code = `<iframe src="${url}" width="600" height="400"></iframe>`;
    navigator.clipboard.writeText(code).catch(() => {
      window.prompt("Copy embed code:", code);
    });
    alert("Embed code copied!");
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
        <DropdownMenuItem onClick={onShareX}>Share to X</DropdownMenuItem>
        <DropdownMenuItem onClick={onEmbed}>Embed Code</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
