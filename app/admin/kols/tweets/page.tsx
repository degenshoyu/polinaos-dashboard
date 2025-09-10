// app/admin/kols/tweets.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import React from "react";
import { subDays } from "date-fns";

type TweetRow = {
  twitter_username: string;
  tweet_id: string;
  views: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  engagements: number | null;
  publish_date_time: string; // UTC ISO
  last_seen_at: string;      // UTC ISO (a.k.a last_updated_at)
  coins: {
    ticker?: string | null;
    ca?: string | null;
    source?: string | null;
    triggerText?: string | null;
    tokenKey?: string | null;
    tokenDisplay?: string | null;
    confidence?: number | null;
  }[];
};

type Preset = "7d" | "30d" | "all" | "custom";

export default function AdminKolsTweets() {
  // helpers
  const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day} ${hh}:${mm}`;
  };
  const normalizeTicker = (t?: string | null) =>
    (t ?? "").replace(/^\$/,"");
  const shortCa = (ca?: string | null) =>
    ca && ca.length > 8 ? `${ca.slice(0,4)}…${ca.slice(-4)}` : (ca ?? "");
  const fmtNum = (n?: number | null) =>
    new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
      .format(Number(n ?? 0));

  type SortKey =
    | "username" | "tweet_id" | "views" | "likes" | "retweets"
    | "replies" | "engs" | "publish" | "last_seen" | "coins";
  const [sortKey, setSortKey] = useState<SortKey>("publish");
  const [sortAsc, setSortAsc] = useState(false);
  const [coinFilter, setCoinFilter] = useState<"all"|"only">("all");

  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState<string>(() => subDays(new Date(), 7).toISOString());
  const [to, setTo] = useState<string>(() => new Date().toISOString());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<TweetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [query, setQuery] = useState(""); // filter by username

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "7d") {
      setFrom(subDays(new Date(), 7).toISOString());
      setTo(new Date().toISOString());
    } else if (p === "30d") {
      setFrom(subDays(new Date(), 30).toISOString());
      setTo(new Date().toISOString());
    }
    setPage(1);
  };

  const mapSortKeyToApi = (k: SortKey) => {
    switch (k) {
      case "username": return "username";
      case "tweet_id": return "tweet_id";
      case "views": return "views";
      case "likes": return "likes";
      case "retweets": return "retweets";
      case "replies": return "replies";
      case "engs": return "engagements";
      case "publish": return "publish_date_time";
      case "last_seen": return "last_seen_at";
      case "coins": return "coins";
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      if (preset === "all") {
        sp.set("from", "1970-01-01T00:00:00.000Z");
        sp.set("to", new Date().toISOString());
      } else {
        sp.set("from", from);
        sp.set("to", to);
      }
      sp.set("page", String(page));
      sp.set("pageSize", String(size));
      sp.set("sort", mapSortKeyToApi(sortKey));
      sp.set("order", sortAsc ? "asc" : "desc");
      if (coinFilter === "only") sp.set("onlyCoin", "1");
      const handle = query.trim().replace(/^@/, "");
      if (handle) sp.set("handle", handle);

      const r = await fetch(`/api/kols/tweets/admin?${sp.toString()}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "failed to load tweets");
      setRows((data.items ?? []) as TweetRow[]);
      setTotal(Number(data.total ?? 0));
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to, page, size, sortKey, sortAsc, coinFilter, query]);

  const pageCount = Math.max(1, Math.ceil((total || 0) / size));
  const safePage = Math.min(page, pageCount);
  const visible = rows;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">KOL Tweets</h1>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
     <input
       className="px-3 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
       placeholder="Filter by @username…"
       value={query}
       onChange={(e) => {
         setQuery(e.target.value);
         setPage(1);
       }}
     />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
            aria-label="Date range preset"
          >
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
            <option value="all">All time</option>
            <option value="custom">Custom</option>
          </select>

          {preset === "custom" && (
            <>
              <input
                type="datetime-local"
                value={from.slice(0, 16)}
                onChange={(e) => setFrom(new Date(e.target.value).toISOString())}
                className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
                aria-label="From (UTC)"
              />
              <input
                type="datetime-local"
                value={to.slice(0, 16)}
                onChange={(e) => setTo(new Date(e.target.value).toISOString())}
                className="px-2 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
                aria-label="To (UTC)"
              />
            </>
          )}

          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-sm disabled:opacity-60"
          >
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
            aria-label="Coin filter"
            value={coinFilter}
            onChange={(e) => { setCoinFilter(e.target.value as any); setPage(1); }}
          >
            <option value="all">Show All</option>
            <option value="only">Show Only Coin</option>
          </select>
          <select
            className="px-2 py-2 rounded-md bg-black/30 border border-white/10 outline-none text-sm"
            value={size}
            onChange={(e) => {
              setSize(parseInt(e.target.value, 10));
              setPage(1);
            }}
            aria-label="Rows per page"
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left select-none">
              {[
                ["X Username","username"],
                ["Tweet ID","tweet_id"],
                ["Views","views"],
                ["Likes","likes"],
                ["Retweets","retweets"],
                ["Replies","replies"],
                ["Engs","engs"],
                ["Publish","publish"],
                ["Last Seen","last_seen"],
                ["Coins (Ticker / CA)","coins"],
              ].map(([label, key]) => (
                <th
                  key={key}
                  onClick={() => {
                    const k = key as SortKey;
                    if (sortKey === k) setSortAsc(!sortAsc);
                    else { setSortKey(k); setSortAsc(false); }
                    setPage(1);
                  }}
                  className="cursor-pointer"
                  title="Click to sort"
                >
                  {label}
                  {sortKey === key && (sortAsc ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {visible.map((t) => (
              <tr key={t.tweet_id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                <td>
                  <a
                    href={`https://x.com/${t.twitter_username}`}
                    target="_blank"
                    className="underline decoration-dotted"
                  >
                    {t.twitter_username}
                  </a>
                </td>
                <td>
                  <a
                    href={`https://x.com/${t.twitter_username}/status/${t.tweet_id}`}
                    target="_blank"
                    className="underline decoration-dotted"
                  >
                    {t.tweet_id}
                  </a>
                </td>
                <td>{fmtNum(t.views)}</td>
                <td>{fmtNum(t.likes)}</td>
                <td>{fmtNum(t.retweets)}</td>
                <td>{fmtNum(t.replies)}</td>
                <td>{fmtNum(t.engagements)}</td>
                <td className="text-xs text-gray-300">{fmt(t.publish_date_time)}</td>
                <td className="text-xs text-gray-300">{fmt(t.last_seen_at)}</td>
                <td className="text-xs">
                {(() => {
                    if (!t.coins?.length) return "—";
                   // dedupe by "ticker|ca"
                    const seen = new Set<string>();
                    const rows: React.ReactElement[] = [];
                    for (const c of t.coins) {
                      const cleanTicker = normalizeTicker(c.ticker);
                      const ca = c.ca ?? "";
                      const key = `${(cleanTicker ?? "").toLowerCase()}|${ca}|${(c.source ?? "").toLowerCase()}|${(c.triggerText ?? "")}`;
                      if (seen.has(key)) continue;
                      seen.add(key);
                      const caShort = shortCa(ca);
                      const leftLabel =
                        cleanTicker
                          ? `$${cleanTicker}`
                          : (c.tokenDisplay ?? (c.tokenKey ? shortCa(c.tokenKey) : "—"));
                      const sourceBadge = (src?: string | null) => {
                        if (!src) return null;
                        const txt = src === "upper" ? "Upper" : src.charAt(0).toUpperCase() + src.slice(1);
                        return (
                          <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-[1px] text-[10px] opacity-80">
                            {txt}
                          </span>
                        );
                      };
                      rows.push(
                      <div
                        key={key}
                        className="flex flex-col gap-1 py-1"
                      >
                      <div className="flex items-center gap-2">
                            <span className="font-medium">{leftLabel}</span>
                            {sourceBadge(c.source)}
                            {ca ? (
                              <button
                                type="button"
                                onClick={async () => { try { await navigator.clipboard.writeText(ca); } catch {} }}
                                className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/30 px-2.5 py-0.5 hover:bg-white/10 transition text-xs"
                                title="Copy contract address"
                              >
                                <span className="font-mono tracking-wide">{caShort}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                                  fill="currentColor" className="w-3.5 h-3.5 opacity-80">
                                  <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>
                                </svg>
                              </button>
                            ) : (
                              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[11px] opacity-70">
                                No CA
                              </span>
                            )}
                          </div>
                          {c.triggerText ? (
                            <div className="text-[11px] text-gray-400 leading-snug">
                              {c.triggerText}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    return rows.length ? <div className="space-y-1.5">{rows}</div> : "—";
                  })()}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                  {loading ? "Loading…" : "No data"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="p-3 flex items-center justify-between text-xs text-gray-400">
        <div>
          Page <b className="text-white">{safePage}</b> / {pageCount} ·{" "}
          <span className="text-gray-300">{total}</span> items
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(1)}
            disabled={safePage <= 1}
            aria-label="First page"
          >
            «
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(Math.min(pageCount, safePage + 1))}
            disabled={safePage >= pageCount}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={() => setPage(pageCount)}
            disabled={safePage >= pageCount}
            aria-label="Last page"
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
}
