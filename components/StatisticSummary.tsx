// components/StatisticSummary.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import TweeterShareCard, { MinimalTweet, ShareMetric } from "@/components/TweeterShareCard";

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

  const cardRef = useRef<HTMLDivElement>(null);
  const summaryTotalsRef = useRef<HTMLDivElement>(null);
  const tweeterShareRef = useRef<HTMLDivElement>(null);
  const topListRef = useRef<HTMLDivElement>(null);

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

  // Let layout/fonts settle (double rAF), then wait for fonts if available
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if ((document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // 1) Snapshot ORIGINAL node (don’t move/clone DOM)
  const baseUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: dpr,
    // Ensure non-black export by forcing a white background:
    backgroundColor: "#0a0f0e",
    style: {
      backgroundColor: "#0a0f0e",
    },
    // Keep your filter if you had one:
    filter: (domNode) => {
      if (!(domNode instanceof Element)) return true;
      const tag = domNode.tagName;
      // skip <video> / <canvas> or anything you want to exclude
      if (tag === "VIDEO" || tag === "CANVAS") return false;
      // example: exclude elements with data-no-export
      if (domNode instanceof Element && domNode.getAttribute("data-no-export") === "true") {
        return false;
      }
      return true;
    },
  });

  // 2) Compose border + footer (logo + 3 lines) on a canvas
  const finalUrl = await composeCanvasBrandFrame(baseUrl, dpr);

  // 3) Download
  const a = document.createElement("a");
  a.href = finalUrl;
  a.download = filename;
  a.click();
}

