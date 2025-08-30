"use client";

import React from "react";

/** Minimal tweet shape (兼容你现有 TweetRow) */
export type TweetRow = {
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  isVerified?: boolean;
  datetime?: string;
  textContent?: string;
};

export type ExecutiveSummaryOptions = {
  /** "none"（不含数字）|"minimal"|"compact"|"rich"（推荐） */
  mode?: "none" | "minimal" | "compact" | "rich";
  /** 开启轻量 emoji */
  emoji?: boolean;
  /** 语气：neutral / assertive / analytical（影响措辞池） */
  tone?: "neutral" | "assertive" | "analytical";
  /** 复现用随机种子（传 jobId 可保持同一任务输出稳定） */
  seed?: string;
  /** 时间窗，用于 rich/compact 模式的第一句 */
  startDate?: string;
  endDate?: string;
  /** 阈值配置 */
  config?: Partial<Config>;
};

type Config = {
  strongER: number; // >= strong => strong
  steadyER: number; // >= steady && < strong => steady; else soft
  spikeER: number;  // per-tweet ER threshold for a "spiker"
  minSpikers: number;
  headConcentrated: number;       // > => top-heavy/narrow
  headSomewhatConcentrated: number; // > => somewhat concentrated
  grinderMinTweets: number;       // 每 KOL 视为 grinder 的最少发帖数
  cadenceMinGrinders: number;     // < => 节奏薄弱
  verifiedMinShare: number;       // 低于此阈值且 verifiedAvgER ≥ overallER => under-leveraged
};

const DEFAULTS: Config = {
  strongER: 0.03,
  steadyER: 0.01,
  spikeER: 0.05,
  minSpikers: 2,
  headConcentrated: 0.55,
  headSomewhatConcentrated: 0.40,
  grinderMinTweets: 5,
  cadenceMinGrinders: 3,
  verifiedMinShare: 0.35,
};

/* ---------- utils ---------- */
const n = (x: any) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const compact = (v: number) => {
  if (!Number.isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2).replace(/\.0+$/, "") + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2).replace(/\.0+$/, "") + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(2).replace(/\.0+$/, "") + "K";
  return String(Math.round(v));
};
const fmtDate = (s?: string) => {
  if (!s) return "—";
  try { return new Date(s).toISOString().slice(0, 10); } catch { return s; }
};

const pickPctile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const i = Math.floor((arr.length - 1) * p);
  return arr.slice().sort((a, b) => a - b)[i] ?? 0;
};

/** 轻量可复现随机（FNV-1a + LCG） */
function rng(seed: string | undefined) {
  let h = 2166136261 >>> 0;
  const s = String(seed ?? "seed");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
const choose = <T,>(arr: T[], r: () => number) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(r() * arr.length)))];

type Signals = {
  momentum: "strong" | "steady" | "soft";
  shape: "top-heavy" | "focused" | "broad";
  hasSpikes: boolean;
  verifiedUnderLeveraged: boolean;
  cadenceThin: boolean;
  overallER: number;
  verifiedShare: number;
  posts: number;
  views: number;
  engs: number;
  topHandles: string[];     // 头部 KOL（视图&互动）
  spikeHandles: string[];   // 高 ER spikers
  highlight?: { handle?: string; views: number; engs: number };
};

