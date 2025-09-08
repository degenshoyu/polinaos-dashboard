"use client";

import React from "react";
import { Crown, Medal } from "lucide-react";
import CoinsChipList from "../admin/CoinsChipList";

export type CoinStat = { tokenKey: string; tokenDisplay: string; count: number };

function nCompact(n: number) {
  const num = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(num);
  } catch {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return String(num);
  }
}

function pct(engs: number, views: number) {
  if (!views) return "0.0%";
  const v = (engs / views) * 100;
  return `${v.toFixed(1)}%`;
}

export default function MobileRow({
  r,
  rank,
  totals,
  shills,
  coinsAll,
}: {
  r: any;
  rank: number;
  totals: { tweets: number; views: number; engs: number; er: number };
  shills: { tweets: number; views: number; engs: number; er: number };
  coinsAll: CoinStat[];
}) {
  const medal =
    rank === 1 ? <Crown size={16} className="text-yellow-300" /> :
    rank === 2 ? <Medal size={16} className="text-gray-300" /> :
    rank === 3 ? <Medal size={16} className="text-amber-500" /> : null;

  // 合并重复币种，保证 UI 稳定
  const coinsForUI = React.useMemo(() => {
    type CoinItem = { tokenKey: string; tokenDisplay: string; count: number };
    const m = new Map<string, CoinItem>();
    for (const c of coinsAll || []) {
      const keyRaw = (c.tokenKey || c.tokenDisplay || "").trim();
      if (!keyRaw) continue;
      const key = keyRaw.toLowerCase();
      const display = (c.tokenDisplay || c.tokenKey || "UNKNOWN").trim();
      const prev = m.get(key);
      if (prev) prev.count += Number(c.count || 0);
      else m.set(key, { tokenKey: key, tokenDisplay: display, count: Number(c.count || 0) });
    }
    const out = Array.from(m.values());
    out.sort((a, b) => (b.count - a.count) || a.tokenDisplay.localeCompare(b.tokenDisplay));
    return out;
  }, [coinsAll]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      {/* 顶部：头像 + 名称 + 排名徽章 */}
      <div className="flex items-center gap-3">
        <img
          src={r.profileImgUrl || "/favicon.ico"}
          alt={r.displayName || r.twitterUsername || "KOL"}
          className="h-10 w-10 rounded-full object-cover"
          loading="lazy"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={`https://x.com/${r.twitterUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm text-white hover:underline"
              title={r.bio || ""}
            >
              {r.displayName || r.twitterUsername}
            </a>
            {medal}
            <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-gray-300">
              #{rank}
            </span>
          </div>
          <div className="truncate text-xs text-gray-400">
            {nCompact(r.followers || 0)} followers
          </div>
        </div>
      </div>

      {/* 指标区：Total / Shills 两行 */}
      <div className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
        <div className="col-span-4 text-[11px] font-semibold text-white/90">Total</div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Tweets</div>
          <div className="tabular-nums text-white">{nCompact(totals.tweets)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Views</div>
          <div className="tabular-nums text-white">{nCompact(totals.views)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Engs</div>
          <div className="tabular-nums text-white">{nCompact(totals.engs)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">ER</div>
          <div className="tabular-nums text-white">{pct(totals.engs, totals.views)}</div>
        </div>

        <div className="col-span-4 mt-1 text-[11px] font-semibold text-white/90">Shills</div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Tweets</div>
          <div className="tabular-nums text-white">{nCompact(shills.tweets)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Views</div>
          <div className="tabular-nums text-white">{nCompact(shills.views)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">Engs</div>
          <div className="tabular-nums text-white">{nCompact(shills.engs)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-gray-400">ER</div>
          <div className="tabular-nums text-white">{pct(shills.engs, shills.views)}</div>
        </div>
      </div>

      {/* 币种 chips */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-gray-400">Top coins</div>
        <CoinsChipList coins={coinsForUI} max={5} />
      </div>
    </div>
  );
}