async function renderShareCardOffscreen(metric: ShareMetric): Promise<string> {
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    left: "0-10000px",
    top: "0",
    pointerEvents: "none",
    background: "#0a0f0e",
    zIndex: "2147483647",
    // transform: "translateZ(0)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    [data-export-root] {
      display: inline-block;
      width: max-content;
      height: max-content;
      overflow: clip !important;
      box-sizing: border-box;
    }
    [data-export-root], [data-export-root] * { scrollbar-width: none !important; }
    [data-export-root]::-webkit-scrollbar,
    [data-export-root] *::-webkit-scrollbar { display: none !important; width:0 !important; height:0 !important; }
  `;
  host.appendChild(style)

  const root = createRoot(host);
  root.render(
    <div data-export-root>
      <TweeterShareCard tweets={rowsAll} metric={metric} />
    </div>
  );

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => requestAnimationFrame(r));
  if ((document as any).fonts?.ready) { try { await (document as any).fonts.ready; } catch {} }

  const target = host.querySelector("[data-export-root]") as HTMLElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const png = await toPng(host, {
    backgroundColor: "#0a0f0e",
    cacheBust: true,
    pixelRatio: dpr,
  });

  root.unmount();
  host.remove();
  return png;
}

async function exportShareMetric(metric: ShareMetric, filename: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const base = await renderShareCardOffscreen(metric);
  const final = await composeCanvasBrandFrame(base, dpr);
  const a = document.createElement("a");
  a.href = final;
  a.download = filename;
  a.click();
}

/** Draw a rounded border + footer (logo + 3 lines) around the base PNG without touching DOM */
async function composeCanvasBrandFrame(basePngUrl: string, dpr: number): Promise<string> {
  const [img, logo] = await Promise.all([
    loadImage(basePngUrl),
    // same-origin asset in /public
    loadImage("/polina-icon.png").catch(() => null as any),
  ]);

  // --- Scale rules (relative to width) ---
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const W = img.width;

  const pad = clamp(Math.round(W * 0.045), 64, 128);            // ~3% width
  const border = 0;         // ~0.15% width
  const radius = 0;        // ~1.2% width

  const logoSize = clamp(Math.round(W * 0.088), 112, 224);      // ~2.2% width
  const brandFont = clamp(Math.round(W * 0.048), 36, 96);    // ~0.75% width
  const linkFont = clamp(Math.round(W * 0.018), 20, 44);     // ~0.65% width
  const lineH = Math.round(linkFont * 1.45);                  // comfortable line height

  const lines = [
    "polinaos.com",
    "x.com/PolinaAIOS",
    "t.me/PolinaOSAI",
  ];

  const footerPadTop = Math.round(pad * 0.5);
  const footerPadBottom = Math.round(pad * 0.5);
  const footerContentH = Math.max(logoSize, lines.length * lineH);
  const footerH = footerPadTop + footerContentH + footerPadBottom;

  const width = img.width + pad * 2 + border * 2;
  const height = img.height + pad * 2 + footerH + border * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;

  // Background panel
  ctx.fillStyle = "#0a0f0e";
  roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, radius);
  ctx.fill();

  // Border (crisp stroke)
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = border;
  roundedRect(
    ctx,
    border / 2 + 0.5,
    border / 2 + 0.5,
    width - border - 1,
    height - border - 1,
    radius
  );
  ctx.stroke();

  // Main screenshot
  const shotX = border + pad;
  const shotY = border + pad;
  ctx.drawImage(img, shotX, shotY);

  // Footer separator
  const footerTop = shotY + img.height + pad - 1;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(border + pad, footerTop);
  ctx.lineTo(width - border - pad, footerTop);
  ctx.stroke();

  // Footer content
  const contentTop = footerTop + footerPadTop;

  // Left: circular logo + brand text (vertically centered with logo)
  const logoX = border + pad;
  const logoY = contentTop;

  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
  } else {
    // fallback circle if logo asset missing
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `700 ${brandFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "start";
  const brandTextX = logoX + logoSize + Math.round(pad * 0.5);
  const brandTextY = logoY + logoSize / 2;
  ctx.fillText("PolinaOS", brandTextX, brandTextY);

  // Right: 3 lines, right-aligned
ctx.font = `500 ${linkFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
ctx.fillStyle = "rgba(229,231,235,0.9)";
ctx.textAlign = "right";
ctx.textBaseline = "middle";

const rightX = width - border - pad;
const centerY = contentTop + footerContentH / 2;
const startY  = centerY - ((lines.length - 1) * lineH) / 2;

lines.forEach((t, i) => {
  ctx.fillText(t, rightX, startY + i * lineH);
});

ctx.textAlign = "start"

  return canvas.toDataURL("image/png");
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // data: URL 无需跨域；/logo-polina.png 同源也没问题
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

  // (1) Summary + Totals（一次性包含 Search summary + All totals + Verified totals）
  async function saveSummaryTotals() {
    return saveNodeAsPng(summaryTotalsRef.current, `summary-totals-${jobId ?? "snapshot"}.png`);
  }

  async function saveTweetsShare() {
    return exportShareMetric("tweets", `share-tweets-${jobId ?? "snapshot"}.png`);
  }
  async function saveViewsShare() {
    return exportShareMetric("views", `share-views-${jobId ?? "snapshot"}.png`);
  }
  async function saveEngShare() {
    return exportShareMetric("engagements", `share-engagements-${jobId ?? "snapshot"}.png`);
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

  /** Header **/
  const header = (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Statistic Summary
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
                <Tile color="#d8b4fe" label="Eng Rate" value={pctText(aggAll.er)} />
              </div>
            </div>

            {/* Verified tweets (tiles) */}
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-xs text-gray-400 mb-2">Verified tweets — totals</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile color="#3ef2ac" label="Tweets" value={compact(aggVer.tweets)} />
                <Tile color="#7dd3fc" label="Views" value={compact(aggVer.views)} />
                <Tile color="#fcd34d" label="Engagements" value={compact(aggVer.engagements)} />
                <Tile color="#d8b4fe" label="Eng Rate" value={pctText(aggVer.er)} />
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
  const isER = label.toLowerCase().includes("eng rate");
  return (
    <div
      className={`rounded-lg border border-white/10 px-3 py-2 ${
        isER
          ? "bg-gradient-to-r from-[#27a567]/40 to-[#2fd480]/40 shadow-lg shadow-emerald-500/20"
          : "bg-white/5"
      }`}
    >
      <div
        className={`text-[11px] text-left ${
          isER ? "text-emerald-300 font-semibold uppercase" : "text-gray-400"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 ${
          isER
            ? "text-lg font-bold bg-gradient-to-r from-[#2fd480] to-[#3ef2ac] text-transparent bg-clip-text"
            : "text-sm text-white font-semibold"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
