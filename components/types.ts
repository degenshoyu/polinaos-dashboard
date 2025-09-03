// components/types.ts
// Shared types used by both left & right panes

import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

/** ===== EmotionalLandscape ===== */

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

/** ===== KOL Admin ===== */

export type KolRow = {
  twitterUid: string | null;
  twitterUsername: string;
  displayName?: string | null;
  followers?: number | null;
  profileImgUrl?: string | null;

  // totals from /api/kols/all
  totalTweets?: number | null;
  totalViews?: number | null;
  totalEngagements?: number | null;

  totalShills?: number | null;
  shillViews?: number | null;
  shillEngagements?: number | null;
  coinsShilled?: string[] | null;

  [k: string]: any;
};

export type Totals = {
  totalTweets: number;
  totalViews: number;
  totalEngs: number;
};

export type CoinItem = {
  tokenKey: string;
  tokenDisplay: string;
  count: number;
};

export type ShillAgg = {
  totalShills: number;
  shillsViews: number;
  shillsEngs: number;
  coins: CoinItem[];
};
