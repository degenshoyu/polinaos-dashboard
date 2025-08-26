// lib/analysis/emotionalLandscape.ts
export type EmotionLabel =
  | "bullish"
  | "bearish"
  | "optimistic"
  | "neutral"
  | "concerned";

export type TweetForEmotion = {
  textContent: string;
  tweeter?: string;
  datetime?: string;
  isVerified?: boolean;
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  statusLink?: string;
  tweetId?: string;
};

export type EmotionBucket = {
  label: EmotionLabel;
  score: number;
  sharePct: number;
  count: number;
  intensity: { low: number; mid: number; high: number };
  keywordsTop: Array<{ term: string; count: number }>;
  topTweets: Array<{
    tweetId?: string;
    tweeter?: string;
    datetime?: string;
    statusLink?: string;
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
    score: number;
    textPreview: string;
  }>;
};

export type EmotionalLandscape = {
  totals: { tweets: number; views: number; engagements: number };
  buckets: EmotionBucket[];
  method: {
    version: string;
    weightFormula: string;
    notes: string[];
  };
};

const DICT: Record<Exclude<EmotionLabel, "neutral">, string[]> = {
  bullish: [
    "to the moon",
    "ath",
    "breakout",
    "pump",
    "parabolic",
    "rally",
    "moonshot",
    "bull",
    "bullish",
    "green",
    "send it",
    "🚀",
    "📈",
    "🔥",
  ],
  bearish: [
    "dump",
    "rug",
    "bear",
    "bearish",
    "down",
    "red",
    "crash",
    "rekt",
    "sell-off",
    "scam",
    "collapse",
    "📉",
    "😱",
  ],
  optimistic: [
    "potential",
    "promising",
    "excited",
    "amazing",
    "great",
    "strong",
    "building",
    "partnership",
    "growth",
    "opportunity",
    "soon",
    "upcoming",
    "love",
    "nice",
    "fantastic",
  ],
  concerned: [
    "concern",
    "worried",
    "risk",
    "issue",
    "problem",
    "delay",
    "uncertain",
    "questionable",
    "doubt",
    "warning",
    "caution",
    "suspicious",
    "fud",
    "why",
    "wtf",
    "hm",
  ],
};

function safeNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}
function textHits(text: string, terms: string[]) {
  const t = text.toLowerCase();
  let hits: string[] = [];
  for (const term of terms) {
    const q = term.toLowerCase();
    if (q.length === 1) {
      if (t.includes(q)) hits.push(term);
    } else {
      const rx = new RegExp(`\\b${escapeRx(q)}\\b`, "i");
      if (rx.test(t)) hits.push(term);
    }
  }
  return hits;
}
function escapeRx(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decideLabel(hitMap: Record<EmotionLabel, string[]>): EmotionLabel {
  const scores: Record<EmotionLabel, number> = {
    bullish: hitMap.bullish.length,
    bearish: hitMap.bearish.length,
    optimistic: hitMap.optimistic.length,
    concerned: hitMap.concerned.length,
    neutral: 0,
  };
  const polarGap = Math.abs(scores.bullish - scores.bearish);
  const polarMax = Math.max(scores.bullish, scores.bearish);
  let label: EmotionLabel = "neutral";
  let maxScore = 0;
  for (const k of [
    "bullish",
    "bearish",
    "optimistic",
    "concerned",
  ] as EmotionLabel[]) {
    if (scores[k] > maxScore) {
      maxScore = scores[k];
      label = k;
    }
  }
  if (
    polarMax > 0 &&
    polarGap <= 1 &&
    scores.bullish > 0 &&
    scores.bearish > 0
  ) {
    label = "concerned";
  }
  if (maxScore === 0) label = "neutral";
  return label;
}

export function computeEmotionalLandscape(
  rows: TweetForEmotion[],
): EmotionalLandscape {
  const buckets: Record<EmotionLabel, EmotionBucket> = {
    bullish: baseBucket("bullish"),
    bearish: baseBucket("bearish"),
    optimistic: baseBucket("optimistic"),
    neutral: baseBucket("neutral"),
    concerned: baseBucket("concerned"),
  };
  let totalViews = 0,
    totalEng = 0;

  for (const t of rows) {
    const txt = (t.textContent || "").slice(0, 2000);
    const hits: Record<EmotionLabel, string[]> = {
      bullish: textHits(txt, DICT.bullish),
      bearish: textHits(txt, DICT.bearish),
      optimistic: textHits(txt, DICT.optimistic),
      concerned: textHits(txt, DICT.concerned),
      neutral: [],
    };
    const label = decideLabel(hits);

    const likes = safeNum(t.likes),
      rts = safeNum(t.retweets),
      reps = safeNum(t.replies),
      views = Math.max(0, safeNum(t.views));
    const wEng = likes + 2 * rts + reps;
    const wViews = Math.sqrt(views);
    const confidence = Math.min(1, (hits[label]?.length || 0) / 3);
    const weight = 1 + wEng + 0.25 * wViews;
    const score =
      weight * (label === "neutral" ? 0.6 : 1) * (confidence || 0.5);

    totalViews += views;
    totalEng += wEng;

    const b = buckets[label];
    b.score += score;
    b.count += 1;

    const level = score < 5 ? "low" : score < 20 ? "mid" : "high";
    b.intensity[level as "low" | "mid" | "high"] += 1;

    const keyset = new Map<string, number>();
    for (const term of hits[label] || [])
      keyset.set(term, (keyset.get(term) || 0) + 1);
    // 只累计这条的命中词到 bucket 词频
    for (const [k, v] of keyset) addTerm(b, k, v);

    // top tweets
    b.topTweets.push({
      tweetId: t.tweetId,
      tweeter: t.tweeter,
      datetime: t.datetime,
      statusLink: t.statusLink,
      likes,
      retweets: rts,
      replies: reps,
      views,
      score,
      textPreview: txt.slice(0, 160),
    });
  }

  const totalScore =
    Object.values(buckets).reduce((s, b) => s + b.score, 0) || 1;
  for (const b of Object.values(buckets)) {
    b.sharePct = +((b.score / totalScore) * 100).toFixed(2);
    b.topTweets.sort((a, z) => z.score - a.score);
    b.topTweets = b.topTweets.slice(0, 5);
    b.keywordsTop.sort((a, z) => z.count - a.count);
    b.keywordsTop = b.keywordsTop.slice(0, 8);
  }

  return {
    totals: {
      tweets: rows.length,
      views: Math.round(totalViews),
      engagements: Math.round(totalEng),
    },
    buckets: ["bullish", "optimistic", "neutral", "concerned", "bearish"].map(
      (l) => buckets[l as EmotionLabel],
    ),
    method: {
      version: "v1.0-emolandscape-lex-weights",
      weightFormula:
        "score = (1 + likes + 2*retweets + replies) + 0.25*sqrt(views), scaled by keyword-confidence",
      notes: [
        "Keyword lexicon + emoji triggers",
        "Engagement-dominant weighting; views dampened via sqrt",
        "Conflict (bull vs bear) near tie → concerned",
      ],
    },
  };
}

function baseBucket(label: EmotionLabel): EmotionBucket {
  return {
    label,
    score: 0,
    sharePct: 0,
    count: 0,
    intensity: { low: 0, mid: 0, high: 0 },
    keywordsTop: [],
    topTweets: [],
  };
}
function addTerm(b: EmotionBucket, term: string, inc = 1) {
  const i = b.keywordsTop.findIndex((x) => x.term === term);
  if (i >= 0) b.keywordsTop[i].count += inc;
  else b.keywordsTop.push({ term, count: inc });
}
