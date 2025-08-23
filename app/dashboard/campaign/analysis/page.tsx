// app/dashboard/campaign/analysis/page.tsx
"use client";

import { useEffect, useState } from "react";
import CampaignLeftPane from "@/components/CampaignLeftPane";
import CampaignRightPane from "@/components/CampaignRightPane";
import type { AnalysisInput } from "@/components/types";

export default function AnalysisPage() {
  const [summary, setSummary] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<AnalysisInput | null>(null);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | undefined>(undefined);

  async function handleJobIdChange(jobId: string | null) {
    if (!jobId) {
      setDeepLinkUrl(undefined);
      return;
    }
  const base = window.location.origin;
  setDeepLinkUrl(`${base}/dashboard/campaign/analysis?job=${encodeURIComponent(jobId)}`);
  }

  return (
    <div className="grid grid-cols-12 gap-6 items-start">
      {/* Left column: Input + AI Understanding */}
      <div className="col-span-12 md:col-span-6">
        <CampaignLeftPane
          aiSummary={summary}
          deepLinkUrl={deepLinkUrl}
          onRun={(input) => {
            setSummary(null);
            setLastInput(input);
          }}
        />
      </div>

      {/* Right column: Console + StatisticSummary (sticky on md+) */}
      <div className="col-span-12 md:col-span-6 md:sticky md:top-20 self-start">
        <CampaignRightPane
          inputs={lastInput}
          onAnalysisResult={(res) => setSummary(res.summary)}
          onJobIdChange={handleJobIdChange}
        />
      </div>
    </div>
  );
}
