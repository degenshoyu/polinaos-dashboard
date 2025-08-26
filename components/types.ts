// components/types.ts
// Shared types used by both left & right panes

import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

export type AnalysisInput = {
  projectName?: string;
  website?: string;
  xProfile?: string;
  xCommunity?: string;
  telegram?: string;
  tokenAddress?: string;
};

export type AnalysisResult = {
  summary: string;
  emotions?: EmotionalLandscape | null;
  emotionsInsight?: string | null;
};
