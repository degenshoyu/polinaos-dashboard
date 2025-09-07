"use client";

import { useState } from "react";
import AnalysisConsole from "@/components/AnalysisConsole";
import StatisticSummary from "@/components/StatisticSummary";
import type { AnalysisInput } from "@/components/types";
import type { AnalysisResult } from "@/components/types";

/**
 * Right pane wrapper that stacks AnalysisConsole and StatisticSummary.
 * It listens to jobId from AnalysisConsole via onJobIdChange and passes it to StatisticSummary.
 */
export default function CampaignRightPane({
  inputs,
  meta,
  onAnalysisResult,
  onJobIdChange,
  className = "",
}: {
  inputs?: AnalysisInput | null;
  meta?: {
    marketCapUsd?: number;
    volume24hUsd?: number;
    createdAt?: string | number;
  };
  onAnalysisResult?: (res: AnalysisResult) => void;
  onJobIdChange?: (id: string | null) => void;
  className?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const handleJobId = (id: string | null) => {
    setJobId(id);
    onJobIdChange?.(id);
  };

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      <AnalysisConsole
        inputs={inputs}
        onAnalysisResult={onAnalysisResult}
        onJobIdChange={handleJobId}
      />

      {/* Statistic Summary card will visualize the tweets of the latest job */}
      <StatisticSummary
        jobId={jobId}
        marketCapUsd={meta?.marketCapUsd}
        volume24hUsd={meta?.volume24hUsd}
        createdAt={meta?.createdAt}
      />
    </div>
  );
}
