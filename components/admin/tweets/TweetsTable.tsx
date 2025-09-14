"use client";

import React from "react";
import { Trash2 } from "lucide-react";

export type TweetRow = {
  twitter_username: string;
  tweet_id: string;
  views: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  engagements: number | null;
  publish_date_time: string; // UTC ISO
  last_seen_at: string;      // UTC ISO
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

export type SortKey =
  | "username" | "tweet_id" | "views" | "likes" | "retweets"
  | "replies" | "engs" | "publish" | "last_seen" | "coins";

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtNum(n?: number | null) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(Number(n ?? 0));
}
function normalizeTicker(t?: string | null) { return (t ?? "").replace(/^\$/,""); }
function shortCa(ca?: string | null) {
  return ca && ca.length > 8 ? `${ca.slice(0,4)}…${ca.slice(-4)}` : (ca ?? "");
}

export default function TweetsTable({
  rows,
  sortKey, sortAsc, onSortChange,
  selectedIds, onToggleOne, onToggleAll,
  onDeleteTweet,
}: {
  rows: TweetRow[];
  sortKey: SortKey;
  sortAsc: boolean;
  onSortChange: (k: SortKey) => void;

  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: (idsOnPage: string[], allSelected: boolean) => void;

  onDeleteTweet: (tweetId: string) => void;
}) {
  const allIds = rows.map(r => r.tweet_id);
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.tweet_id));

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-400">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left select-none">
            <th className="w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleAll(allIds, allSelected)}
                aria-label="Select all on page"
              />
            </th>
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
              ["","actions"],
            ].map(([label, key]) => (
              key === "actions" ? (
                <th key="actions" />
              ) : (
                <th
                  key={key}
                  onClick={() => onSortChange(key as SortKey)}
                  className="cursor-pointer"
                  title="Click to sort"
                >
                  {label}
                  {sortKey === key && (sortAsc ? " ▲" : " ▼")}
                </th>
              )
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((t) => (
            <tr key={t.tweet_id} className="[&>td]:px-3 [&>td]:py-2 align-top">
              <td className="align-middle">
                <input
                  type="checkbox"
                  checked={selectedIds.has(t.tweet_id)}
                  onChange={() => onToggleOne(t.tweet_id)}
                  aria-label={`Select ${t.tweet_id}`}
                />
              </td>
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
                  className="underline decoration-dotted font-mono text-xs"
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
                  // dedupe by ticker|ca|source|triggerText
                  const seen = new Set<string>();
                  const nodes: React.ReactElement[] = [];
                  for (const c of t.coins) {
                    const cleanTicker = normalizeTicker(c.ticker);
                    const ca = c.ca ?? "";
                    const key = `${(cleanTicker ?? "").toLowerCase()}|${ca}|${(c.source ?? "").toLowerCase()}|${(c.triggerText ?? "")}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
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
                    nodes.push(
                      <div key={key} className="flex flex-col gap-1 py-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{leftLabel}</span>
                          {sourceBadge(c.source)}
                          {ca ? (
                            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[11px] font-mono">
                              {shortCa(ca)}
                            </span>
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
                  return nodes.length ? <div className="space-y-1.5">{nodes}</div> : "—";
                })()}
              </td>
              <td className="align-middle">
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-400/40 hover:bg-red-400/10 text-xs"
                  onClick={() => onDeleteTweet(t.tweet_id)}
                  title="Delete mentions for this tweet and mark excluded"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="px-3 py-6 text-center text-gray-500">
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

