// components/TweeterShareCard.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export type ShareMetric = "tweets" | "views" | "engagements" | "likes";

/** Fields we may receive for each tweet (superset to be flexible). */
export type MinimalTweet = {
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  // Optional extras if available from payload:
  tweetId?: string;
  statusLink?: string;
  textContent?: string;
  isVerified?: boolean;
};

const COLORS = ["#3ef2ac", "#27a567", "#7dd3fc", "#fca5a5", "#fcd34d", "#d8b4fe", "#f9a8d4", "#93c5fd"];
const REST_COLOR = "#475569"; // slate-600

// Top-level helpers (also used by custom label)
const truncateName = (s: unknown, max = 14) => {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
};
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(v);
const pctText = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Build a tweet URL if not provided by payload. */
function buildStatusUrl(t: MinimalTweet): string | undefined {
  const id = (t as any)?.tweetId as string | undefined;
  const handle = t.tweeter;
  if ((t as any)?.statusLink) return (t as any).statusLink as string;
  if (id && handle) return `https://x.com/${handle}/status/${id}`;
  return undefined;
}

export default function TweeterShareCard({
  tweets,
  className = "",
  defaultMetric = "views",
  defaultTopN = 5,
  minTopN = 3,
  maxTopN = 12,
  showTable = true,
}: {
  tweets: MinimalTweet[];
  className?: string;
  defaultMetric?: ShareMetric;
  defaultTopN?: number;
  minTopN?: number;
  maxTopN?: number;
  showTable?: boolean;
}) {
  const [metric, setMetric] = useState<ShareMetric>(defaultMetric);
  const [topN, setTopN] = useState<number>(clamp(defaultTopN, minTopN, maxTopN));

  // Restore/save preferences (session-level)
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("tweeterShare.metric");
      const t = sessionStorage.getItem("tweeterShare.topN");
      if (m === "tweets" || m === "views" || m === "engagements" || m === "likes") setMetric(m);
      if (t) setTopN(clamp(parseInt(t, 10), minTopN, maxTopN));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem("tweeterShare.metric", metric);
      sessionStorage.setItem("tweeterShare.topN", String(topN));
    } catch {}
  }, [metric, topN]);

  /** Aggregate by tweeter for the selected metric + prepare table rows. */
  type AggRow = {
    name: string;
    tweets: number;
    views: number;
    likes: number;
    retweets: number;
    replies: number;
    engagements: number;
    isVerified?: boolean;
    topTweetLinks: string[]; // up to 3
  };

  const { pieData, tableRows } = useMemo(() => {
    // 1) Group by tweeter (accumulate metrics + keep tweet list for top links)
    const by: Record<string, AggRow & { _tweets: MinimalTweet[] }> = {};
    for (const t of tweets) {
      const name = t.tweeter || "unknown";
      const row = (by[name] ||= {
        name,
        tweets: 0,
        views: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        engagements: 0,
        isVerified: t.isVerified, // if mixed, last one wins—OK for display
        topTweetLinks: [],
        _tweets: [],
      });
      row.tweets += 1;
      row.views += n(t.views);
      row.likes += n(t.likes);
      row.retweets += n(t.retweets);
      row.replies += n(t.replies);
      row.engagements += n(t.likes) + n(t.retweets) + n(t.replies);
      row._tweets.push(t);
    }

    // 2) Convert to array and compute value by current metric
    const arr = Object.values(by).map((r) => ({
      ...r,
      value:
        metric === "tweets"
          ? r.tweets
          : metric === "views"
          ? r.views
          : metric === "likes"
          ? r.likes
          : r.engagements,
    }));

    // 3) Sort by value desc; compute TopN + Rest for pie
    arr.sort((a, b) => b.value - a.value);
    const top = arr.slice(0, topN);
    const restValue = arr.slice(topN).reduce((s, r) => s + r.value, 0);
    const totalVal = arr.reduce((s, r) => s + r.value, 0);

    const pieTop = top.map((r) => ({ name: r.name, value: r.value, share: totalVal ? r.value / totalVal : 0 }));
    if (restValue > 0) pieTop.push({ name: "Rest", value: restValue, share: totalVal ? restValue / totalVal : 0 });

    // 4) Prepare table rows for the same TopN (and keep per-user top tweet links)
    const rowsForTable: AggRow[] = top.map((r) => {
      // pick top 3 tweets by views for this tweeter
      const links = r._tweets
        .slice()
        .sort((a, b) => n(b.views) - n(a.views))
        .slice(0, 3)
        .map((t) => buildStatusUrl(t))
        .filter(Boolean) as string[];

      return {
        name: r.name,
        tweets: r.tweets,
        views: r.views,
        likes: r.likes,
        retweets: r.retweets,
        replies: r.replies,
        engagements: r.engagements,
        isVerified: r.isVerified,
        topTweetLinks: links,
      };
    });

    return { pieData: pieTop, tableRows: rowsForTable };
  }, [tweets, metric, topN]);

  /** Wheel & touch handlers for TopN */
  const touchY = useRef<number | null>(null);
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    setTopN((prev) => clamp(prev + dir, minTopN, maxTopN));
  }
  function onTouchStart(e: React.TouchEvent) {
    touchY.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchY.current == null) return;
    const dy = (e.touches[0]?.clientY ?? touchY.current) - touchY.current;
    if (Math.abs(dy) > 18) {
      const dir = dy < 0 ? 1 : -1; // swipe up -> increase
      setTopN((prev) => clamp(prev + dir, minTopN, maxTopN));
      touchY.current = e.touches[0]?.clientY ?? null;
    }
  }

  return (
    <div className={`rounded-2xl border border-white/10 bg-black/10 p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="text-xs text-gray-400">
          {labelForMetric(metric)} (Top {topN}; others merged)
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {/* Segmented metric selector */}
          <div
            className="flex rounded-lg overflow-hidden border border-white/10 bg-white/5"
            role="tablist"
            aria-label="Share metric"
          >
            {(["tweets", "views", "engagements", "likes"] as ShareMetric[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={metric === m}
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 text-xs transition
                  ${metric === m ? "bg-emerald-500/20 text-emerald-200" : "text-white/80 hover:bg-white/10"}`}
                title={labelForMetric(m)}
              >
                {tabText(m)}
              </button>
            ))}
          </div>

          {/* TopN stepper with wheel & touch */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTopN((v) => clamp(v - 1, minTopN, maxTopN))}
              className="h-7 w-7 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 text-sm"
              aria-label="Decrease Top N"
            >
              –
            </button>
            <button
              onWheel={onWheel}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              type="button"
              title="Scroll / swipe to change Top N"
              className="h-7 px-2 rounded-md border border-white/10 bg-white/5 text-white/90 text-sm select-none"
              aria-live="polite"
            >
              Top {topN}
            </button>
            <button
              type="button"
              onClick={() => setTopN((v) => clamp(v + 1, minTopN, maxTopN))}
              className="h-7 w-7 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 text-sm"
              aria-label="Increase Top N"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Pie chart */}
      <div className="h-64">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="72%"
              labelLine={false}
              isAnimationActive={false}
              label={(p: any) => renderNameOnlyLabel(p)}
            >
              {pieData.map((entry, idx) => (
                <Cell
                  key={`slice-${entry.name}-${idx}`}
                  fill={entry.name === "Rest" ? REST_COLOR : COLORS[idx % COLORS.length]}
                  stroke="#0f1413"
                  strokeWidth={1}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#0f1413", border: "1px solid #222", color: "#e5e7eb" }}
              labelStyle={{ color: "#e5e7eb" }}
              itemStyle={{ color: "#e5e7eb" }}
              formatter={(val: any, _name, item: any) => [
                compact(val as number),
                `${item?.payload?.name} (${pctText(item?.payload?.share ?? 0)})`,
              ]}
            />
            <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Table under the pie */}
      {showTable && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400">
              <tr className="[&>th]:py-2 [&>th]:px-2">
                <th className="text-left">Tweeter</th>
                <th className="text-right">Share</th>
                <th className="text-right">Tweets</th>
                <th className="text-right">Views</th>
                <th className="text-right">Engs</th>
                <th className="text-right">Likes</th>
                <th className="text-left">Top tweets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {tableRows.map((r) => (
                <tr key={r.name} className="hover:bg-white/5">
                  {/* Tweeter profile */}
                  <td className="py-2 px-2">
                    <a
                      href={`https://x.com/${r.name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
                      title={`Open @${r.name} on X`}
                    >
                      @{r.name}
                    </a>
                    <span className="ml-1 text-xs text-gray-400">{r.isVerified ? "✓" : ""}</span>
                  </td>

                  {/* Share (for current metric) */}
                  <td className="py-2 px-2 text-right">
                    {pctText(
                      (pieData.find((p: any) => p.name === r.name)?.share as number) ?? 0
                    )}
                  </td>

                  <td className="py-2 px-2 text-right">{compact(r.tweets)}</td>
                  <td className="py-2 px-2 text-right">{compact(r.views)}</td>
                  <td className="py-2 px-2 text-right">{compact(r.engagements)}</td>
                  <td className="py-2 px-2 text-right">{compact(r.likes)}</td>

                  {/* Top tweets links */}
                  <td className="py-2 px-2">
                    <div className="flex flex-wrap gap-1">
                      {r.topTweetLinks.length === 0 ? (
                        <span className="text-xs text-gray-500">No links</span>
                      ) : (
                        r.topTweetLinks.map((url, idx) => (
                          <a
                            key={`${r.name}-tw-${idx}`}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/80"
                            title={`Open tweet #${idx + 1}`}
                          >
                            #{idx + 1}
                          </a>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tiny note for clarity */}
          <div className="mt-2 text-[11px] text-gray-500">
            Table shows the same Top {topN} tweeters as the pie (ordered by the selected metric).
          </div>
        </div>
      )}

      {/* Footnote about interactions */}
      <div className="mt-2 text-[11px] text-gray-500">
        Tip: use mouse wheel or swipe up/down on the “Top N” pill to adjust the number.
      </div>
    </div>
  );
}

/** Name-only label with basic overlap mitigation (small font, hide tiny slices, offset small slices). */
function renderNameOnlyLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent, name, payload } = props;
  if (percent < 0.04) return null; // hide tiny slices

  const RADIAN = Math.PI / 180;
  const extra = Math.min(28, 10 + (1 - percent) * 24); // push small slices farther
  const r = outerRadius + extra;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  const color = payload?.name === "Rest" ? "#94a3b8" : "#34d399";

  return (
    <text
      x={x}
      y={y}
      fill={color}
      fontSize={11.5}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      paintOrder="stroke"
      stroke="#0a0f0e"
      strokeWidth={4}
      strokeOpacity={0.9}
    >
      {truncateName(name, 14)}
    </text>
  );
}

function labelForMetric(m: ShareMetric) {
  switch (m) {
    case "tweets":
      return "Tweets count share by tweeter";
    case "views":
      return "Views share by tweeter";
    case "engagements":
      return "Engagements share by tweeter";
    case "likes":
      return "Like share by tweeter";
  }
}

function tabText(m: ShareMetric) {
  switch (m) {
    case "tweets":
      return "Tweets";
    case "views":
      return "Views";
    case "engagements":
      return "Engs";
    case "likes":
      return "Likes";
  }
}
