// components/leaderboard/ProjectsRow.tsx
// Row layout (custom template columns): Rank | Project | Mkt Cap | Price | 1h | 24h | Vol (24h) | Age | Top Shillers | Followers | Type | Attention
// - Rank: wider with trophy for top 3.
// - Followers: compact integer (e.g., 123.4K). Falls back to sum of shillers' followers if project-level is missing.
// - Vol (24h): compact USD like $13.55M
// - Age: show "Xd" (days) or "<24h" details like "12h" if <1 day.

"use client";

import { useCallback, useState, useMemo } from "react";
import Image from "next/image";
import type { ProjectLeaderboardItem } from "./ProjectsLeaderboardClient";
import { Copy, Check, Trophy, Hourglass } from "lucide-react";

function shortCa(ca: string) {
  if (!ca) return "—";
  if (ca.length <= 10) return ca;
  return `${ca.slice(0, 4)}…${ca.slice(-4)}`;
}

function formatPct(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// Compact USD like $13.55M / $2.4B
function formatCompactUSD(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number, s: string) => `${sign}$${v.toFixed(2)}${s}`;
  if (abs >= 1e12) return fmt(abs / 1e12, "T");
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return `${sign}$${abs.toLocaleString()}`;
}

// Compact integer like 123.4K
function formatCompactInt(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number, s: string) => `${sign}${v.toFixed(1)}${s}`;
  if (abs >= 1e12) return fmt(abs / 1e12, "T");
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return `${sign}${abs.toLocaleString()}`;
}

// Age: prefer days; if < 1 day, show hours
function formatAge(days?: number | null): string {
  if (days == null || !isFinite(days)) return "—";
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30).toFixed(1)}m`;
  if (days >= 1) return `${Math.floor(days)}d`;
  const hours = Math.max(1, Math.floor(days * 24));
  return `${hours}h`;
}

// Build Twitter profile URL from handle (allow leading '@')
function twitterUrl(handle: string) {
  const h = handle.startsWith("@") ? handle.slice(1) : handle;
  return `https://twitter.com/${h}`;
}

// Type capsule colors (glowing)
function typeCapsuleClasses(type: ProjectLeaderboardItem["type"]) {
  if (type === "meme")
    return "text-fuchsia-200 bg-fuchsia-500/20 border-fuchsia-400/30 shadow-[0_0_12px_rgba(217,70,239,0.45)]";
  if (type === "utility")
    return "text-emerald-200 bg-emerald-500/20 border-emerald-400/30 shadow-[0_0_12px_rgba(16,185,129,0.45)]";
  return "text-white/80 bg-white/10 border-white/20 shadow-[0_0_10px_rgba(255,255,255,0.2)]";
}

