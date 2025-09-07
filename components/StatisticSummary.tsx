"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import TweeterShareCard, { MinimalTweet } from "@/components/TweeterShareCard";
import SearchSummaryCard, { Shiller } from "@/components/summary/SearchSummaryCard";
import TotalsCard from "@/components/summary/TotalsCard";
import {
  filterSpamTweets,
  resolveCAFromJob,
  resolveCoreFromJob,
  BASE58_STRICT,
} from "@/components/filters/spamDetection";

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
  start_date?: string;
  end_date?: string;
  keyword?: string[];
  max_tweets?: number;
  tweets_count?: number;
  tweets?: TweetRow[];
};

export default function StatisticSummary({
  jobId,
  className = "",
  marketCapUsd,
  volume24hUsd,
  createdAt,
}: {
  jobId: string | null;
  className?: string;
  marketCapUsd?: number;
  volume24hUsd?: number;
  createdAt?: string | number;
}) {
  const [data, setData] = useState<JobPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Screenshot UI state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const totalsRef = useRef<HTMLDivElement>(null);
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
  const rowsAllRaw = useMemo(() => (data?.tweets ?? []).map((t) => ({ ...t })), [data]);

  const coreTicker = useMemo(() => resolveCoreFromJob(data?.keyword), [data]);
  const tickerUpper = useMemo(() => {
    const t = (coreTicker || "ASSET").toString().toUpperCase();
    return `$${t}`;
  }, [coreTicker]);

  const contractAddress = useMemo(() => {
    const ca = resolveCAFromJob(data?.keyword, rowsAllRaw);
    // 若是 Base58（Solana）格式则展示；否则返回原字符串（有些地址可能带 pump 后缀作为展示）
    if (!ca) return null;
    if (BASE58_STRICT.test(ca)) return ca;
    return ca; // 非 base58 的也显示（例如 xxx...pump）
  }, [data, rowsAllRaw]);

  const rowsAll = useMemo(() => {
    const rules = {
      coreTicker: coreTicker ?? null,
      contractAddress: BASE58_STRICT.test(contractAddress || "") ? (contractAddress as string) : null,
      maxOtherTickers: 2,
    };
    return filterSpamTweets(rowsAllRaw, rules);
  }, [rowsAllRaw, coreTicker, contractAddress]);

  const spamDetected = useMemo(() => Math.max(0, rowsAllRaw.length - rowsAll.length), [rowsAllRaw, rowsAll]);
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

  /** ---------- Averages & Buckets per spec ---------- */
  const daysBetween = (a?: string, b?: string) => {
    if (!a || !b) return 1;
    const d1 = new Date(a);
    const d2 = new Date(b);
    const ok = !Number.isNaN(d1.getTime()) && !Number.isNaN(d2.getTime());
    if (!ok) return 1;
    const ms = Math.max(0, d2.getTime() - d1.getTime());
    const days = Math.floor(ms / 86400000) + 1; // inclusive
    return Math.max(1, days);
  };

  function computeAverages(
    rows: TweetRow[],
    totals: { tweets: number; views: number; engagements: number; er: number },
    start?: string,
    end?: string
  ) {
    const t = totals.tweets || 0;
    const d = daysBetween(start, end);
    const perTweetViews = t > 0 ? totals.views / t : 0;
    const perTweetEngs = t > 0 ? totals.engagements / t : 0;
    return {
      avgTweetsPerDay: totals.tweets / d,
      avgViewsPerTweet: perTweetViews,
      avgEngsPerTweet: perTweetEngs,
      avgER: perTweetViews > 0 ? perTweetEngs / perTweetViews : 0,
    };
  }

  function computeBuckets(rows: TweetRow[]) {
    const total = rows.length || 1;
    let er_lt1 = 0,
      er_1_2_5 = 0,
      er_2_5_5 = 0,
      er_gt5 = 0;
    let v_lt1k = 0,
      v_1k_2_5k = 0,
      v_2_5k_5k = 0,
      v_gt5k = 0;

    for (const r of rows) {
      const v = n(r.views);
      const e = n(r.likes) + n(r.retweets) + n(r.replies);
      const er = v > 0 ? e / v : 0;
      // ER buckets
      if (er < 0.01) er_lt1++;
      else if (er < 0.025) er_1_2_5++;
      else if (er <= 0.05) er_2_5_5++;
      else er_gt5++;
      // Views buckets
      if (v < 1000) v_lt1k++;
      else if (v <= 2500) v_1k_2_5k++;
      else if (v <= 5000) v_2_5k_5k++;
      else v_gt5k++;
    }
    const toShare = (x: number) => x / total;
    return {
      erShares: {
        lt1: toShare(er_lt1),
        _1_2_5: toShare(er_1_2_5),
        _2_5_5: toShare(er_2_5_5),
        gt5: toShare(er_gt5),
      },
      viewShares: {
        lt1k: toShare(v_lt1k),
        _1k_2_5k: toShare(v_1k_2_5k),
        _2_5k_5k: toShare(v_2_5k_5k),
        gt5k: toShare(v_gt5k),
      },
    };
  }

  const avgAll = useMemo(
    () => computeAverages(rowsAll, aggAll, data?.start_date, data?.end_date),
    [rowsAll, aggAll, data?.start_date, data?.end_date]
  );
  const avgVer = useMemo(
    () => computeAverages(rowsVerified, aggVer, data?.start_date, data?.end_date),
    [rowsVerified, aggVer, data?.start_date, data?.end_date]
  );
  const bucketsAll = useMemo(() => computeBuckets(rowsAll), [rowsAll]);
  const bucketsVer = useMemo(() => computeBuckets(rowsVerified), [rowsVerified]);

 /** Top shillers by views (overall, with tweets/likes/retweets/replies) */
  const topShillers: Shiller[] = useMemo(() => {
    const map = new Map<string, Shiller>();
    for (const t of rowsAll) {
      const h = (t.tweeter || "").replace(/^@/, "");
      if (!h) continue;
      const cur =
        map.get(h) ||
        { handle: h, views: 0, tweets: 0, likes: 0, retweets: 0, replies: 0 };
      cur.views += n(t.views);
      cur.tweets += 1;
      cur.likes += n((t as any).likes);
      cur.retweets += n((t as any).retweets);
      cur.replies += n((t as any).replies);
      map.set(h, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.views - a.views).slice(0, 3);
  }, [rowsAll]);

  /** ============ html-to-image Helpers ============ */
  async function saveNodeAsPng(node: HTMLElement | null, filename: string) {
    if (!node) throw new Error("Target element not found");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if ((document as any).fonts?.ready) {
      try {
        await (document as any).fonts.ready;
      } catch {}
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const baseUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: dpr,
      backgroundColor: "#0a0f0e",
      style: { backgroundColor: "#0a0f0e" },
      filter: (domNode) => {
        if (!(domNode instanceof Element)) return true;
        const tag = domNode.tagName;
        if (tag === "VIDEO" || tag === "CANVAS") return false;
        if (domNode instanceof Element && domNode.getAttribute("data-no-export") === "true") return false;
        return true;
      },
    });
    const finalUrl = await composeCanvasBrandFrame(baseUrl, dpr);
    const a = document.createElement("a");
    a.href = finalUrl;
    a.download = filename;
    a.click();
  }

  async function composeCanvasBrandFrame(basePngUrl: string, dpr: number): Promise<string> {
    const [img, logo] = await Promise.all([
      loadImage(basePngUrl),
      loadImage("/polina-icon.png").catch(() => null as any),
    ]);
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const W = img.width;

    const pad = clamp(Math.round(W * 0.045), 64, 128);
    const border = 0;
    const radius = 0;

    const logoSize = clamp(Math.round(W * 0.088), 112, 224);
    const brandFont = clamp(Math.round(W * 0.048), 36, 96);
    const linkFont = clamp(Math.round(W * 0.018), 20, 44);
    const lineH = Math.round(linkFont * 1.45);

    const lines = ["polinaos.com", "x.com/PolinaAIOS", "t.me/PolinaOSAI"];
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

    ctx.fillStyle = "#0a0f0e";
    roundedRect(ctx, 0.5, 0.5, width - 1, height - 1, radius);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = border;
    roundedRect(ctx, border / 2 + 0.5, border / 2 + 0.5, width - border - 1, height - border - 1, radius);
    ctx.stroke();

    const shotX = border + pad;
    const shotY = border + pad;
    ctx.drawImage(img, shotX, shotY);

    const footerTop = shotY + img.height + pad - 1;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(border + pad, footerTop);
    ctx.lineTo(width - border - pad, footerTop);
    ctx.stroke();

    const contentTop = footerTop + footerPadTop;
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
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font =
      `700 ${brandFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textBaseline = "middle";
    ctx.textAlign = "start";
    const brandTextX = logoX + logoSize + Math.round(pad * 0.5);
    const brandTextY = logoY + logoSize / 2;
    ctx.fillText("PolinaOS", brandTextX, brandTextY);

    ctx.font =
      `500 ${linkFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
    ctx.fillStyle = "rgba(229,231,235,0.9)";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const rightX = width - border - pad;
    const centerY = contentTop + footerContentH / 2;
    const startY = centerY - ((lines.length - 1) * lineH) / 2;
    lines.forEach((t, i) => {
      ctx.fillText(t, rightX, startY + i * lineH);
    });

    ctx.textAlign = "start";
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
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  }

  // (1) 分离导出：Summary / Totals
  async function saveSearchSummary() {
    return saveNodeAsPng(summaryRef.current, `summary-${jobId ?? "snapshot"}.png`);
  }
  async function saveTotals() {
    return saveNodeAsPng(totalsRef.current, `totals-${jobId ?? "snapshot"}.png`);
  }

  async function saveAll() {
    try {
      setSaving(true);
      setSaveMsg("Rendering…");
      await saveSearchSummary();
      await saveTotals();
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
          onClick={saveAll}
          disabled={!jobId || saving}
          className="px-3 py-1.5 rounded-md bg-gradient-to-r from-[#27a567] to-[#2fd480] text-white/90 font-semibold shadow disabled:opacity-50"
          title="Save summary & totals"
        >
          {saving ? "⏳ Saving…" : "📦 Save"}
        </button>
        <details className="relative">
          <summary className="list-none cursor-pointer px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80">
            ⋯
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-lg border border-white/10 bg-[#0e1413] shadow-xl p-2 z-20">
            <button
              onClick={saveSearchSummary}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              1 Save summary
            </button>
            <button
              onClick={saveTotals}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200"
            >
              2 Save totals
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
          {/* --- (1) New · Search Summary --- */}
          <div ref={summaryRef}>
            <SearchSummaryCard
              ticker={tickerUpper}
              startDate={data?.start_date}
              endDate={data?.end_date}
              contractAddress={contractAddress || null}
              all={{ tweets: aggAll.tweets, views: aggAll.views, engagements: aggAll.engagements, er: aggAll.er }}
              ver={{ tweets: aggVer.tweets, views: aggVer.views, engagements: aggVer.engagements, er: aggVer.er }}
              topShillers={topShillers}
              marketCapUsd={marketCapUsd}
              volume24hUsd={volume24hUsd}
              createdAt={createdAt}
            />
          </div>

          {/* --- (2) Totals --- */}
          <div ref={totalsRef}>
            <TotalsCard
              aggAll={aggAll}
              aggVer={aggVer}
              avgAll={avgAll}
              avgVer={avgVer}
              bucketsAll={bucketsAll}
              bucketsVer={bucketsVer}
            />
          </div>

          {/* --- (3/4/5) Tweeter share --- */}
          <div ref={tweeterShareRef}>
            <TweeterShareCard tweets={rowsAll} />
          </div>

          {/* --- Top tweets by views --- */}
          <div ref={topListRef} className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="text-xs text-gray-400 mb-3">Top tweets by views</div>
            <ul className="space-y-3">
              {rowsAll
                .slice()
                .sort((a, b) => n(b.views) - n(a.views))
                .slice(0, 8)
                .map((t, i) => (
                  <li
                    key={(t as any).tweetId ?? `${i}`}
                    className="p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>
                        #{i + 1} · {t.tweeter ?? "unknown"} {(t as any).isVerified ? "✓" : ""}
                      </span>
                      <span className="text-white/80">
                        👁 {compact(n(t.views))} · ❤ {compact(n((t as any).likes))}
                        {" · "}🔁 {compact(n((t as any).retweets))}
                        {" · "}💬 {compact(n((t as any).replies))}
                      </span>
                    </div>
                    <div className="text-sm text-gray-200 line-clamp-3">
                      {(t as any).textContent || "(no text)"}
                    </div>
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
