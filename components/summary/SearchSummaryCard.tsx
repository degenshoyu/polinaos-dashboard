"use client";

import React from "react";
import { Trophy } from "lucide-react";

type Agg = { tweets: number; views: number; engagements: number; er: number };

export type Shiller = {
  handle: string;
  views: number;
  tweets: number;
  likes: number;
  retweets: number;
  replies: number;
};

export default function SearchSummaryCard({
  ticker,
  startDate,
  endDate,
  contractAddress,
  marketCapUsd,
  volume24hUsd,
  createdAt,
  all,
  ver,
  topShillers,
  className = "",
}: {
  ticker: string;
  startDate?: string;
  endDate?: string;
  contractAddress?: string | null;
  marketCapUsd?: number;
  volume24hUsd?: number;
  createdAt?: string | number;
  all: Agg;
  ver: Agg;
  topShillers: Shiller[];
  className?: string;
}) {
  const fmtDate = (s?: string) => {
    if (!s) return "N/A";
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? s
      : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d);
  };

  const endMinusOne = (() => {
    if (!endDate) return undefined;
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) return endDate;
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  })();

  const compact = (v: number) =>
    new Intl.NumberFormat("en", { notation: "compact" }).format(v);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0d1412] via-[#0b100f] to-[#0a0f0e] shadow-2xl ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl"
      />
      <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10" />

      <div className="relative p-5 md:p-6">
        {/* Title */}
        <h3 className="text-lg md:text-xl font-extrabold tracking-tight">
          <span className="animated-gradient bg-clip-text text-transparent">
            {ticker} Weekly Performance on X
          </span>
        </h3>
        <div className="mt-1 text-xs md:text-sm text-white/70">
          {fmtDate(startDate)} - {fmtDate(endMinusOne)}
        </div>

        {/* CA */}
        <div className="mt-3 text-[12px] md:text-sm text-gray-300">
          <span className="text-gray-400">CA:&nbsp;</span>
          <span className="font-mono text-white/90 break-all">
            {contractAddress || "N/A"}
          </span>
        </div>

        {/* === 新增：紧跟在 CA 下方的链上数据 chips（参考 InputCard） === */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chip("MktCap", moneyShort(marketCapUsd))}
          {chip("24H Vol", moneyShort(volume24hUsd))}
          {chip("Age", ageText(createdAt))}
        </div>

        {/* All / Verified */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-wide text-emerald-300 font-semibold">
              Total Tweets
            </div>
            <div className="mt-1 text-3xl font-extrabold text-white">
              {compact(all.tweets)}
            </div>
            <ul className="mt-3 space-y-1.5">
              <MetricInline label="Impressions" value={compact(all.views)} />
              <MetricInline
                label="Engagements"
                value={compact(all.engagements)}
              />
              <MetricInline label="ER" value={pct(all.er)} highlight />
            </ul>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs uppercase tracking-wide text-emerald-300 font-semibold">
              Verified Tweets
            </div>
            <div className="mt-1 text-3xl font-extrabold text-white">
              {compact(ver.tweets)}
            </div>
            <ul className="mt-3 space-y-1.5">
              <MetricInline label="Impressions" value={compact(ver.views)} />
              <MetricInline
                label="Engagements"
                value={compact(ver.engagements)}
              />
              <MetricInline label="ER" value={pct(ver.er)} highlight />
            </ul>
          </div>
        </div>

        {/* Top shillers（同一行：奖杯徽章 + @username + 统计） */}
        <div className="mt-6">
          <div className="text-xs text-gray-400 mb-2">Top shillers</div>
          <ol className="space-y-2">
            {(topShillers || [])
              .slice(0, 3)
              .map((s, i) => (
                <li
                  key={`${s.handle}-${i}`}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* 奖杯徽章 */}
                    <TrophyBadge rank={(i + 1) as 1 | 2 | 3} />

                    {/* 用户名 + 统计一行展示 */}
                    <a
                      className="text-sm md:text-base text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
                      href={`https://x.com/${s.handle.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{s.handle.replace(/^@/, "")}
                    </a>

                    <div className="text-[12px] md:text-sm text-gray-300 flex items-center flex-wrap gap-x-3 gap-y-1">
                      <StatPill icon="👁" value={compact(s.views)} />
                      <StatPill icon="🐦" value={String(s.tweets)} />
                      <StatPill icon="❤️" value={compact(s.likes)} />
                      <StatPill icon="🔁" value={compact(s.retweets)} />
                      <StatPill icon="💬" value={compact(s.replies)} />
                    </div>
                  </div>
                </li>
              ))}
            {(!topShillers || topShillers.length === 0) && (
              <li className="text-sm text-gray-400">No shillers found</li>
            )}
          </ol>
        </div>
      </div>

      <style jsx>{`
        .animated-gradient {
          background-image: linear-gradient(
            90deg,
            #2fd480,
            #3ef2ac,
            #27a567,
            #2fd480
          );
          background-size: 300% 300%;
          animation: gradient-move 8s ease-in-out infinite;
        }
        @keyframes gradient-move {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
      `}</style>
    </div>
  );
}

/* =================== 辅助组件 =================== */

function TrophyBadge({ rank }: { rank: 1 | 2 | 3 }) {
  const scheme =
    rank === 1
      ? {
          grad: "from-amber-300 to-yellow-500",
          glow: "shadow-[0_0_26px_rgba(250,204,21,0.35)]",
          chip: "bg-amber-300 text-[#0a0f0e]",
        }
      : rank === 2
      ? {
          grad: "from-slate-200 to-slate-400",
          glow: "shadow-[0_0_24px_rgba(148,163,184,0.3)]",
          chip: "bg-slate-200 text-[#0a0f0e]",
        }
      : {
          grad: "from-orange-300 to-amber-500",
          glow: "shadow-[0_0_24px_rgba(251,146,60,0.3)]",
          chip: "bg-orange-300 text-[#0a0f0e]",
        };

  return (
    <span
      aria-label={`Rank ${rank}`}
      className={`relative inline-grid place-items-center h-10 w-10 md:h-11 md:w-11 rounded-full
                  bg-gradient-to-br ${scheme.grad} ring-1 ring-white/30 ${scheme.glow}`}
      title={`Rank ${rank}`}
    >
      <Trophy className="h-5 w-5 text-white drop-shadow" strokeWidth={2.4} />
      <span
        className={`absolute -top-1 -right-1 min-w-[1.1rem] h-5 px-1 rounded-full text-[10px] font-black
                    ring-1 ring-white/40 ${scheme.chip} grid place-items-center`}
      >
        {rank}
      </span>
    </span>
  );
}

function MetricInline({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5
        ${
          highlight
            ? "border-emerald-400/30 bg-emerald-400/10 shadow-[0_0_18px_rgba(16,185,129,0.15)]"
            : "border-white/10 bg-white/[0.03]"
        }`}
    >
      <span className={`${highlight ? "text-emerald-200 font-semibold" : "text-gray-400"}`}>
        {label}
      </span>
      <span className={`${highlight ? "text-white font-bold" : "text-white/90 font-semibold"}`}>
        {value}
      </span>
    </li>
  );
}

function StatPill({ icon, value }: { icon: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 whitespace-nowrap">
      <span>{icon}</span>
      <span className="text-white/90">{value}</span>
    </span>
  );
}

/* =================== 辅助方法（参考 InputCard） =================== */

// 与 InputCard 中逻辑一致：把任何 createdAt（秒/毫秒/ISO）规范化到 ISO 字符串
function normalizeCreatedAt(
  v: unknown,
  opts: { allowFutureDays?: number } = {}
): string | undefined {
  if (v == null) return undefined;

  const allowFutureDays = opts.allowFutureDays ?? 3;
  let ms: number | null = null;

  if (typeof v === "number") {
    ms = v < 2_000_000_000 ? v * 1000 : v;
  } else if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      ms = n < 2_000_000_000 ? n * 1000 : n;
    } else {
      const t = Date.parse(v);
      ms = Number.isNaN(t) ? null : t;
    }
  }

  if (ms == null || !Number.isFinite(ms)) return undefined;

  const now = Date.now();
  const maxFuture = now + allowFutureDays * 86400000;
  if (ms > maxFuture) return undefined;
  if (ms > now) ms = now;

  const min = Date.UTC(2013, 0, 1);
  if (ms < min) return undefined;

  return new Date(ms).toISOString();
}

function ageText(createdAt?: string | number) {
  const iso = normalizeCreatedAt(createdAt);
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days < 1) return "new";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  return `${months}mo${rest ? ` ${rest}d` : ""}`;
}

function moneyShort(v?: number) {
  if (typeof v !== "number" || !isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

// 复用的小徽章
function chip(label: string, value?: React.ReactNode) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.06] text-[11px] text-gray-300">
      <span className="text-gray-400">{label}:</span>
      <span className="text-gray-200">{value ?? "-"}</span>
    </span>
  );
}

