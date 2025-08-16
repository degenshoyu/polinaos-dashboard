"use client";

import { useState } from "react";
import AnalysisConsole from "@/components/AnalysisConsole";
import StatisticSummary from "@/components/StatisticSummary";
import type { AnalysisInput } from "@/components/types";

/**
 * Right pane wrapper that stacks AnalysisConsole and StatisticSummary.
 * It listens to jobId from AnalysisConsole via onJobIdChange and passes it to StatisticSummary.
 */
export default function CampaignRightPane({
  inputs,
  onAnalysisResult,
  className = "",
}: {
  inputs?: AnalysisInput | null;
  onAnalysisResult?: (res: { summary: string }) => void;
  className?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(null);

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      <AnalysisConsole
        inputs={inputs}
        onAnalysisResult={onAnalysisResult}
        onJobIdChange={setJobId} // <-- new bridge for StatisticSummary
      />

      {/* Statistic Summary card will visualize the tweets of the latest job */}
      <StatisticSummary jobId={jobId} />
    </div>
  );
}

