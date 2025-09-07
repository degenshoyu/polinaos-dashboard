// components/CampaignLeftPane.tsx
"use client";

import { useState } from "react";
import { AiUnderstanding } from "@/components/AiUnderstanding";
import InputCard from "@/components/InputCard";
import type { AnalysisInput } from "@/components/types";
import EmotionalLandscapeCard from "@/components/EmotionalLandscapeCard";
import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";
import type { AnalysisResult } from "@/components/types";
import CommitmentIndex from "@/components/CommitmentIndex";

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
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Search
          </h2>
          {deepLinkUrl ? <CopyLinkButton url={deepLinkUrl} /> : null}
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
      ) : (
        <EmptyEmotionsCard
          deepLinkUrl={deepLinkUrl}
          ticker={ticker}
          contractAddress={contractAddress}
        />
      )}

      {/* Commitment Index  */}
      <CommitmentIndex
        deepLinkUrl={deepLinkUrl}
        ticker={ticker}
        contractAddress={contractAddress}
      />
    </div>
  );
}

function EmptyEmotionsCard({
  deepLinkUrl,
  ticker,
  contractAddress,
}: {
  deepLinkUrl?: string;
  ticker?: string | null;
  contractAddress?: string | null;
}) {
  return (
    <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
          Emotional Landscape
        </h2>
      </div>
      <p className="text-sm text-gray-500">
        Waiting for AI analysis… it appears here once tweets are collected.
      </p>
      {(ticker || contractAddress || deepLinkUrl) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {ticker && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Ticker</span>
              <span className="px-2 py-0.5 text-sm rounded-md border border-white/10 bg-white/10 text-emerald-200 font-mono">
                {ticker}
              </span>
            </div>
          )}
          {contractAddress && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Contract</span>
                <span className="px-2 py-0.5 text-xs md:text-[13px] rounded-md border border-white/10 bg-white/10 text-emerald-200 font-mono break-all">
                  {shortenAddress(contractAddress)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function shortenAddress(addr?: string, head = 6, tail = 6): string {
  if (!addr) return "";
  const len = addr.length;
  if (len <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title={url}
      className="px-2.5 py-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 hover:bg-emerald-400/15 text-[12px] font-medium text-emerald-200"
      aria-label="Copy sharable link"
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}
