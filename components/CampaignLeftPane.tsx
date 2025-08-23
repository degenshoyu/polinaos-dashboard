// components/CampaignLeftPane.tsx
"use client";

import { useState } from "react";
import { AiUnderstanding } from "@/components/AiUnderstanding";
import InputCard from "@/components/InputCard";
import type { AnalysisInput } from "@/components/types";

export default function CampaignLeftPane({
  onRun,
  aiSummary,
  deepLinkUrl,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
  aiSummary?: string | null;
  deepLinkUrl?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-6 w-full ${className}`}>
      {/* === Card 1: Campaign · Input === */}
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Campaign · Input
          </h2>
          {deepLinkUrl ? <CopyLinkButton url={deepLinkUrl} /> : null}
        </div>

        <InputCard onRun={onRun} deepLinkUrl={deepLinkUrl} />
      </div>

      <AiUnderstanding aiSummary={aiSummary} />
    </div>
  );
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
