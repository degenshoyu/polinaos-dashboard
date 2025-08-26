// components/EmotionalLandscapeCard.tsx
"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

const card = "p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5";

type Props = {
  data: EmotionalLandscape;
  insight?: string | null;
  className?: string;
};

export default function EmotionalLandscapeCard({ data, insight, className }: Props) {
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenBuckets((s) => ({ ...s, [key]: !s[key] }));

  const ordered = data.buckets; // 后端已排好顺序：bullish → optimistic → neutral → concerned → bearish
  const totalPct = Math.max(1, ordered.reduce((s, b) => s + (b.sharePct || 0), 0));

  return (
    <div className={`flex flex-col gap-6 ${className || ""}`}>
      {/* ===== Card: Header + Insight ===== */}
      <div className={card}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Emotional Landscape
          </h2>
          <span className="text-[11px] text-white/50">Weighted by views & engagements</span>
        </div>

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

      {/* ===== Card: Buckets ===== */}
      <div className={card}>
        <h3 className="text-lg font-semibold mb-3">Buckets & Evidence</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {ordered.map((b) => {
            const k = b.label;
            const isOpen = !!openBuckets[k];
            return (
              <div
                key={k}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition overflow-hidden"
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

/* ===== UI subcomponents ===== */
function LegendPill({ label, pct }: { label: string; pct: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${borderFor(label)} text-[11px]`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${dotFor(label)}`} />
      <span className="capitalize text-gray-200">{titleFor(label)}</span>
      <span className="text-white/60">{pct}%</span>
    </span>
  );
}

function IntensityCell({ n, label }: { n: number; label: "low" | "mid" | "high" }) {
  const bg =
    label === "low" ? "bg-white/12" : label === "mid" ? "bg-white/20" : "bg-white/30";
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

/* ===== style helpers ===== */
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
