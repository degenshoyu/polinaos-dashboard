"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildExecutiveSummary } from "@/components/report/ExecutiveSummary";
import {
  filterSpamTweets,
  resolveCAFromJob,
  resolveCoreFromJob,
  BASE58_STRICT,
} from "@/components/filters/spamDetection";

/** ===== Types ===== */
type TweetRow = {
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  textContent?: string;
  statusLink?: string;
  isVerified?: boolean;
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
  /** ===== UI state ===== */
  const [data, setData] = useState<JobPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  /** ===== helpers ===== */
  const n = (x: any, d = 0) => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const compact = (v: number) => {
    if (!Number.isFinite(v)) return "0";
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(/\.00?$/, "") + "B";
    if (abs >= 1e6) return (v / 1e6).toFixed(2).replace(/\.00?$/, "") + "M";
    if (abs >= 1e3) return (v / 1e3).toFixed(2).replace(/\.00?$/, "") + "K";
    return String(Math.round(v));
  };
  const pct = (v: number) => (v * 100).toFixed(1).replace(/\.0$/, "") + "%";
  const fmtDate = (s?: string) => {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
  };

  /** ===== lifecycle ===== */
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

  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/jobProxy?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setErr(e?.message || "Failed to load report data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  /** ===== data prep ===== */
  const rowsAllRaw = useMemo<TweetRow[]>(
    () => (data?.tweets ?? []).map((t) => ({ ...t })),
    [data]
  );

  const coreTicker = useMemo(() => resolveCoreFromJob(data?.keyword), [data]);
  const ticker = useMemo(() => (coreTicker ? `$${coreTicker}` : "$ASSET"), [coreTicker]);

  const contractAddress = useMemo(() => {
    const ca = resolveCAFromJob(data?.keyword, rowsAllRaw);
    return ca || "N/A";
  }, [data, rowsAllRaw]);

  // Spam 过滤
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

  const avgAllViews = useMemo(() => (aggAll.tweets > 0 ? aggAll.views / aggAll.tweets : 0), [aggAll]);
  const avgAllEngs = useMemo(() => (aggAll.tweets > 0 ? aggAll.engs / aggAll.tweets : 0), [aggAll]);
  const verShare = useMemo(() => (aggAll.views > 0 ? aggVer.views / aggAll.views : 0), [aggAll, aggVer]);

  /** ===== KOL aggregation & helpers for Top-3 blocks ===== */
  type MinimalTweet = Pick<
    TweetRow,
    "tweeter" | "views" | "likes" | "retweets" | "replies" | "statusLink" | "isVerified"
  >;

  type UserAgg = {
    handle: string;
    views: number;
    engs: number;
    tweets: number;
    er: number;
    verified: boolean;
    topTweetUrl?: string;
    _topViews: number;
  };

  const aggregateByUser = (tweets: MinimalTweet[]): UserAgg[] => {
    const map = new Map<string, UserAgg>();
    for (const t of tweets || []) {
      const handle = (t.tweeter || "").replace(/^@?/, "");
      if (!handle) continue;
      const views = n(t.views, 0);
      const engs = n(t.likes, 0) + n(t.retweets, 0) + n(t.replies, 0);
      const verified = Boolean(t.isVerified);
      const url = t.statusLink || "";

      const prev =
        map.get(handle) ||
        ({ handle, views: 0, engs: 0, tweets: 0, er: 0, verified: false, topTweetUrl: "", _topViews: -1 } as UserAgg);

      const cur: UserAgg = {
        ...prev,
        views: prev.views + views,
        engs: prev.engs + engs,
        tweets: prev.tweets + 1,
        verified: prev.verified || verified,
      };
      if (views > (prev._topViews ?? -1) && url) {
        cur._topViews = views;
        cur.topTweetUrl = url;
      }
      map.set(handle, cur);
    }
    return Array.from(map.values()).map((u) => ({ ...u, er: u.views > 0 ? u.engs / u.views : 0 }));
  };

  const MEDALS = ["🥇", "🥈", "🥉"] as const;

  function buildTop3Block(title: string, list: UserAgg[]) {
    const top3 = list.slice(0, 3);
    const lines: string[] = [title, ""];
    top3.forEach((u, i) => {
      const medal = MEDALS[i] || "•";
      const handle = "@" + u.handle;
      const line2 = `${compact(u.views)} views | ${compact(u.engs)} engs | ${pct(u.er)} ER`;
      const topLabel = i === 0 ? "Top Tweet" : "Top Tw";
      const url = u.topTweetUrl || "";
      lines.push(`${medal} ${handle}`);
      lines.push(line2);
      lines.push(`${topLabel}: ${url}`);
      lines.push("");
    });
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  function median(nums: number[]): number {
    const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  const users = useMemo<UserAgg[]>(() => aggregateByUser(rowsAll as MinimalTweet[]), [rowsAll]);

  /** ===== Insights ===== */
  const deeplink = useMemo(() => {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";
    const id = data?.job_id || jobId || "";
    return `${origin}/dashboard/campaign/analysis?job=${encodeURIComponent(id)}`;
  }, [data?.job_id, jobId]);

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

  /** ===== Report text (目标样式) ===== */
  const report = useMemo(() => {
    const execSummary = buildExecutiveSummary(rowsAll, {
      mode: "rich",
      emoji: true,
      tone: "neutral",
      seed: data?.job_id || jobId || "",
      startDate: data?.start_date,
      endDate: data?.end_date,
    });

    // 1️⃣ Executive Snapshot（严格对齐你的示例）
    const snapshot = [
      `${aggAll.tweets} total tweets`,
      `${compact(aggAll.views)} total views | ${compact(aggAll.tweets ? aggAll.views / aggAll.tweets : 0)} avg views`,
      `${compact(aggAll.engs)} engagements | ${compact(aggAll.tweets ? aggAll.engs / aggAll.tweets : 0)} avg engs`,
      "",
      `📊 ${pct(aggAll.er)} ER`,
      `✅ ${pct(verShare)} verified views share`,
    ].join("\n");

    // 2️⃣ Verified Leaders ✅ (by top views) — 仅 Top 3，三行块格式
    const verifiedLeaders = users
      .filter((u) => u.verified)
      .sort((a, b) => b.views - a.views);

    // 3️⃣ Shiller Leaderboard 🏆 (Overall Score) — 简易稳定综合分
    const withScore = users
      .map((u) => ({ ...u, _score: u.views * 0.6 + u.engs * 0.3 + (u.er * 100) * 0.1 }))
      .sort((a, b) => b._score - a._score);

    // 4️⃣ Volume Grinders 🔁 (≥5 tweets)
    const grinders = users
      .filter((u) => u.tweets >= 5)
      .sort((a, b) => (b.tweets - a.tweets) || (b.views - a.views));

    // 5️⃣ Emerging 🌱 (low-view baseline, ER ≥ 3%)
    const p50Views = median(users.map((u) => (u.views / Math.max(1, u.tweets))));
    const emerging = users
      .filter((u) => (u.views / Math.max(1, u.tweets)) <= p50Views && u.er >= 0.03)
      .sort((a, b) => b.er - a.er);

    // 6️⃣ Distribution Insights
    const timeTxt = timeWindows.length
      ? timeWindows.map((x) => `${String(x.hour).padStart(2, "0")}:00 (ER p50 ${pct(x.er)})`).join(", ")
      : "—";

    // Header（严格对齐：三行括号 + 空行 + exec）
    const parts: string[] = [
      `${ticker} Weekly X Report`,
      `[ ${contractAddress} ]`,
      `[ ${fmtDate(data?.start_date)} ~ ${fmtDate(data?.end_date)} ]`,
      "",
      execSummary,
      "",
      "1️⃣ Executive Snapshot",
      "",
      snapshot,
      "",
      buildTop3Block("2️⃣ Verified Leaders ✅ (by top views)", verifiedLeaders),
      "",
      buildTop3Block("3️⃣ Shiller Leaderboard 🏆 (Overall Score)", withScore),
      "",
      buildTop3Block("4️⃣ Volume Grinders 🔁 (≥5 tweets)", grinders),
      "",
      buildTop3Block("5️⃣ Emerging 🌱 (low-view baseline, ER ≥ 3%)", emerging),
      "",
      "6️⃣ Distribution Insights 🚚",
      "",
      `- ⏰ Time-of-day lift windows: ${timeTxt}`,
      `- 🔵 Verified contribution trend: ${pct(verShare)} (level)`,
    ];

    return parts.join("\n");
  }, [rowsAll, data?.start_date, data?.end_date, data?.job_id, jobId, ticker, contractAddress, aggAll, verShare, users, timeWindows]);

  /** ===== handlers ===== */
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

  /** ===== render ===== */
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

        <div
          ref={panelRef}
          tabIndex={-1}
          className="analysis-console-body md:max-h-[70vh] overflow-y-auto p-5 text-[13px] leading-relaxed text-white/90"
          onWheelCapture={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {loading && <div className="text-white/60">Loading…</div>}
          {err && <div className="text-red-400">Error: {err}</div>}
          {!loading && !err && <pre className="whitespace-pre-wrap font-mono">{report}</pre>}
          <div className="mt-3 text-[11px] text-white/40">jobId: {data?.job_id || jobId || "-"}</div>
          <div className="mt-1 text-[11px] text-white/30">Source: @PolinaAIOS {deeplink}</div>
        </div>
      </div>
    </div>
  );
}
