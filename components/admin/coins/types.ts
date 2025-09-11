// components/admin/coins/types.ts

export type Preset = "7d" | "30d" | "all" | "custom";

export type SortKey =
  | "ticker"
  | "ca"
  | "tweets"
  | "views"
  | "engs"
  | "er"
  | "kols"
  | "followers";

export type TopKol = {
  username: string;
  count: number;
  followers?: number | null;
};

export type CoinRow = {
  ticker?: string | null;
  ca?: string | null;
  totalTweets: number;
  noPriceTweets?: number; // backend adds this
  totalViews: number;
  totalEngagements: number;
  er: number;
  totalKols: number;
  totalFollowers: number;
  topKols: TopKol[];
  sources: Record<string, number>;
  gmgn: string;
};

export type DupeItem = {
  ticker: string;
  totalMentions: number;
  cas: { ca: string; mentions: number }[];
};

// ✅ 新增：TweetListModal 需要的条目类型
export type TweetItem = {
  tweetId: string;
  username: string;
  views: number;
  engagements: number;
  publish: string; // ISO string
  priceUsdAt: string | number | null;
};

export function fmtNum(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (v >= 1000)
    return Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  return String(v);
}

export function shortCa(ca?: string | null, left = 4, right = 4) {
  const s = (ca ?? "").trim();
  if (!s) return "";
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}
