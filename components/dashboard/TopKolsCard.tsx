// components/dashboard/TopKolsCard.tsx
"use client";

/**
 * Top KOLs card with expandable row preview (parity with Top Coins card).
 * - Two metrics only: Avg ROI | Efficiency (0..1)
 * - Mobile-first: handle truncation, follower capsule stays on the same line.
 * - Expandable popup shows:
 *   1) CT Activity (Tweets≈Shills, Shill Coins, Shill Views, Shill Engs)
 *   2) Top Shills (up to 3): $TICKER, MAX ROI, current MktCap
 * - Lazy-load per KOL detail via /api/kols/top-shills?handle=...&days=...
 */

import * as React from "react";
import { Users } from "lucide-react";
import clsx from "clsx";
import { HandlePill, rankEmoji, fmtCompact, fmtPct, AvatarCircle, TickerPill } from "./LeaderboardBits";

type KolRow = { handle: string; avatarUrl: string | null; followers: number; value: number };

export type TopKolsData = {
  avgRoi: KolRow[];
  coinShills: KolRow[]; // posts about coins (we treat as "Tweets≈Shills" for now)
  coinsViews: KolRow[];
  coinsEngs: KolRow[];
};

type Metric = "avgRoi" | "efficiency";

// ---- detail types for popup ----
type KolTopItem = {
  tokenKey: string;
  tokenDisplay?: string | null;
  contractAddress?: string | null;
  maxRoi?: number | null;       // 0..?
  marketCapUsd?: number | null; // current market cap USD
};
type ActivitySummary = { tweets: number; shillCoins: number; shillViews: number; shillEngs: number };
type KolDetail = { items: KolTopItem[]; activity?: ActivitySummary };

