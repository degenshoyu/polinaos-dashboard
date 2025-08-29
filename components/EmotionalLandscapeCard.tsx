// components/EmotionalLandscapeCard.tsx
"use client";

import React, { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toPng } from "html-to-image";
import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

const card =
  "p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5";
const panel = "rounded-2xl border border-white/10 bg-white/5";

/** ========= Props ========= */
type Props = {
  data: EmotionalLandscape;
  insight?: string | null;
  className?: string;
  ticker?: string | null;
  contractAddress?: string | null;
};

export default function EmotionalLandscapeCard({
  data,
  insight,
  className,
  ticker,
  contractAddress,
}: Props) {
  // UI & state
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ticker" | "contract" | null>(null);

  // Refs for screenshot sections
  const wholeRef = useRef<HTMLDivElement>(null);
  // combined wrapper for spectrum + insight
  const heroRef = useRef<HTMLDivElement>(null);
  const bucketsRef = useRef<HTMLDivElement>(null);

  const toggle = (key: string) => setOpenBuckets((s) => ({ ...s, [key]: !s[key] }));

  const ordered = data.buckets;
  const totalPct = Math.max(1, ordered.reduce((s, b) => s + (b.sharePct || 0), 0));

  /** ========= Screenshot helpers ========= */
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
        if (domNode instanceof Element && domNode.getAttribute("data-no-export") === "true") {
          return false;
        }
        return true;
      },
    });

    const finalUrl = await composeCanvasBrandFrame(baseUrl, dpr);
    const a = document.createElement("a");
    a.href = finalUrl;
    a.download = filename;
    a.click();
  }

  async function saveFull() {
    return saveNodeAsPng(wholeRef.current, "emotional-landscape-full.png");
  }
  async function saveSpectrumInsight() {
    return saveNodeAsPng(heroRef.current, "emotional-spectrum-insight.png");
  }
  async function saveBuckets() {
    return saveNodeAsPng(bucketsRef.current, "emotional-buckets.png");
  }
  async function saveAll() {
    try {
      setSaving(true);
      setSaveMsg("Rendering…");
      await saveFull();
      await saveSpectrumInsight();
      await saveBuckets();
      setSaveMsg("Saved all ✅");
      setTimeout(() => setSaveMsg(null), 1600);
    } catch (e: any) {
      setSaveMsg(`Failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function copyText(s: string, which: "ticker" | "contract") {
    try {
      await navigator.clipboard.writeText(s);
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      window.prompt("Copy this:", s);
    }
  }

  /** ========= Header ========= */
  const header = (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Emotional Landscape
      </h2>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <button
          onClick={saveAll}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-gradient-to-r from-[#27a567] to-[#2fd480] text-white/90 font-semibold shadow disabled:opacity-50"
          title="Save all sections"
        >
          {saving ? "⏳ Saving…" : "📦 Save"}
        </button>

        <details className="relative" data-no-export="true">
          <summary className="list-none cursor-pointer px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80">
            ⋯
          </summary>
          <div className="absolute right-0 mt-2 w-60 rounded-lg border border-white/10 bg-[#0e1413] shadow-xl p-2 z-20">
            <button onClick={saveFull} className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200">
              1 Save full card
            </button>
            <button onClick={saveSpectrumInsight} className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200">
              2 Save spectrum + insight
            </button>
            <button onClick={saveBuckets} className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-white/5 text-gray-200">
              3 Save buckets
            </button>
          </div>
        </details>
      </div>
    </div>
  );

  return (
    <div ref={wholeRef} className={`flex flex-col gap-6 ${className || ""}`}>
      {/* ===== Card: Header + Spectrum + Insight ===== */}
      <div className={card}>
        {header}

        {/* Combined wrapper: Spectrum + Insight */}
        <div ref={heroRef}>
          {/* Spectrum */}
          <div className="mb-3">
            <div className="h-3 rounded-full bg-white/10 overflow-hidden flex">
              {ordered.map((b) => (
                <div
                  key={b.label}
                  className={`h-full ${colorFor(b.label)} transition-all`}
                  style={{ width: `${Math.max(0, Math.min(100, (b.sharePct / totalPct) * 100))}%` }}
                  title={`${titleFor(b.label)} · ${b.sharePct}%`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {ordered.map((b) => (
                <LegendPill key={b.label} label={b.label} pct={b.sharePct} />
              ))}
            </div>
          </div>

          {/* Insight */}
          {insight ? (
            <InsightCallout markdown={insight} />
          ) : (
            <p className="text-sm text-gray-400">
              No AI insight yet. The spectrum above reflects aggregate emotion; open a bucket below for details.
            </p>
          )}
        </div>

        {saveMsg && <div className="mt-3 text-xs text-gray-300">{saveMsg}</div>}
      </div>

      {/* ===== Card: Buckets ===== */}
      <div ref={bucketsRef} className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Buckets & Evidence</h3>
          <span className="text-[11px] text-white/50">Weighted by views & engagements</span>
        </div>

        {(ticker || contractAddress) && (
          <div className={`${panel} p-3 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3`}>
            {ticker && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Ticker</span>
                <span className="px-2 py-0.5 text-sm rounded-md border border-white/10 bg-white/10 text-emerald-200 font-mono">
                  {ticker}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(ticker, "ticker")}
                  className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80"
                  title="Copy ticker"
                >
                  {copied === "ticker" ? "Copied ✓" : "Copy"}
                </button>
              </div>
            )}
{contractAddress && (
  <div className="flex items-center gap-2">
    <span className="text-xs text-gray-400">Contract</span>
    <span className="px-2 py-0.5 text-xs md:text-[13px] rounded-md border border-white/10 bg-white/10 text-emerald-200 font-mono break-all">
      {shortenAddress(contractAddress)}
    </span>
    <button
      type="button"
      onClick={() => copyText(contractAddress, "contract")}
      className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80"
      title="Copy contract"
    >
      {copied === "contract" ? "Copied ✓" : "Copy"}
    </button>
  </div>
)}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {ordered.map((b) => {
            const k = b.label;
            const isOpen = !!openBuckets[k];
            return (
              <div
                key={k}
                className={`${panel} rounded-xl hover:bg-white/[0.07] transition overflow-hidden`}
              >
                <button
                  className="w-full text-left p-4 flex items-center justify-between"
                  onClick={() => toggle(k)}
                  aria-expanded={isOpen}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{iconFor(k)}</span>
                    <span className="capitalize text-white font-medium">{titleFor(k)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-md border border-white/10 bg-white/10 text-gray-200">
                      {b.sharePct}% · {b.count} tweets
                    </span>
                  </div>
                  <span className={`text-white/70 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4">
                    {/* Intensity */}
                    <div className="text-xs text-gray-400 mb-2">
                      intensity:
                      <IntensityCell n={b.intensity.low} label="low" />
                      <IntensityCell n={b.intensity.mid} label="mid" />
                      <IntensityCell n={b.intensity.high} label="high" />
                    </div>

                    {/* Keywords */}
                    {b.keywordsTop?.length ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {b.keywordsTop.slice(0, 8).map((t) => (
                          <span
                            key={t.term}
                            className="px-2 py-0.5 text-xs rounded-full bg-white/5 border border-white/10 text-gray-200"
                          >
                            {t.term} <span className="text-white/50">×{t.count}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Top tweets */}
                    <ul className="space-y-2">
                      {b.topTweets.slice(0, 3).map((t, i) => (
                        <li key={i} className="p-3 rounded-lg bg-black/20 border border-white/10">
                          <div className="flex items-center justify-between gap-2">
                            <a
                              className="text-sm underline text-emerald-300 hover:text-emerald-200 truncate"
                              href={t.statusLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              @{t.tweeter || "unknown"}
                            </a>
                            <span className="text-[11px] text-white/60 shrink-0">
                              L/R/Rp/V: {t.likes}/{t.retweets}/{t.replies}/{t.views}
                            </span>
                          </div>
                          <div className="text-sm text-white/80 mt-1 line-clamp-2">{t.textPreview}</div>
                        </li>
                      ))}
                      {!b.topTweets.length && (
                        <li className="text-sm text-white/50">No examples for this bucket.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footnote */}
        <div className="mt-4 text-xs text-white/40">
          Method: {data.method.version} · {data.method.weightFormula}
        </div>
      </div>
    </div>
  );
}

/** ========= Subcomponents ========= */
function LegendPill({ label, pct }: { label: string; pct: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${borderFor(label)} text-[11px]`}>
      <span className={`inline-block w-2 h-2 rounded-full ${dotFor(label)}`} />
      <span className="capitalize text-gray-200">{titleFor(label)}</span>
      <span className="text-white/60">{pct}%</span>
    </span>
  );
}

function IntensityCell({ n, label }: { n: number; label: "low" | "mid" | "high" }) {
  const bg = label === "low" ? "bg-white/12" : label === "mid" ? "bg-white/20" : "bg-white/30";
  return (
    <span className={`ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${bg} text-white/80`}>
      <span className="text-[11px]">{label}</span>
      <span className="text-[11px] font-mono">{n}</span>
    </span>
  );
}

function InsightCallout({ markdown }: { markdown: string }) {
  return (
    <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
      <div className="text-xs text-emerald-200/90 mb-1">Polina Insight</div>
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          components={{
            p: (p: any) => <p className="text-sm text-emerald-50/90 leading-relaxed mb-2" {...p} />,
            ul: (p: any) => <ul className="list-disc list-inside text-sm text-emerald-50/90 pl-4 my-1" {...p} />,
            ol: (p: any) => <ol className="list-decimal list-inside text-sm text-emerald-50/90 pl-4 my-1" {...p} />,
            li: (p: any) => <li className="mb-0.5" {...p} />,
            strong: (p: any) => <strong className="text-emerald-100 font-semibold" {...p} />,
            a: (p: any) => (
              <a className="text-emerald-200 underline underline-offset-2 hover:text-emerald-100" {...p} />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** ========= Style helpers ========= */
function iconFor(label: string) {
  switch (label) {
    case "bullish":
      return "🐂";
    case "bearish":
      return "🐻";
    case "optimistic":
      return "✨";
    case "concerned":
      return "⚠️";
    default:
      return "〰️";
  }
}
function titleFor(label: string) {
  switch (label) {
    case "bullish":
      return "bullish";
    case "bearish":
      return "bearish";
    case "optimistic":
      return "optimistic";
    case "concerned":
      return "concerned";
    default:
      return "neutral";
  }
}
function colorFor(label: string) {
  switch (label) {
    case "bullish":
      return "bg-gradient-to-r from-emerald-500/80 to-emerald-400/80";
    case "optimistic":
      return "bg-gradient-to-r from-teal-400/80 to-cyan-300/80";
    case "neutral":
      return "bg-gradient-to-r from-slate-400/70 to-slate-300/70";
    case "concerned":
      return "bg-gradient-to-r from-amber-400/80 to-yellow-300/80";
    case "bearish":
      return "bg-gradient-to-r from-rose-500/80 to-red-400/80";
    default:
      return "bg-white/30";
  }
}
function dotFor(label: string) {
  switch (label) {
    case "bullish":
      return "bg-emerald-400";
    case "optimistic":
      return "bg-cyan-300";
    case "neutral":
      return "bg-slate-300";
    case "concerned":
      return "bg-amber-300";
    case "bearish":
      return "bg-rose-400";
    default:
      return "bg-white/60";
  }
}
function borderFor(label: string) {
  switch (label) {
    case "bullish":
      return "border-emerald-400/30 bg-emerald-400/10";
    case "optimistic":
      return "border-cyan-300/30 bg-cyan-300/10";
    case "neutral":
      return "border-slate-300/30 bg-slate-300/10";
    case "concerned":
      return "border-amber-300/30 bg-amber-300/10";
    case "bearish":
      return "border-rose-400/30 bg-rose-400/10";
    default:
      return "border-white/10 bg-white/5";
  }
}

/** ========= Canvas Brand Frame ========= */
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

  const links = ["polinaos.com", "x.com/PolinaAIOS", "t.me/PolinaOSAI"];

  const footerPadTop = Math.round(pad * 0.5);
  const footerPadBottom = Math.round(pad * 0.5);
  const footerContentH = Math.max(logoSize, links.length * lineH);
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

  ctx.font = `700 ${brandFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "start";
  const brandTextX = logoX + logoSize + Math.round(pad * 0.5);
  const brandTextY = logoY + logoSize / 2;
  ctx.fillText("PolinaOS", brandTextX, brandTextY);

  ctx.font = `500 ${linkFont}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`;
  ctx.fillStyle = "rgba(229,231,235,0.9)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const rightX = width - border - pad;
  const firstY = contentTop + (footerContentH - links.length * lineH) / 2;
  links.forEach((t, i) => ctx.fillText(t, rightX, firstY + i * lineH));

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

function shortenAddress(addr?: string, head = 6, tail = 6): string {
  if (!addr) return "";
  const len = addr.length;
  if (len <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
