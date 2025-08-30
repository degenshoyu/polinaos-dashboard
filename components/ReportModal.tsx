"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildExecutiveSummary } from "@/components/report/ExecutiveSummary";

/** ======= Types ======= */
type TweetRow = {
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  textContent?: string;
  statusLink?: string;
  isVerified?: boolean;
  /** Optional ISO datetime string (used for time-of-day analysis) */
  datetime?: string;
};

type JobPayload = {
  job_id: string;
  status: string;
  start_date?: string;
  end_date?: string;
  keyword?: (string | unknown)[];
  tweets?: TweetRow[];
};

export default function ReportModal({
  open,
  onClose,
  jobId,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string | null;
}) {
  /** ======= UI state ======= */
  const [data, setData] = useState<JobPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  /** ======= helpers ======= */
  const n = (x: any) => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const compact = (v: number) => {
    if (!Number.isFinite(v)) return "0";
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(/\.0+$/, "") + "B";
    if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(/\.0+$/, "") + "M";
    if (abs >= 1e3) return (v / 1e3).toFixed(2).replace(/\.0+$/, "") + "K";
    return String(Math.round(v));
  };
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const fmtDate = (s?: string) => {
    if (!s) return "—";
    try {
      const d = new Date(s);
      return d.toISOString().slice(0, 10);
    } catch {
      return s;
    }
  };

  // Base58（Solana/pump.fun 样式）地址检测
  const BASE58_STRICT = /^[1-9A-HJ-NP-Za-km-z]{32,60}$/;
  // 全局扫描：从文本里找出所有疑似地址（必须带 g）
  const BASE58_GLOBAL = /[1-9A-HJ-NP-Za-km-z]{32,60}/g;

  /** ======= lifecycle ======= */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      setCopied(false);
    };
  }, [open, onClose]);

  // fetch once when open & jobId present
  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/jobProxy?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => !cancelled && setErr(e?.message || "Failed to load report data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  /** ======= data prep（含过滤） ======= */
  // 原始推文（不做过滤）
  const rowsAllRaw = useMemo<TweetRow[]>(
    () => (data?.tweets ?? []).map((t) => ({ ...t })),
    [data]
  );

  // 从 keywords 取 ticker：第一个以 $ 开头的字符串
  const ticker = useMemo(() => {
    const kw = Array.isArray(data?.keyword)
      ? (data!.keyword as string[]).filter((s) => typeof s === "string")
      : [];
    return kw.find((k) => /^\$[A-Za-z0-9_]{2,20}$/.test(k)) || "$ASSET";
  }, [data]);

  // 识别目标合约地址（用 raw 数据，避免先过滤后识别导致误判）
  const contractAddress = useMemo(() => {
    const candidates: string[] = [];
    const kw = Array.isArray(data?.keyword)
      ? (data!.keyword as string[]).filter((s) => typeof s === "string")
      : [];
    candidates.push(...kw);
    for (const t of rowsAllRaw) if (t.textContent) candidates.push(...t.textContent.split(/\s+/));
    const hit = candidates.find((s) => BASE58_STRICT.test(s));
    return hit || "N/A";
  }, [data, rowsAllRaw]);

  // 过滤：1) $keyword 次数 > 2；2) 含其他 base58 地址（不等于目标 CA）
  const rowsAll = useMemo<TweetRow[]>(() => {
    const ca = BASE58_STRICT.test(contractAddress) ? contractAddress : null;
    const tk = ticker && ticker !== "$ASSET" ? ticker : null;
    const coreTk = tk ? tk.replace(/^\$/g, "").toLowerCase() : null;
    return rowsAllRaw.filter((t) => {
      const text = t.textContent || "";
      if (coreTk) {
        const tickers = (text.match(/\$[A-Za-z0-9_]{2,20}/g) || []).map((s) =>
          s.slice(1).toLowerCase()
        );
        const hasOtherTicker = tickers.some((sym) => sym !== coreTk);
        if (hasOtherTicker) return false;
      }
      if (ca) {
        const found = text.match(BASE58_GLOBAL) || [];
        if (found.length) {
          const others = new Set(found.filter((addr) => addr !== ca));
          if (others.size > 0) return false;
        }
      }
      return true;
    });
  }, [rowsAllRaw, ticker, contractAddress]);

  const rowsVer = useMemo<TweetRow[]>(() => rowsAll.filter((t) => t.isVerified), [rowsAll]);

  // 汇总
  const aggAll = useMemo(() => {
    const tweets = rowsAll.length;
    const views = rowsAll.reduce((s, t) => s + n(t.views), 0);
    const engs = rowsAll.reduce((s, t) => s + n(t.likes) + n(t.retweets) + n(t.replies), 0);
    const er = views > 0 ? engs / views : 0;
    return { tweets, views, engs, er };
  }, [rowsAll]);

  const aggVer = useMemo(() => {
    const tweets = rowsVer.length;
    const views = rowsVer.reduce((s, t) => s + n(t.views), 0);
    const engs = rowsVer.reduce((s, t) => s + n(t.likes) + n(t.retweets) + n(t.replies), 0);
    const er = views > 0 ? engs / views : 0;
    return { tweets, views, engs, er };
  }, [rowsVer]);

  // 轻主题（排除 $ 与 base58）
  const topThemes = useMemo(() => {
    const kw = Array.isArray(data?.keyword)
      ? (data!.keyword as string[]).filter((s) => typeof s === "string")
      : [];
    return kw.filter((k) => !k.startsWith("$") && !BASE58_STRICT.test(k)).slice(0, 3);
  }, [data]);

  // ER 分位
  const erPercentiles = useMemo(() => {
    const ers = rowsAll
      .map((r) => {
        const v = n(r.views);
        const e = n(r.likes) + n(r.retweets) + n(r.replies);
        return v > 0 ? e / v : 0;
      })
      .sort((a, b) => a - b);
    const pick = (p: number) =>
      ers.length ? ers[Math.min(ers.length - 1, Math.floor(p * (ers.length - 1)))] : 0;
    return { p50: pick(0.5), p90: pick(0.9), p99: pick(0.99) };
  }, [rowsAll]);

  // 平均
  const avgAllViews = useMemo(() => (aggAll.tweets > 0 ? aggAll.views / aggAll.tweets : 0), [aggAll]);
  const avgAllEngs = useMemo(() => (aggAll.tweets > 0 ? aggAll.engs / aggAll.tweets : 0), [aggAll]);
  const avgAllER = useMemo(() => (avgAllViews > 0 ? avgAllEngs / avgAllViews : 0), [avgAllViews, avgAllEngs]);
  const avgVerViews = useMemo(() => (aggVer.tweets > 0 ? aggVer.views / aggVer.tweets : 0), [aggVer]);
  const avgVerEngs = useMemo(() => (aggVer.tweets > 0 ? aggVer.engs / aggVer.tweets : 0), [aggVer]);
  const verShare = useMemo(() => (aggAll.views > 0 ? aggVer.views / aggAll.views : 0), [aggAll, aggVer]);

  /** ======= KOL aggregation + segments ======= */
  type KOL = {
    user: string;
    count: number;
    views: number;
    engs: number;
    er: number;
    verifiedViews: number;
    verifiedShare: number;
    bestTweet?: { er: number; engs: number; views: number; link?: string };
    score: number;
  };

  const kols: KOL[] = useMemo(() => {
    const byUser = new Map<string, { rows: TweetRow[] }>();
    for (const t of rowsAll) {
      const u = (t.tweeter || "").trim() || "unknown";
      const o = byUser.get(u) || { rows: [] };
      o.rows.push(t);
      byUser.set(u, o);
    }
    const arr: KOL[] = [];
    let maxEngs = 0;
    for (const [user, { rows }] of byUser) {
      let count = 0,
        views = 0,
        engs = 0,
        verifiedViews = 0;
      let best: KOL["bestTweet"] | undefined;
      for (const r of rows) {
        count++;
        const v = n(r.views);
        const e = n(r.likes) + n(r.retweets) + n(r.replies);
        views += v;
        engs += e;
        if (r.isVerified) verifiedViews += v;
        const er = v > 0 ? e / v : 0;
        if (!best || er > best.er) best = { er, engs: e, views: v, link: r.statusLink };
      }
      const er = views > 0 ? engs / views : 0;
      const verifiedShare = views > 0 ? verifiedViews / views : 0;
      arr.push({ user, count, views, engs, er, verifiedViews, verifiedShare, bestTweet: best, score: 0 });
      if (engs > maxEngs) maxEngs = engs;
    }
    // composite score: 55% engs (norm), 30% ER (≤10%), 15% verified share
    for (const k of arr) {
      const engsNorm = maxEngs > 0 ? k.engs / maxEngs : 0;
      const erNorm = Math.min(1, k.er / 0.1);
      const verNorm = k.verifiedShare;
      k.score = 0.55 * engsNorm + 0.3 * erNorm + 0.15 * verNorm;
    }
    arr.sort((a, b) => b.score - a.score || b.engs - a.engs || b.views - a.views);
    return arr;
  }, [rowsAll]);

  /** ======= Insights: time windows / reach structure / triggers ======= */
  // full deeplink (use current origin; fallback for SSR/local)
  const deeplink = useMemo(() => {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000");
    const id = data?.job_id || jobId || "";
    return `${origin}/dashboard/campaign/analysis?job=${encodeURIComponent(id)}`;
  }, [data?.job_id, jobId]);

  // ⏰ Time-of-day lift windows（Top-3 小时段）
  const timeWindows = useMemo(() => {
    const items = rowsAll
      .map((r) => {
        if (!r.datetime) return null;
        const d = new Date(r.datetime);
        if (Number.isNaN(d.getTime())) return null;
        const hour = d.getHours();
        const v = n(r.views);
        const e = n(r.likes) + n(r.retweets) + n(r.replies);
        const er = v > 0 ? e / v : 0;
        return { hour, v, e, er };
      })
      .filter(Boolean) as { hour: number; v: number; e: number; er: number }[];
    if (!items.length) return [];
    const byHour = Array.from({ length: 24 }, () => ({ count: 0, views: 0, ers: [] as number[] }));
    for (const it of items) {
      const a = byHour[it.hour];
      a.count += 1;
      a.views += it.v;
      a.ers.push(it.er);
    }
    const avgViewsGlobal = aggAll.tweets > 0 ? aggAll.views / aggAll.tweets : 0;
    const scoreHour = (h: number) => {
      const a = byHour[h];
      if (a.count === 0) return { hour: h, score: -1, er: 0, av: 0 };
      const ers = a.ers.slice().sort((x, y) => x - y);
      const p50 = ers[Math.floor((ers.length - 1) * 0.5)] || 0;
      const av = a.views / a.count;
      const score = 0.6 * p50 + 0.4 * (avgViewsGlobal > 0 ? av / avgViewsGlobal : 0);
      return { hour: h, score, er: p50, av };
    };
    return [...Array(24).keys()]
      .map(scoreHour)
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [rowsAll, aggAll]);

  // 🕸️ Reach structure: head(10%) / mid(30%) / tail(60%) by KOL views
  const reachStructure = useMemo(() => {
    const total = kols.reduce((s, k) => s + k.views, 0);
    if (!total || !kols.length) return null;
    const arr = [...kols].sort((a, b) => b.views - a.views);
    const headN = Math.max(1, Math.floor(arr.length * 0.1));
    const midN = Math.max(0, Math.floor(arr.length * 0.3)); // 10-40%
    const head = arr.slice(0, headN).reduce((s, k) => s + k.views, 0) / total;
    const mid = arr.slice(headN, headN + midN).reduce((s, k) => s + k.views, 0) / total;
    const tail = 1 - head - mid;
    return { head, mid, tail };
  }, [kols]);

  // 🔔 Potential triggers（文案/verified share 启发式）
  const potentialTriggers = useMemo(() => {
    const text = rowsAll.map((r) => (r.textContent || "").toLowerCase()).join(" ");
    const hits: string[] = [];
    const has = (re: RegExp) => re.test(text);
    if (has(/\b(airdrop|giveaway)\b/)) hits.push("airdrop/giveaway");
    if (has(/\b(listing|cmc|coingecko|cg|binance|okx|bybit)\b/)) hits.push("listing/CMC/CG");
    if (has(/\b(partnership|collab|integration)\b/)) hits.push("partnership");
    if (has(/\b(pump\.fun|presale|launch)\b/)) hits.push("launch/pump.fun");
    if (verShare >= 0.5) hits.push("verified amplification");
    return Array.from(new Set(hits)).slice(0, 3);
  }, [rowsAll, verShare]);

  // ⭐ best tweet overall by ER
  const bestTweetOverall = useMemo(() => {
    let best: { er: number; views: number; engs: number; link?: string } | null = null;
    for (const r of rowsAll) {
      const v = n(r.views);
      const e = n(r.likes) + n(r.retweets) + n(r.replies);
      const er = v > 0 ? e / v : 0;
      if (!best || er > best.er) best = { er, views: v, engs: e, link: r.statusLink };
    }
    return best;
  }, [rowsAll]);

  /** ======= report text（纯文本 + 轻度 emoji） ======= */
  const report = useMemo(() => {
    const lines: string[] = [];

    // —— Executive Summary（Rich & Dynamic，两句） ——
    const execSummary = buildExecutiveSummary(rowsAll, {
      mode: "rich",
      emoji: true,
      tone: "neutral",
      seed: data?.job_id || jobId || "",
      startDate: data?.start_date,
      endDate: data?.end_date,
    });
    lines.push(execSummary);
    lines.push("");

    // —— Header / Stat Caliber ——
    lines.push(`PolinaOS Twitter Performance Report`);
    lines.push("");
    lines.push(`Ticker: ${ticker}`);
    lines.push(`CA: ${contractAddress}`);
    lines.push(`Time Window: since ${fmtDate(data?.start_date)} until ${fmtDate(data?.end_date)}`);
    lines.push(`Statistical caliber:`);
    lines.push(`- Engagements = Likes + Retweets + Replies`);
    lines.push(`- Avg ER = Avg Engs / Avg Views`);
    lines.push(`Source: @PolinaAIOS ${deeplink}`);
    lines.push("");

    // —— Executive Snapshot ——
    lines.push(`1) Executive Snapshot 📌`);
    lines.push(`- 🧵 Total Tweets ${compact(aggAll.tweets)} vs Verified Tweets ${compact(aggVer.tweets)}`);
    lines.push(`- 👀 Total Views ${compact(aggAll.views)} vs Verified Views ${compact(aggVer.views)}`);
    lines.push(`- ✨ Avg Views ${compact(avgAllViews)} vs Verified Avg Views ${compact(avgVerViews)}`);
    lines.push(`- 💬 Total Engagements ${compact(aggAll.engs)} vs Verified Engagements ${compact(aggVer.engs)}`);
    lines.push(`- ✨ Avg Engagements ${compact(avgAllEngs)} vs Verified Avg Engagements ${compact(avgVerEngs)}`);
    lines.push(`- 📊 ER (overall) = ${pct(aggAll.er)}`);
    lines.push(`- 📈 Avg ER (recommended) = ${pct(avgAllER)}`);
    lines.push(
      `- 📐 ER distribution (per-tweet): p50 ${pct(erPercentiles.p50)}, p90 ${pct(erPercentiles.p90)}, p99 ${pct(
        erPercentiles.p99
      )}`
    );
    lines.push(`- ✅ Verified views share: ${pct(verShare)}`);
    lines.push(`- 🔖 Top themes: ${topThemes.length ? topThemes.join(", ") : "—"}`);
    if (bestTweetOverall) {
      lines.push(
        `- ⭐ Highlight tweet: ${bestTweetOverall.link || "(no link)"} (ER ${pct(bestTweetOverall.er)} | ${compact(
          bestTweetOverall.views
        )} views | ${compact(bestTweetOverall.engs)} engs)`
      );
    }
    lines.push("");

    // —— Shiller Leaderboard（总榜，emoji 行内格式） ——
    lines.push(`2) Shiller Leaderboard 🏆 (Overall Score)`);
    for (const k of kols.slice(0, 5)) {
      const best = k.bestTweet ? ` | best → ${k.bestTweet.link ?? "(no link)"}` : "";
      lines.push(
        `- @${k.user} — score ${(k.score * 100).toFixed(0)} | ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(
          k.engs
        )} ❤🔁💬 | ER ${pct(k.er)} | verified ${pct(k.verifiedShare)}${best}`
      );
    }
    lines.push("");

    // —— Segmented Leaderboards（3A–3F） ——
    lines.push(`3) Segmented Leaderboards (omit if empty)`);
    const section = (title: string, arr: typeof kols) => {
      if (!arr.length) return;
      lines.push(title);
      for (const k of arr) {
        lines.push(
          `- @${k.user} — ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(k.engs)} ❤🔁💬 | ER ${pct(k.er)}${
            k.bestTweet?.link ? ` | best → ${k.bestTweet.link}` : ""
          }`
        );
      }
      lines.push("");
    };
    const viralSpikers = kols.filter((k) => k.count <= 2 && k.er >= 0.05).sort((a, b) => b.er - a.er).slice(0, 5);
    const volumeGrinders = kols
      .filter((k) => k.count >= Math.max(5, Math.ceil(rowsAll.length / 150)))
      .sort((a, b) => b.count - a.count || b.engs - a.engs)
      .slice(0, 5);
    const verifiedLeaders = kols.filter((k) => k.verifiedShare >= 0.5).sort((a, b) => b.verifiedViews - a.verifiedViews).slice(0, 5);
    const steadyContributors = kols
      .filter((k) => k.count >= 2 && k.count <= 5 && k.er >= 0.02 && k.er < 0.05)
      .sort((a, b) => b.engs - a.engs)
      .slice(0, 5);
    const emerging = (() => {
      const xs = kols.map((k) => k.views).sort((a, b) => a - b);
      const mid = Math.floor(xs.length / 2);
      const medianViews = xs.length ? (xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2) : 0;
      return kols.filter((k) => k.views <= medianViews && k.er >= 0.03).sort((a, b) => b.er - a.er).slice(0, 5);
    })();
    section(`3A. High-Impact 🥇 (overall Top 3)`, kols.slice(0, 3));
    section(`3B. Viral Spikers ⚡ (≤2 tweets & ER ≥ 5%)`, viralSpikers);
    section(`3C. Volume Grinders 🔁 (≥5 tweets)`, volumeGrinders);
    section(`3D. Verified Leaders ✅ (verified views ≥ 50%)`, verifiedLeaders);
    section(`3E. Steady Contributors 🧱 (2–5 tweets, ER 2–5%)`, steadyContributors);
    section(`3F. Emerging 🌱 (low-view baseline, ER ≥ 3%)`, emerging);

    // —— Distribution Insights（条件渲染；无信号不显示） ——
    lines.push(`4) Distribution Insights 🚚`);
    if (timeWindows.length) {
      const txt = timeWindows
        .map((x) => `${String(x.hour).padStart(2, "0")}:00 (ER p50 ${pct(x.er)})`)
        .join(", ");
      lines.push(`- ⏰ Time-of-day lift windows: ${txt}`);
    }
    lines.push(`- 🔵 Verified contribution trend: ${pct(verShare)} (level)`);
    if (reachStructure) {
      lines.push(
        `- 🕸️ Reach structure: head ${pct(reachStructure.head)} | mid ${pct(reachStructure.mid)} | long-tail ${pct(
          reachStructure.tail
        )}`
      );
    }
    if (potentialTriggers.length) {
      lines.push(`- 🔔 Potential triggers: ${potentialTriggers.join(", ")}`);
    }

    return lines.join("\n");
  }, [
    // data fields（仅用到的）
    data?.start_date,
    data?.end_date,
    data?.job_id,
    jobId,
    // stat blocks
    ticker,
    contractAddress,
    aggAll,
    aggVer,
    avgAllViews,
    avgAllEngs,
    avgAllER,
    avgVerViews,
    avgVerEngs,
    erPercentiles,
    verShare,
    topThemes,
    // leaderboards & inputs
    kols,
    rowsAll,
    // insights
    timeWindows,
    reachStructure,
    potentialTriggers,
    bestTweetOverall,
    deeplink,
  ]);

  /** ======= handlers ======= */
  const onCopy = async () => {
    // Clipboard API
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // 静默回退（不弹窗）
      try {
        const ta = document.createElement("textarea");
        ta.value = report;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // ignore
      }
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2000);
  };

  /** ======= render ======= */
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b0f0e]/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h3 className="text-sm md:text-base font-semibold text-white/90">📄 Report</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={onCopy}
              className={`px-3 py-1.5 text-xs rounded-lg border ${
                copied
                  ? "border-emerald-400 text-emerald-200 bg-emerald-400/10"
                  : "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
              }`}
              aria-label={copied ? "Copied" : "Copy report"}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg border border-white/20 text-white/80 hover:bg-white/10"
              aria-label="Close report"
            >
              Close
            </button>
          </div>
        </div>

        {/* body — use the same scroll container style as AnalysisConsole */}
        <div
          ref={panelRef}
          tabIndex={-1}
          className="analysis-console-body max-h-[70vh] overflow-y-auto p-5 text-[13px] leading-relaxed text-white/90"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {loading && <div className="text-white/60">Loading…</div>}
          {err && <div className="text-red-400">Error: {err}</div>}
          {!loading && !err && <pre className="whitespace-pre-wrap font-mono">{report}</pre>}
          <div className="mt-3 text-[11px] text-white/40">jobId: {data?.job_id || jobId || "-"}</div>
        </div>
      </div>
    </div>
  );
}
