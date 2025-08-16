// app/dashboard/campaign/analysis/page.tsx
"use client";

import { useState } from "react";
import CampaignLeftPane from "@/components/CampaignLeftPane";
import AnalysisConsole from "@/components/AnalysisConsole";
import type { AnalysisInput } from "@/components/types";

export default function AnalysisPage() {
  const [summary, setSummary] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<AnalysisInput | null>(null);

  return (
    // NOTE: dashboard/layout.tsx already provides max-width container + padding
    // so we keep this simple and just render the grid here.
    <div className="grid grid-cols-12 gap-6 items-start">
      {/* Left column: CampaignLeftPane (Input + AI Understanding) */}
      <div className="col-span-12 md:col-span-6">
        <CampaignLeftPane
          aiSummary={summary}
          onRun={(input) => {
            setSummary(null);
            setLastInput(input);
          }}
        />
      </div>

      {/* Right column: Analysis Console (sticky on md+) */}
      <div className="col-span-12 md:col-span-6 md:sticky md:top-20 self-start">
        {/* md:top-20 ~ 80px, adjust if your navbar height differs */}
        <AnalysisConsole
          inputs={lastInput}
          onAnalysisResult={(res) => setSummary(res.summary)}
        />
      </div>
    </div>
  );
}