/* ---------- core: compute signals from tweets ---------- */
function computeSignals(tweets: TweetRow[], cfg: Config): Signals {
  const per = tweets.map((t) => {
    const v = n(t.views);
    const e = n(t.likes) + n(t.retweets) + n(t.replies);
    const er = v > 0 ? e / v : 0;
    return {
      tweeter: (t.tweeter || "unknown").trim() || "unknown",
      v, e, er, isVerified: !!t.isVerified,
      link: (t as any).statusLink as string | undefined,
    };
  });
  const posts = tweets.length;
  const views = per.reduce((s, x) => s + x.v, 0);
  const engs  = per.reduce((s, x) => s + x.e, 0);
  const overallER = views > 0 ? engs / views : 0;

  // verified
  const ver = per.filter((x) => x.isVerified);
  const verViews = ver.reduce((s, x) => s + x.v, 0);
  const verEngs  = ver.reduce((s, x) => s + x.e, 0);
  const verShare = views > 0 ? verViews / views : 0;
  const verAvgER = (verViews > 0 && ver.length > 0) ? (verEngs / ver.length) / (verViews / ver.length) : 0;

  // p50 ER
  const p50 = pickPctile(per.map(x => x.er), 0.5);
  const basisER = p50 || overallER;
  const momentum: Signals["momentum"] =
    basisER >= cfg.strongER ? "strong" :
    basisER >= cfg.steadyER ? "steady" : "soft";

  // head share & handles
  const byUser = new Map<string, { views: number; engs: number; count: number; best?: {er:number; v:number; e:number; link?: string} }>();
  for (const r of per) {
    const m = byUser.get(r.tweeter) || { views: 0, engs: 0, count: 0, best: undefined };
    m.views += r.v; m.engs += r.e; m.count += 1;
    const er = r.v > 0 ? r.e / r.v : 0;
    if (!m.best || er > m.best.er) m.best = { er, v: r.v, e: r.e, link: (r as any).link };
    byUser.set(r.tweeter, m);
  }
  const kolArr = [...byUser.entries()].map(([handle, v]) => ({ handle, ...v }));
  const totalKolViews = kolArr.reduce((s, k) => s + k.views, 0) || 1;
  const sortedByViews = kolArr.slice().sort((a,b)=> b.views - a.views);
  const headN = Math.max(1, Math.floor(sortedByViews.length * 0.1));
  const headShare = sortedByViews.slice(0, headN).reduce((s,k)=> s + k.views, 0) / totalKolViews;
  const shape: Signals["shape"] =
    headShare > cfg.headConcentrated ? "top-heavy" :
    headShare > cfg.headSomewhatConcentrated ? "focused" : "broad";
  const topHandles = sortedByViews.slice(0, 3).map(k => k.handle);

  // spikers
  const spikeHandles = kolArr
    .filter(k => (k.best?.er ?? 0) >= cfg.spikeER)
    .slice(0, 5)
    .map(k => k.handle);
  const hasSpikes = spikeHandles.length >= cfg.minSpikers;

  // cadence
  const grinders = kolArr.filter(k => k.count >= cfg.grinderMinTweets).length;
  const cadenceThin = grinders < cfg.cadenceMinGrinders;

  // highlight
  let best: { handle?: string; views: number; engs: number } | undefined = undefined;
  for (const k of kolArr) {
    if (!k.best) continue;
    if (!best || k.best.er > (best as any).er) best = { handle: k.handle, views: k.best.v, engs: k.best.e } as any;
  }

  const verifiedUnderLeveraged = verShare < cfg.verifiedMinShare && verAvgER >= overallER;

  return {
    momentum, shape, hasSpikes, verifiedUnderLeveraged, cadenceThin,
    overallER, verifiedShare: verShare, posts, views, engs,
    topHandles, spikeHandles, highlight: best,
  };
}

/* ---------- phrase banks (dynamic) ---------- */
const BANK = {
  lead: {
    neutral: [
      "Momentum is {momentum} yet {shape}",
      "Momentum is {momentum} and {shape}",
      "{shape} momentum with {momentum} signal",
    ],
    assertive: [
      "{shape} momentum, {momentum} signal",
      "{momentum} but {shape}",
    ],
    analytical: [
      "Trajectory is {momentum} and {shape}",
      "{momentum} but distribution is {shape}",
    ],
  },
  withSpikes: [
    "with outsized lift from a few creators",
    "with breakout spikes from select posts",
    "led by a handful of high-ER bursts",
  ],
  nextPreamble: {
    neutral: [
      "Next:",
      "To turn moments into momentum,",
      "To compound results,",
    ],
    assertive: [
      "Playbook:",
      "Do this next:",
    ],
    analytical: [
      "Recommended actions:",
      "Operationally:",
    ],
  },
  actions: {
    replicate: [
      "codify the breakout template",
      "productize the winning format",
      "turn the standout narrative into a reusable template",
    ],
    assign: [
      "assign it to {handles}",
      "seed it with {handles}",
      "roll it out via {handles}",
    ],
    verified: [
      "add two verified megaphones",
      "expand the bench of verified voices",
      "bring in credible verified amplifiers",
    ],
    midtier: [
      "build a mid-tier cadence",
      "grow consistent mid-tier output",
      "develop a predictable mid-tier run",
    ],
    liftMedian: [
      "to lift the median",
      "to raise p50 ER",
      "to level up the baseline",
    ],
  },
};

/* ---------- builders ---------- */
function fill(t: string, dict: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => dict[k] ?? "");
}