export default function TopKolsCard({ days, data }: { days: 7 | 30; data: TopKolsData }) {
  const [metric, setMetric] = React.useState<Metric>("avgRoi");

  // State for row popup
  const [openId, setOpenId] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Lazy preview states & a tiny in-memory queue to avoid burst
  const [previews, setPreviews] = React.useState<Record<string, { loading: boolean; data?: KolDetail | null }>>({});
  const inflightRef = React.useRef<Record<string, boolean>>({});
  const queueRef = React.useRef<Array<{ id: string; handle: string }>>([]);
  const runningRef = React.useRef(false);

  // Close popup when clicking outside
  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Close on ESC
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset open row when metric or range changes
  React.useEffect(() => setOpenId(null), [metric, days]);

  // --- Compute Efficiency (client-side) ---
  // Merge three leaderboards by handle, normalize with log1p -> minmax, then weighted sum.
  const effRows = React.useMemo(() => {
    type Acc = { handle: string; avatarUrl: string | null; followers: number; shills: number; views: number; engs: number };
    const m = new Map<string, Acc>();
    const upsert = (arr: KolRow[] | undefined, key: "shills" | "views" | "engs") => {
      for (const r of arr || []) {
        const cur = m.get(r.handle) ?? {
          handle: r.handle,
          avatarUrl: r.avatarUrl ?? null,
          followers: r.followers ?? 0,
          shills: 0, views: 0, engs: 0,
        };
        // Keep richer avatar/followers data if any list provides it
        if (!cur.avatarUrl && r.avatarUrl) cur.avatarUrl = r.avatarUrl;
        if ((cur.followers ?? 0) < (r.followers ?? 0)) cur.followers = r.followers ?? 0;
        cur[key] = (cur[key] ?? 0) + (r.value ?? 0);
        m.set(r.handle, cur);
      }
    };
    upsert(data.coinShills, "shills");
    upsert(data.coinsViews, "views");
    upsert(data.coinsEngs, "engs");

    const rows = Array.from(m.values());
    if (rows.length === 0) return [] as KolRow[];

    // log1p then min-max
    const arrS = rows.map((x) => Math.log1p(Math.max(0, x.shills)));
    const arrV = rows.map((x) => Math.log1p(Math.max(0, x.views)));
    const arrE = rows.map((x) => Math.log1p(Math.max(0, x.engs)));
    const mm = (arr: number[]) => {
      const min = Math.min(...arr), max = Math.max(...arr);
      if (!isFinite(min) || !isFinite(max) || max === min) return arr.map(() => 0);
      const d = max - min; return arr.map((v) => (v - min) / d);
    };
    const nS = mm(arrS), nV = mm(arrV), nE = mm(arrE);

    // Weights: Views 0.50, Engs 0.30, Shills 0.20
    const W = { s: 0.20, v: 0.50, e: 0.30 };

    const out: KolRow[] = rows
      .map((x, i) => ({
        handle: x.handle,
        avatarUrl: x.avatarUrl,
        followers: x.followers,
        value: W.s * nS[i] + W.v * nV[i] + W.e * nE[i], // 0..1
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    return out;
  }, [data.coinShills, data.coinsViews, data.coinsEngs]);

  const rows = React.useMemo(() => {
    return metric === "avgRoi" ? (data.avgRoi || []).slice(0, 10) : effRows;
  }, [metric, data.avgRoi, effRows]);

  const metricLabel = (k: Metric) => (k === "avgRoi" ? "Avg ROI" : "Efficiency");
  const rightValue = (r: KolRow) => (metric === "avgRoi" ? fmtPct(r.value) : r.value.toFixed(2));

  // Build an activity map per KOL from the three lists
  const activityMap = React.useMemo(() => {
    const m = new Map<string, { shills: number; views: number; engs: number }>();
    const add = (arr: KolRow[] | undefined, key: "shills" | "views" | "engs") => {
      for (const r of arr || []) {
        const cur = m.get(r.handle) ?? { shills: 0, views: 0, engs: 0 };
        cur[key] += Number(r.value || 0);
        m.set(r.handle, cur);
      }
    };
    add(data.coinShills, "shills");
    add(data.coinsViews, "views");
    add(data.coinsEngs, "engs");
    return m;
  }, [data.coinShills, data.coinsViews, data.coinsEngs]);

  // Queue & fetch detail lazily
  const enqueuePreview = React.useCallback((id: string, handle: string) => {
    if (inflightRef.current[id]) return;
    if (previews[id]?.data) return;
    inflightRef.current[id] = true;
    queueRef.current.push({ id, handle });
    (async function run() {
      if (runningRef.current) return;
      runningRef.current = true;
      const sleep = (ms:number)=>new Promise(res=>setTimeout(res, ms));
      while (queueRef.current.length) {
        const { id: curId, handle: curHandle } = queueRef.current.shift()!;
        setPreviews((m) => ({ ...m, [curId]: { loading: true, data: m[curId]?.data } }));
        const data = await fetchKolDetails(curHandle, days).catch(() => null);
        setPreviews((m) => ({ ...m, [curId]: { loading: false, data: data ?? m[curId]?.data } }));
        inflightRef.current[curId] = false;
        await sleep(220); // tiny gap for smoother UI
      }
      runningRef.current = false;
    })();
  }, [days, previews]);

  const toggleRow = (id: string) => setOpenId((prev) => (prev === id ? null : id));
  const onKeyToggle: React.KeyboardEventHandler = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const id = (e.currentTarget as HTMLElement).getAttribute("data-id");
      if (id) toggleRow(id);
    }
  };

  return (
    <div
      ref={rootRef}
      className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
    >
      {/* Glow accent */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
        }}
        aria-hidden
      />

      {/* Header */}
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-[18px] w-[18px] text-emerald-300" />
          <div className="font-medium">
            Top KOLs <span className="opacity-70">({days}d)</span>
          </div>
        </div>

        {/* Metric tabs (only two) */}
        <div className="flex items-center gap-2">
          {(["avgRoi", "efficiency"] as const).map((k) => {
            const active = metric === k;
            return (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={clsx(
                  "text-xs rounded-full px-2.5 py-1 border transition-colors",
                  active ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-gray-300 hover:bg-white/5"
                )}
              >
                {metricLabel(k)}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No data for this metric.</div>
      ) : (
        <ul className="relative space-y-2 text-sm">
          {rows.map((r, idx) => (
            <li key={r.handle} className="relative">
              {/* Row head (click to toggle / hover to preview) */}
              <div
                role="button"
                tabIndex={0}
                data-id={r.handle}
                onClick={() => toggleRow(r.handle)}
                onKeyDown={onKeyToggle}
                className={clsx(
                  "group/row flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-1.5 sm:gap-0",
                  "rounded-xl border border-white/10 px-3 py-2 bg-black/30",
                  "transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5",
                  "hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                )}
                onMouseEnter={() => enqueuePreview(r.handle, r.handle)}
                onFocus={() => enqueuePreview(r.handle, r.handle)}
                aria-expanded={openId === r.handle}
                aria-controls={`kol-popup-${r.handle}`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 w-full">
                  {/* Avatar on the far left (larger, does not change row height) */}
                  <AvatarCircle src={r.avatarUrl ?? undefined} sizePx={24} />

                  {/* Rank medal / index */}
                  <span className="w-6 sm:w-8 text-center">{rankEmoji(idx)}</span>

                  {/* @handle pill (no avatar inside), truncation on mobile */}
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <HandlePill
                      handle={r.handle}
                      href={`https://x.com/${r.handle}`}
                      className="min-w-0 flex-1 truncate max-w-[58vw] sm:max-w-none"
                    />
                    {/* Followers capsule (unified style) */}
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.06]
                                 px-1.5 py-0.5 text-[10px] text-white/90 tabular-nums shrink-0 whitespace-nowrap"
                      title="Followers"
                    >
                      <span className="sm:hidden text-gray-300/90">Fols</span>
                      <span className="hidden sm:inline text-gray-300/90">Followers</span>
                      <span>{fmtCompact(r.followers)}</span>
                    </span>
                  </div>
                </div>

                {/* Right metric (center on mobile) */}
                <span className="tabular-nums text-gray-200 font-semibold self-center sm:self-auto text-center whitespace-nowrap">
                  {metric === "avgRoi" ? rightValue(r) : `score ${rightValue(r)}`}
                </span>
              </div>

              {/* Popup (hover + pinned) */}
              <div
                id={`kol-popup-${r.handle}`}
                data-open={openId === r.handle ? "true" : "false"}
                className={clsx(
                  "absolute left-0 right-0 top-[calc(100%+6px)] z-30",
                  "invisible opacity-0 translate-y-1",
                  "group-hover/row:visible group-hover/row:opacity-100 group-hover/row:translate-y-0",
                  "data-[open=true]:visible data-[open=true]:opacity-100 data-[open=true]:translate-y-0",
                  "transition-all duration-200"
                )}
                onMouseEnter={() => enqueuePreview(r.handle, r.handle)}
                onFocus={() => enqueuePreview(r.handle, r.handle)}
              >
                <div
                  className={clsx(
                    "relative overflow-hidden rounded-2xl border border-white/12 backdrop-blur-xl px-4 py-3",
                    "bg-[linear-gradient(135deg,rgba(20,34,32,0.96),rgba(12,19,18,0.96))]",
                    "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                  )}
                >
                  {/* soft radial tint */}
                  <div
                    className="pointer-events-none absolute -inset-px rounded-2xl opacity-80"
                    style={{
                      background:
                        "radial-gradient(120% 80% at 0% 0%, rgba(47,212,128,0.18) 0%, rgba(62,242,172,0.10) 35%, transparent 70%)",
                    }}
                    aria-hidden
                  />

                  {/* CT Activity */}
                  <div className="mt-1">
                    <div className="text-[11px] text-gray-400 mb-1">CT Activity</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Tweets ≈ Shills (until backend provides separate tweet count) */}
                      {chip("Tweets", fmtCompact(previews[r.handle]?.data?.activity?.tweets ?? activityMap.get(r.handle)?.shills ?? 0))}
                      {chip("Shill Coins", fmtCompact(previews[r.handle]?.data?.activity?.shillCoins ?? 0))}
                      {chip("Shill Views", fmtCompact(previews[r.handle]?.data?.activity?.shillViews ?? activityMap.get(r.handle)?.views ?? 0))}
                      {chip("Shill Engs", fmtCompact(previews[r.handle]?.data?.activity?.shillEngs ?? activityMap.get(r.handle)?.engs ?? 0))}
                    </div>
                  </div>

                  {/* Top Shills (lazy) */}
                  <KolTopShills
                    loading={!!previews[r.handle]?.loading}
                    items={(previews[r.handle]?.data?.items || []).slice(0, 3)}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- popup blocks ---------- */

function chip(label: string, value: React.ReactNode) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.08] px-2 py-1 text-[11px] text-white/90">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums">{value ?? "-"}</span>
    </span>
  );
}

function KolTopShills({ loading, items }: { loading: boolean; items: KolTopItem[] }) {
  return (
    <div className="relative mt-3">
      <div className="text-[11px] text-gray-400 mb-1">Top Shills</div>
      {loading && <div className="text-[11px] text-gray-400">Loading…</div>}
      {!loading && items.length === 0 && <div className="text-[11px] text-gray-400">No shill data.</div>}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li
              key={`${it.tokenKey}-${it.contractAddress || i}`}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 text-center text-[13px]">{rankEmoji(i)}</span>
                <TickerPill text={`$${it.tokenDisplay?.replace(/^\$+/, "").toUpperCase() || it.tokenKey}`} />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-300 shrink-0">
                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 tabular-nums">
                  <span className="text-gray-400">MAX ROI</span>
                  <span>{Number.isFinite(Number(it.maxRoi)) ? fmtPct(Number(it.maxRoi)) : "-"}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */

function moneyShort(v?: number | null) {
  if (typeof v !== "number" || !isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

async function fetchKolDetails(handle: string, days: 7 | 30): Promise<KolDetail | null> {
  try {
    const qs = new URLSearchParams({ handle, days: String(days) });
    const r = await fetch(`/api/kols/top-shills?${qs.toString()}`, { headers: { "cache-control": "no-store" } });
    if (!r.ok) return null;
    const j = await r.json();
  const items = Array.isArray(j?.items) ? j.items : [];
  const activity: ActivitySummary | undefined = j?.activity
    ? {
        tweets: Number(j.activity.tweets ?? 0),
        shillCoins: Number(j.activity.shillCoins ?? 0),
        shillViews: Number(j.activity.shillViews ?? 0),
        shillEngs: Number(j.activity.shillEngs ?? 0),
      }
    : undefined;
  return { items, activity };
  } catch {
    return null;
  }
}