export default function ProjectsRow({ item }: { item: ProjectLeaderboardItem }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.ca);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {
      // ignore
    }
  }, [item.ca]);

  const pct1h = useMemo(() => item.price_change_1h_pct ?? null, [item.price_change_1h_pct]);
  const pct24h = useMemo(() => item.price_change_24h_pct ?? null, [item.price_change_24h_pct]);

  const pct1hCls =
    pct1h == null ? "text-white/60" : pct1h > 0 ? "text-emerald-300" : pct1h < 0 ? "text-rose-300" : "text-white/80";
  const pct24hCls =
    pct24h == null ? "text-white/60" : pct24h > 0 ? "text-emerald-300" : pct24h < 0 ? "text-rose-300" : "text-white/80";

  // Followers: prefer project-level; fallback to sum of shillers' followers (if available)
  const followersCount = useMemo(() => {
    if (Number.isFinite(Number(item.followers_count))) return Number(item.followers_count);
    const s = item.top_shillers || [];
    const sum = s.reduce((acc, it) => acc + (Number.isFinite(Number(it.followers)) ? Number(it.followers) : 0), 0);
    return sum || 0;
  }, [item.followers_count, item.top_shillers]);

  // Rank cell: show trophy for top 3
  const rankNode =
    item.rank === 1 ? (
      <Trophy size={20} className="text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]" aria-label="1st place" />
    ) : item.rank === 2 ? (
      <Trophy size={20} className="text-slate-200 drop-shadow-[0_0_6px_rgba(226,232,240,0.5)]" aria-label="2nd place" />
    ) : item.rank === 3 ? (
      <Trophy size={20} className="text-amber-700 drop-shadow-[0_0_6px_rgba(180,83,9,0.5)]" aria-label="3rd place" />
    ) : (
      <span className="text-[13px] text-white/80 tabular-nums">{item.rank}</span>
    );

  return (
    <div className="grid [grid-template-columns:64px_1.6fr_0.9fr_0.8fr_0.6fr_0.6fr_0.9fr_0.6fr_2.0fr_0.9fr_0.9fr_0.9fr] items-center gap-2 px-3 py-3 hover:bg-white/5 transition">
      {/* Rank — wider cell with trophy for top 3 */}
      <div className="flex items-center justify-start">{rankNode}</div>

      {/* Project (image + ticker, short CA + copy icon) */}
      <div className="flex items-center gap-2">
        {item.image ? (
          <Image src={item.image} alt={`${item.ticker} logo`} width={28} height={28} className="rounded-full" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-white/10" aria-hidden />
        )}

        <div className="flex min-w-0 flex-col">
          <div className="truncate text-[13px] font-medium text-white leading-5">{item.ticker}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <code className="text-[12px] text-white/75">{shortCa(item.ca)}</code>
            <button
              onClick={onCopy}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              aria-label="Copy contract address"
              title={item.ca}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mkt Cap — compact */}
      <div className="text-[13px] text-white/90 tabular-nums">{formatCompactUSD(item.mcap_usd)}</div>

      {/* Price */}
      <div className="text-[13px] text-white/90 tabular-nums">
        {item.price_usd != null ? `$${item.price_usd.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : "—"}
      </div>

      {/* 1h % */}
      <div className={`text-[13px] tabular-nums ${pct1hCls}`}>{formatPct(pct1h ?? undefined)}</div>

      {/* 24h % */}
      <div className={`text-[13px] tabular-nums ${pct24hCls}`}>{formatPct(pct24h ?? undefined)}</div>

      {/* Vol (24h) — compact */}
      <div className="text-[13px] text-white/90 tabular-nums">{formatCompactUSD(item.volume_24h_usd ?? null)}</div>

      {/* Age */}
      <div className="text-[13px] text-white/80 tabular-nums">{formatAge(item.age_days ?? null)}</div>

      {/* Top Shillers — stacked (handle + views) */}
      <div>
        <div className="flex flex-col gap-1">
          {item.top_shillers.slice(0, 3).map((s, idx) => (
            <div key={`${s.handle}-${idx}`} className="flex items-center gap-2">
              {/* Placeholder avatar circle; you can swap to <Image> if you want to render real avatars */}
              {s.avatar ? (
                <img
                  src={s.avatar}
                  alt={`@${s.handle}`}
                  className="h-5 w-5 rounded-full border border-white/10 object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="h-5 w-5 rounded-full bg-white/10 border border-white/10"
                  aria-hidden
                  title={`@${s.handle}`}
                />
              )}
              <div className="min-w-0 leading-tight">
                <a
                  href={twitterUrl(s.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[12px] text-white/85 hover:text-white underline-offset-2 hover:underline"
                  title={`@${s.handle}`}
                >
                  @{s.handle}
                </a>
                <div className="text-[11px] text-white/50">{s.views.toLocaleString()} views</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Followers — "Coming soon" icon (keep column visible) */}
      <div className="text-left">
        <span
          className="inline-flex items-center gap-1 text-white/70"
          title="Followers — coming soon"
          aria-label="Followers coming soon"
        >
          <Hourglass className="h-4 w-4 opacity-80" />
          <span className="text-[12px]">soon</span>
        </span>
      </div>

      {/* Type — "Coming soon" icon (keep column visible) */}
      <div className="text-left">
        <span
          className="inline-flex items-center gap-1 text-white/70"
          title="Project type — coming soon"
          aria-label="Project type coming soon"
        >
          <Hourglass className="h-4 w-4 opacity-80" />
          <span className="text-[12px]">soon</span>
        </span>
      </div>

      {/* Attention — glowing emerald capsule */}
      <div className="text-right">
        <span
          className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full
                     text-[12px] font-semibold text-emerald-200
                     bg-emerald-500/20 border border-emerald-400/30
                     shadow-[0_0_12px_rgba(16,185,129,0.45)]"
          title="Attention Score"
        >
          {item.attention_score.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
