// components/report/ExecutiveSummary.tsx
// Generate a concise, section-wise executive summary of the report.
// - Executive Snapshot
// - Top Shillers 🏆
// - Emerging / Rising Stars
// - Distribution Insights 🚚
// - Overall
//
// Notes:
// - Input rows should be spam-filtered already (caller-side).
// - We keep helpers self-contained here (aggregate, top shillers, emerging, windows).
// - All comments are in English per project convention.

export type TweetRow = {
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  statusLink?: string;
  isVerified?: boolean;
  datetime?: string; // ISO string
};

type Ctx = {
  startDate?: string;
  endDate?: string;
  mode?: "plain" | "rich";
  emoji?: boolean;
  tone?: "neutral" | "upbeat" | "serious";
  seed?: string; // optional randomization seed if needed later
  utc?: boolean; // if true, time windows use UTC hour; otherwise local hour. default true
};

/* ========== Small utils ========== */
const N = (x: unknown) => {
  const v = Number(x);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const compact = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(/\.00?$/, "") + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(/\.00?$/, "") + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(2).replace(/\.00?$/, "") + "K";
  return String(Math.round(v));
};

const pct = (ratio: number): string =>
  (Math.max(0, Math.min(1, ratio)) * 100).toFixed(1).replace(/\.0$/, "") + "%";

const fmtDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
};

const titleCase = (s: string) =>
  s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/* ========== Aggregations ========== */
type Agg = { tweets: number; views: number; engs: number; er: number; verViews: number; verShare: number };

function aggregate(rows: TweetRow[]): Agg {
  const tweets = rows.length;
  let views = 0;
  let engs = 0;
  let verViews = 0;

  for (const t of rows) {
    const v = N(t.views);
    const e = N(t.likes) + N(t.retweets) + N(t.replies);
    views += v;
    engs += e;
    if (t.isVerified) verViews += v;
  }
  const er = views > 0 ? engs / views : 0;
  const verShare = views > 0 ? verViews / views : 0;
  return { tweets, views, engs, er, verViews, verShare };
}

type UserAgg = {
  handle: string;
  verified: boolean;
  tweets: number;
  views: number;
  engs: number;
  er: number; // engagements / views
  topTweetUrl?: string;
  _topViews: number;
};

function aggregateByUser(rows: TweetRow[]): UserAgg[] {
  const map = new Map<string, UserAgg>();
  for (const t of rows) {
    const handle = (t.tweeter || "").replace(/^@?/, "");
    if (!handle) continue;
    const v = N(t.views);
    const e = N(t.likes) + N(t.retweets) + N(t.replies);
    const url = t.statusLink || "";

    const prev =
      map.get(handle) ||
      ({
        handle,
        verified: false,
        tweets: 0,
        views: 0,
        engs: 0,
        er: 0,
        _topViews: -1,
        topTweetUrl: "",
      } as UserAgg);

    const cur: UserAgg = {
      ...prev,
      verified: prev.verified || !!t.isVerified,
      tweets: prev.tweets + 1,
      views: prev.views + v,
      engs: prev.engs + e,
    };
    if (v > prev._topViews && url) {
      cur._topViews = v;
      cur.topTweetUrl = url;
    }
    map.set(handle, cur);
  }
  return Array.from(map.values()).map((u) => ({
    ...u,
    er: u.views > 0 ? u.engs / u.views : 0,
  }));
}

