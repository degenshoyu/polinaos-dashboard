// components/StatisticSummary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import TweeterShareCard, { MinimalTweet } from "@/components/TweeterShareCard";

/** Minimal Tweet type extracted from jobProxy payload */
type TweetRow = MinimalTweet & {
  tweetId: string;
  tweeter?: string;
  textContent?: string;
  datetime?: string; // ISO
  statusLink?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  isVerified?: boolean;
};

type JobPayload = {
  job_id: string;
  status: string; // "completed" | "running" | ...
  start_date?: string; // e.g. "2025-08-09"
  end_date?: string;   // e.g. "2025-08-17"
  keyword?: string[];
  max_tweets?: number;
  tweets_count?: number;
  tweets?: TweetRow[];
};

export default function StatisticSummary({
  jobId,
  className = "",
}: {
  jobId: string | null;
  className?: string;
}) {
  const [data, setData] = useState<JobPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Screenshot UI state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Refs（精准截图，不改原有视觉）
  const cardRef = useRef<HTMLDivElement>(null);               // 整体卡片（备用）
  const summaryTotalsRef = useRef<HTMLDivElement>(null);      // Search summary + All totals + Verified totals
  const tweeterShareRef = useRef<HTMLDivElement>(null);       // TweeterShareCard 外层
  const topListRef = useRef<HTMLDivElement>(null);            // Top tweets（不参与截图，仅保留）

  // Auto-fetch when jobId changes
  useEffect(() => {
    if (!jobId) {
      setData(null);
      return;
    }
    fetchNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function fetchNow() {
    if (!jobId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/jobProxy?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const j = (await r.json()) as JobPayload;
      if (!r.ok) throw new Error((j as any)?.error || r.statusText);
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to fetch job data");
    } finally {
      setLoading(false);
    }
  }

  /** Helpers */
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v);
  const pctText = (v: number) => `${(v * 100).toFixed(1)}%`;
  const fmtDate = (s?: string) => {
    if (!s) return "N/A";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d);
  };

  /** Base arrays */
  const rowsAll = useMemo(() => (data?.tweets ?? []).map((t) => ({ ...t })), [data]);
  const rowsVerified = useMemo(() => rowsAll.filter((t) => t.isVerified), [rowsAll]);

  /** Aggregates for All */
  const aggAll = useMemo(() => {
    const tweets = rowsAll.length;
    const views = rowsAll.reduce((s, t) => s + n(t.views), 0);
    const engagements = rowsAll.reduce((s, t) => s + n(t.likes) + n(t.retweets) + n(t.replies), 0);
    const er = views > 0 ? engagements / views : 0;
    return { tweets, views, engagements, er };
  }, [rowsAll]);

  /** Aggregates for Verified */
  const aggVer = useMemo(() => {
    const tweets = rowsVerified.length;
    const views = rowsVerified.reduce((s, t) => s + n(t.views), 0);
    const engagements = rowsVerified.reduce((s, t) => s + n(t.likes) + n(t.retweets) + n(t.replies), 0);
    const er = views > 0 ? engagements / views : 0;
    return { tweets, views, engagements, er };
  }, [rowsVerified]);

  /** ============ html-to-image Helpers ============ */
  async function saveNodeAsPng(node: HTMLElement | null, filename: string) {
    if (!node) throw new Error("Target element not found");
    await new Promise((r) => setTimeout(r, 30)); // 等一小帧，避免布局未稳

    const dataUrl = await toPng(node, {
      backgroundColor: "#0a0f0e",
      cacheBust: true,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      // 关键：filter 对 Node 做类型守卫，避免 "parameter 1 is not of type 'Element'"。
      filter: (domNode) => {
        if (!(domNode instanceof Element)) return true;
        const tag = domNode.tagName;
        if (tag === "IFRAME" || tag === "VIDEO") return false;
        const st = getComputedStyle(domNode);
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
        return true;
      },
      style: {
        transform: "scale(1)",
        transformOrigin: "top left",
      },
    });

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  // (1) Summary + Totals（一次性包含 Search summary + All totals + Verified totals）
  async function saveSummaryTotals() {
    return saveNodeAsPng(summaryTotalsRef.current, `summary-totals-${jobId ?? "snapshot"}.png`);
  }

  // (2/3/4) TweeterShareCard 内部三图：若你的组件根节点有 data-section（建议加），则更精准；否则退化为整卡
  function pickShareSection(selector: string) {
    const root = tweeterShareRef.current;
    if (!root) return null;
    const el = root.querySelector<HTMLElement>(selector);
    return el || root;
  }
  async function saveTweetsShare() {
    return saveNodeAsPng(pickShareSection('[data-section="tweets-share"]'), `share-tweets-${jobId ?? "snapshot"}.png`);
  }
  async function saveViewsShare() {
    return saveNodeAsPng(pickShareSection('[data-section="views-share"]'), `share-views-${jobId ?? "snapshot"}.png`);
  }
  async function saveEngShare() {
    return saveNodeAsPng(pickShareSection('[data-section="engagements-share"]'), `share-engagements-${jobId ?? "snapshot"}.png`);
  }

  async function saveAllFour() {
    try {
      setSaving(true);
      setSaveMsg("Rendering…");
      await saveSummaryTotals();
      await saveTweetsShare();
      await saveViewsShare();
      await saveEngShare();
      setSaveMsg("Saved all ✅");
      setTimeout(() => setSaveMsg(null), 1600);
    } catch (e: any) {
      setSaveMsg(`Failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  /** Header（主按钮 + 折叠菜单） */
  const header = (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Statistic · Summary
      </h2>
      <div className="flex items-center gap-2 text-xs text-gray-400">

        <button
          onClick={fetchNow}
          disabled={!jobId || loading}
          className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 disabled:opacity-50"
          title="Refresh"
        >
          ↻ Refresh
        </button>

        <button
          onClick={saveAllFour}
          disabled={!jobId || saving}
          className="px-3 py-1.5 rounded-md bg-gradient-to-r from-[#27a567] to-[#2fd480] text-white/90 font-semibold shadow disabled:opacity-50"
          title="Save all 4 images"
        >
          {saving ? "⏳ Saving…" : "📦 Save"}
        </button>

        <details className="relative">
          <summary className="list-none cursor-pointer px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80">
            ⋯
          </summary>
          <div className="absolute right-0 mt-2 w-60 rounded-lg border border-white/10 bg-[#0e1413] shadow-xl p-2 z-20">
            <button
              onClick={saveSummaryTotals}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              1 Save summary / totals
            </button>
            <button
              onClick={saveTweetsShare}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              2 Save tweets share
            </button>
            <button
              onClick={saveViewsShare}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              3 Save views share
            </button>
            <button
              onClick={saveEngShare}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              4 Save engagements share
            </button>
          </div>
        </details>
      </div>
    </div>
  );

  if (!jobId) {
    return (
      <div
        ref={cardRef}
        className={`p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 ${className}`}
      >
        {header}
        <p className="text-sm text-gray-400">Run a scan to see statistics here.</p>
        {saveMsg && <div className="mt-2 text-xs text-gray-300">{saveMsg}</div>}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 ${className}`}
    >
      {header}

      {loading && <p className="text-sm text-gray-400">Loading job data…</p>}
      {err && <p className="text-sm text-rose-300">Error: {err}</p>}

      {!loading && !err && data?.status !== "completed" && (
        <p className="text-sm text-gray-400">
          Job status: {data?.status ?? "unknown"} — stats will populate after completion.
        </p>
      )}

      {!loading && !err && rowsAll.length > 0 && (
        <div className="grid grid-cols-1 gap-6">
          {/* --- (1) Search summary + All totals + Verified totals：外层包一层，方便一起截图 --- */}
          <div ref={summaryTotalsRef} className="grid grid-cols-1 gap-6">
            {/* Search summary */}
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-xs text-gray-400 mb-2">Search summary</div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-gray-400">Search window: </span>
                  <span className="text-white/80">{fmtDate(data?.start_date)} → {fmtDate(data?.end_date)}</span>
                </div>
                {Array.isArray(data?.keyword) && data!.keyword!.length > 0 && (
                  <div>
                    <span className="text-gray-400">Keywords: </span>
                    <span className="text-white/80 break-all">{data!.keyword!.join(", ")}</span>
                  </div>
                )}
                {typeof data?.tweets_count === "number" && (
                  <div>
                    <span className="text-gray-400">Tweets fetched: </span>
                    <span className="text-white/80">{compact(data!.tweets_count!)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* All tweets (tiles) */}
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-xs text-gray-400 mb-2">All tweets — totals</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile color="#3ef2ac" label="Tweets" value={compact(aggAll.tweets)} />
                <Tile color="#7dd3fc" label="Views" value={compact(aggAll.views)} />
                <Tile color="#fcd34d" label="Engagements" value={compact(aggAll.engagements)} />
                <Tile color="#d8b4fe" label="Engagement Rate" value={pctText(aggAll.er)} />
              </div>
            </div>

            {/* Verified tweets (tiles) */}
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-xs text-gray-400 mb-2">Verified tweets — totals</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile color="#3ef2ac" label="Tweets" value={compact(aggVer.tweets)} />
                <Tile color="#7dd3fc" label="Views" value={compact(aggVer.views)} />
                <Tile color="#fcd34d" label="Engagements" value={compact(aggVer.engagements)} />
                <Tile color="#d8b4fe" label="Engagement Rate" value={pctText(aggVer.er)} />
              </div>
            </div>
          </div>

          {/* --- (2/3/4) Tweeter share：不改组件，只外层包 ref；如组件内部能加 data-section 更佳 --- */}
          <div ref={tweeterShareRef}>
            <TweeterShareCard tweets={rowsAll} />
          </div>

          {/* --- Top tweets by views（页面展示保留；按你的要求不参与截图） --- */}
          <div ref={topListRef} className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs text-gray-400 mb-3">Top tweets by views</div>
            <ul className="space-y-3">
              {rowsAll
                .slice()
                .sort((a, b) => (n(b.views) - n(a.views)))
                .slice(0, 8)
                .map((t, i) => (
                  <li key={(t as any).tweetId ?? `${i}`} className="p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>#{i + 1} · {t.tweeter ?? "unknown"} {(t as any).isVerified ? "✓" : ""}</span>
                      <span className="text-white/80">
                        👁 {compact(n(t.views))} · ❤ {compact(n((t as any).likes))}
                        {" · "}🔁 {compact(n((t as any).retweets))}
                        {" · "}💬 {compact(n((t as any).replies))}
                      </span>
                    </div>
                    <div className="text-sm text-gray-200 line-clamp-3">{(t as any).textContent || "(no text)"}</div>
                    {(t as any).statusLink && (
                      <a
                        href={(t as any).statusLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2 text-xs mt-1 inline-block break-all"
                      >
                        Open on X
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {saveMsg && <div className="mt-3 text-xs text-gray-300">{saveMsg}</div>}
    </div>
  );
}

/** Small KPI tile */
function Tile({ color, label, value }: { color: string; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
        <span className="text-[11px] text-gray-400">{label}</span>
      </div>
      <div className="mt-1 text-sm text-white font-semibold">{value}</div>
    </div>
  );
}
