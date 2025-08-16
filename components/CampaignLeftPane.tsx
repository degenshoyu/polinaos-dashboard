"use client";

import type { AnalysisInput } from "./types";
import { InputCard } from "./InputCard";
import { AiUnderstanding } from "./AiUnderstanding";

export default function CampaignLeftPane({
  onRun,
  aiSummary,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
  aiSummary?: string | null;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-6 w-full ${className}`}>
      <InputCard onRun={onRun} />
      <AiUnderstanding aiSummary={aiSummary} />
    </div>
  );
}