function sentence1(sig: Signals, r: () => number, tone: ExecutiveSummaryOptions["tone"], emoji: boolean) {
  const lead = choose(BANK.lead[tone || "neutral"], r);
  const shapeWord =
    sig.shape === "top-heavy" ? (emoji ? "top-heavy 🔦" : "top-heavy")
    : sig.shape === "focused" ? "focused"
    : "broad";
  let s = fill(lead, {
    momentum: sig.momentum,
    shape: shapeWord,
  });
  if (sig.hasSpikes) s += ", " + choose(BANK.withSpikes, r);
  s += ".";
  return s;
}

function sentence2_rich(sig: Signals, r: () => number, tone: ExecutiveSummaryOptions["tone"], emoji: boolean, dates?: {start?: string, end?: string}) {
  const pre = choose(BANK.nextPreamble[tone || "neutral"], r);
  const posts = sig.posts;
  const v = compact(sig.views);
  const er = pct(sig.overallER);
  const ver = pct(sig.verifiedShare);
  const handlesSrc = (sig.spikeHandles.length ? sig.spikeHandles : sig.topHandles).slice(0, 2);
  const handles =
    handlesSrc.length === 2 ? `@${handlesSrc[0]}/@${handlesSrc[1]}` :
    handlesSrc.length === 1 ? `@${handlesSrc[0]}` : "two verified voices";

  const part1 = `Across ${fmtDate(dates?.start)} to ${fmtDate(dates?.end)}, ${posts} ${emoji ? "📄" : "posts"} reached ${v} ${emoji ? "👁" : "views"} (ER ${er}; verified ${ver}).`;

  const a1 = choose(BANK.actions.replicate, r);
  const a2 = choose(BANK.actions.assign, r);
  const a3 = choose(BANK.actions.verified, r);
  const a4 = choose(BANK.actions.midtier, r);
  const a5 = choose(BANK.actions.liftMedian, r);

  const part2 = `${pre} ${a1}, ${fill(a2, { handles })}, ${a3}, and ${a4} ${a5}.`;
  return `${part1} ${part2}`;
}

function sentence2_compact(sig: Signals, r: () => number, tone: ExecutiveSummaryOptions["tone"]) {
  const pre = choose(BANK.nextPreamble[tone || "neutral"], r);
  const handlesSrc = (sig.spikeHandles.length ? sig.spikeHandles : sig.topHandles).slice(0, 2);
  const handles =
    handlesSrc.length === 2 ? `@${handlesSrc[0]}/@${handlesSrc[1]}` :
    handlesSrc.length === 1 ? `@${handlesSrc[0]}` : "two verified voices";

  const a1 = choose(BANK.actions.replicate, r);
  const a2 = choose(BANK.actions.assign, r);
  const a3 = choose(BANK.actions.verified, r);
  const a4 = choose(BANK.actions.midtier, r);
  const a5 = choose(BANK.actions.liftMedian, r);

  return `${pre} ${a1}, ${fill(a2, { handles })}, ${a3}, and ${a4} ${a5}.`;
}

/* ---------- public API ---------- */
export function buildExecutiveSummary(
  tweets: TweetRow[],
  options: ExecutiveSummaryOptions = {}
): string {
  const {
    mode = "rich",
    emoji = true,
    tone = "neutral",
    seed,
    startDate,
    endDate,
    config,
  } = options;
  const cfg: Config = { ...DEFAULTS, ...(config || {}) };
  const sig = computeSignals(tweets, cfg);
  const r = rng(seed);

  const s1 = sentence1(sig, r, tone, emoji);

  if (mode === "none") {
    const s2 = sentence2_compact(sig, r, tone);
    return `${s1} ${s2}`;
  }
  if (mode === "minimal" || mode === "compact") {
    const s2 = sentence2_compact(sig, r, tone);
    if (mode === "minimal") return `${s1} ${s2}`;
    const er = pct(sig.overallER);
    const ver = pct(sig.verifiedShare);
    return `${s1} ER ${er}; verified ${ver}. ${s2}`;
  }
  const s2 = sentence2_rich(sig, r, tone, emoji, { start: startDate, end: endDate });
  return `${s1} ${s2}`;
}

export default function ExecutiveSummaryView({
  tweets,
  options,
}: {
  tweets: TweetRow[];
  options?: ExecutiveSummaryOptions;
}) {
  const text = buildExecutiveSummary(tweets, options);
  return <span>{text}</span>;
}
