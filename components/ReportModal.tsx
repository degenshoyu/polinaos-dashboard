"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildExecutiveSummary } from "@/components/report/ExecutiveSummary";
import {
  filterSpamTweets,
  resolveCAFromJob,
  resolveCoreFromJob,
  BASE58_STRICT,
} from "@/components/filters/spamDetection";

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

  /** ======= data prep ======= */
  // 原始推文（不做过滤）
  const rowsAllRaw = useMemo<TweetRow[]>(
    () => (data?.tweets ?? []).map((t) => ({ ...t })),
    [data]
  );

  // 从 keywords 取核心 ticker（不带 $，小写）
  const coreTicker = useMemo(() => resolveCoreFromJob(data?.keyword), [data]);
  const ticker = useMemo(() => (coreTicker ? `$${coreTicker}` : "$ASSET"), [coreTicker]);

  // 目标合约地址（优先 keywords，其次文本）
  const contractAddress = useMemo(() => {
    const ca = resolveCAFromJob(data?.keyword, rowsAllRaw);
    return ca || "N/A";
  }, [data, rowsAllRaw]);

  // 统一 spam 过滤：包含其他 CA 或者超过 2 个其他 $ticker 的推文直接排除
  const rowsAll = useMemo<TweetRow[]>(() => {
    const rules = {
      coreTicker: coreTicker ?? null,
      contractAddress: BASE58_STRICT.test(contractAddress) ? contractAddress : null,
      maxOtherTickers: 2,
    };
    return filterSpamTweets(rowsAllRaw, rules);
  }, [rowsAllRaw, contractAddress, coreTicker]);

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

  /** ======= KOL aggregation + score ======= */
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

  /** ======= Insights ======= */
  // full deeplink
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

  // ⭐ best tweet overall by ER（备用）
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

  /** ======= report text（新版：与你示例一致的 6 段式） ======= */
  const report = useMemo(() => {
    // Executive summary（两句，沿用独立模块）
    const execSummary = buildExecutiveSummary(rowsAll, {
      mode: "rich",
      emoji: true,
      tone: "neutral",
      seed: data?.job_id || jobId || "",
      startDate: data?.start_date,
      endDate: data?.end_date,
    });

    const topN = <T,>(arr: T[], n: number) => arr.slice(0, Math.max(0, n));

    // 1️⃣ Executive Snapshot
    const snapshot = [
      `🧵 Total Tweets ${aggAll.tweets} vs Verified Tweets ${aggVer.tweets}`,
      `👀 Total Views ${compact(aggAll.views)} vs Verified Views ${compact(aggVer.views)}`,
      `✨ Avg Views ${compact(avgAllViews)} vs Verified Avg Views ${compact(avgVerViews)}`,
      `💬 Total Engagements ${compact(aggAll.engs)} vs Verified Engagements ${compact(aggVer.engs)}`,
      `✨ Avg Engagements ${compact(avgAllEngs)} vs Verified Avg Engagements ${compact(avgVerEngs)}`,
      `📊 ER (overall) = ${pct(aggAll.er)}`,
      `✅ Verified views share: ${pct(verShare)}`,
    ].join("\n");

    // 2️⃣ Verified Leaders（按 verifiedViews 排，展示前 5）
    const verifiedLeaders = topN(
      kols.filter(k => k.verifiedShare >= 0.5)
          .sort((a,b) => b.verifiedViews - a.verifiedViews),
      5
    ).map((k, i) => {
      const medal = ["🥇","🥈","🥉","🎖","🏅"][i] ?? "•";
      const best = k.bestTweet?.link ? `\nTop Tw: ${k.bestTweet.link}` : "";
      return `${medal} @${k.user} — ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(k.engs)} ❤🔁💬 | ER ${pct(k.er)}${best}`;
    }).join("\n");

    // 3️⃣ Shiller Leaderboard（按综合 score 排）
    const shillerTop = topN(
      [...kols].sort((a,b)=> b.score - a.score || b.engs - a.engs || b.views - a.views),
      5
    ).map((k, i) => {
      const medal = ["🥇","🥈","🥉","🎖","🏅"][i] ?? "•";
      const best = k.bestTweet?.link ? `\nTop Tw: ${k.bestTweet.link}` : "";
      return `${medal} @${k.user} — score ${(k.score*100).toFixed(0)} | ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(k.engs)} ❤🔁💬 | ER ${pct(k.er)}${best}`;
    }).join("\n");

    // 4️⃣ Volume Grinders（≥5 条）
    const grinders = topN(
      kols.filter(k => k.count >= Math.max(5, Math.ceil(rowsAll.length / 150)))
          .sort((a,b)=> b.count - a.count || b.engs - a.engs),
      3
    ).map((k,i) => {
      const medal = ["🥇","🥈","🥉"][i] ?? "•";
      const best = k.bestTweet?.link ? `\nTop Tw: ${k.bestTweet.link}` : "";
      return `${medal} @${k.user} — ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(k.engs)} ❤🔁💬 | ER ${pct(k.er)}${best}`;
    }).join("\n");

    // 5️⃣ Emerging（低基线 + ER ≥ 3%）
    const medianViews = (() => {
      const xs = kols.map(k => k.views).sort((a,b)=> a-b);
      if (!xs.length) return 0;
      const m = Math.floor(xs.length/2);
      return xs.length % 2 ? xs[m] : (xs[m-1] + xs[m]) / 2;
    })();
    const emerging = topN(
      kols.filter(k => k.views <= medianViews && k.er >= 0.03)
          .sort((a,b)=> b.er - a.er),
      3
    ).map((k,i) => {
      const medal = ["🥇","🥈","🥉"][i] ?? "•";
      const best = k.bestTweet?.link ? `\nTop Tw: ${k.bestTweet.link}` : "";
      return `${medal} @${k.user} — ${k.count} 📄 | ${compact(k.views)} 👁 | ${compact(k.engs)} ❤🔁💬 | ER ${pct(k.er)}${best}`;
    }).join("\n");

    // 6️⃣ Distribution Insights（保留你示例里的两个点）
    const timeTxt = timeWindows.length
      ? timeWindows.map(x => `${String(x.hour).padStart(2,"0")}:00 (ER p50 ${pct(x.er)})`).join(", ")
      : "—";
    const insights = [
      `- ⏰ Time-of-day lift windows: ${timeTxt}`,
      `- 🔵 Verified contribution trend: ${pct(verShare)} (level)`,
    ].join("\n");

    // ====== 拼装成目标样式 ======
    const header = [
      `${ticker} Twitter Performance Report`,
      `${contractAddress}`,
      `since ${fmtDate(data?.start_date)} until ${fmtDate(data?.end_date)}`,
      ``,
      `Source: @PolinaAIOS ${deeplink}`,
      ``,
      execSummary,
      ``,
      `1️⃣ Executive Snapshot 📌`,
      ``,
      snapshot,
      ``,
      `2️⃣ Verified Leaders ✅ (by top views)`,
      ``,
      verifiedLeaders || "—",
      ``,
      `3️⃣ Shiller Leaderboard 🏆 (Overall Score)`,
      ``,
      shillerTop || "—",
      ``,
      `4️⃣ Volume Grinders 🔁 (≥5 tweets)`,
      ``,
      grinders || "—",
      ``,
      `5️⃣ Emerging 🌱 (low-view baseline, ER ≥ 3%)`,
      ``,
      emerging || "—",
      ``,
      `6️⃣ Distribution Insights 🚚`,
      ``,
      insights,
    ].join("\n");

    return header;
  }, [
    data?.start_date, data?.end_date, data?.job_id, jobId,
    ticker, contractAddress,
    aggAll, aggVer, avgAllViews, avgAllEngs, avgVerViews, avgVerEngs, verShare,
    kols, rowsAll, timeWindows, deeplink,
  ]);

  /** ======= handlers ======= */
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
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
          className="analysis-console-body max-h:[70vh] md:max-h-[70vh] overflow-y-auto p-5 text-[13px] leading-relaxed text-white/90"
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