function median(nums: number[]): number {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ========== Sections ========== */

// 1) Top Shillers 🏆 (verified only, sorted by total views)
function getTopShillers(users: UserAgg[], limit = 2): UserAgg[] {
  return users
    .filter((u) => u.verified)
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

// 2) Emerging / Rising Stars: low-view baseline but high ER (≥ 3%)
function getEmerging(users: UserAgg[], limit = 1): UserAgg[] {
  if (!users.length) return [];
  const avgViewsPerTweet = users.map((u) => u.views / Math.max(1, u.tweets));
  const p50 = median(avgViewsPerTweet);
  return users
    .filter((u) => (u.views / Math.max(1, u.tweets)) <= p50 && u.er >= 0.03)
    .sort((a, b) => b.er - a.er)
    .slice(0, limit);
}

// 3) Distribution Insights: best hours by a mixed score (ER p50 + avg views lift)
type WindowScore = { hour: number; score: number; erP50: number; avgViews: number };

function computeBestWindows(rows: TweetRow[], useUTC: boolean, topN = 2): WindowScore[] {
  const items = rows
    .map((r) => {
      if (!r.datetime) return null;
      const d = new Date(r.datetime);
      if (Number.isNaN(d.getTime())) return null;
      const hour = useUTC ? d.getUTCHours() : d.getHours();
      const v = N(r.views);
      const e = N(r.likes) + N(r.retweets) + N(r.replies);
      const er = v > 0 ? e / v : 0;
      return { hour, v, e, er };
    })
    .filter(Boolean) as { hour: number; v: number; e: number; er: number }[];

  if (!items.length) return [];

  // Bucket by hour 0..23
  const buckets = Array.from({ length: 24 }, () => ({ count: 0, views: 0, ers: [] as number[] }));
  for (const it of items) {
    const b = buckets[it.hour];
    b.count += 1;
    b.views += it.v;
    b.ers.push(it.er);
  }

  // Global average view per tweet (for lift)
  const totalViews = items.reduce((s, it) => s + it.v, 0);
  const avgViewsGlobal = items.length ? totalViews / items.length : 0;

  const scored: WindowScore[] = [];
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    if (!b.count) continue;
    const ers = b.ers.slice().sort((x, y) => x - y);
    const p50 = ers[Math.floor((ers.length - 1) * 0.5)] || 0;
    const av = b.views / b.count;
    // blend: 60% ER quality + 40% volume lift
    const score = 0.6 * p50 + 0.4 * (avgViewsGlobal > 0 ? av / avgViewsGlobal : 0);
    scored.push({ hour: h, score, erP50: p50, avgViews: av });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

/* ========== Summary Builder ========== */

export function buildExecutiveSummary(rows: TweetRow[], ctx: Ctx = {}): string {
  const { startDate, endDate, emoji = true, mode = "rich", utc = true } = ctx;

  const agg = aggregate(rows);
  const users = aggregateByUser(rows);

  const topShillers = getTopShillers(users, 2); // show 1–2 handles in summary
  const emerging = getEmerging(users, 1); // one standout rising voice
  const windows = computeBestWindows(rows, utc, 2);

  const tag = (s: string) => (emoji ? s : s.replace(/\s?([🔦🚚📊✅🏆✨🌱💎🌊🔆🚀])/g, "")); // strip emojis if needed
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00${utc ? " UTC" : ""}`;
  const windowText =
    windows.length > 0
      ? windows.map((w) => `${hourLabel(w.hour)} (ER p50 ${pct(w.erP50)})`).join(", ")
      : "—";

  // Section: Executive Snapshot
  const snapshot = `${agg.tweets} tweets reached ${compact(agg.views)} views (ER ${pct(
    agg.er
  )}; verified ${pct(agg.verShare)}).`;

  // Section: Top Shillers
  const shillerText =
    topShillers.length > 0
      ? topShillers
          .map((u) => `@${u.handle}${u.verified ? "" : ""}`) // verified-only already filtered
          .join(" & ")
      : "";

  // Section: Emerging / Rising Stars (keep the current label in Report body; summary uses neutral wording)
  const emergingText =
    emerging.length > 0
      ? `@${emerging[0].handle} (ER ${pct(emerging[0].er)})`
      : "";

  // Distribution Insights
  const distText = windowText;

  // Overall one-liner (neutral tone)
  const overall = (() => {
    if (agg.verShare >= 0.75 && topShillers.length >= 1 && emerging.length >= 1) {
      return "Momentum is led by verified voices while a promising newcomer is emerging.";
    }
    if (agg.verShare >= 0.75 && topShillers.length >= 1) {
      return "Momentum is top-led by verified accounts; broaden mid-tier participation to lift p50 ER.";
    }
    if (emerging.length >= 1) {
      return "New voices are generating healthy ER—consider amplifying them to diversify reach.";
    }
    return "Performance is stable; balancing top reach with mid-tier cadence may improve durability.";
  })();

  const lines: string[] = [];

  lines.push(tag("📊 Executive Summary"));
  lines.push("");
  lines.push(`- Executive Snapshot: ${snapshot}`);
  if (topShillers.length) lines.push(`- ${tag("Top Shillers 🏆")}: ${shillerText}.`);
  if (emergingText) lines.push(`- ${tag("Emerging 🌱")}: ${emergingText}.`);
  lines.push(`- ${tag("Distribution Insights 🚚")}: ${distText}.`);
  lines.push("");
  lines.push(`Overall: ${overall}`);

  // If "plain" mode is requested, strip emojis and extra decoration
  const out = lines.join("\n");
  if (mode === "plain") {
    return out.replace(/([\u2190-\u21FF]|[\u2300-\u27BF]|[\u2B00-\u2BFF]|[\u1F300-\u1FAFF])/g, "");
  }
  return out;
}

