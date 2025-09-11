// components/admin/coins/CoinsTable.tsx

"use client";

import { CoinRow, SortKey, fmtNum, shortCa } from "./types";
import { Copy, Pencil, List } from "lucide-react";

type Props = {
  rows: CoinRow[];
  loading: boolean;
  sort: SortKey;
  asc: boolean;
  onHeaderSort: (key: SortKey) => void;

  // inline CA edit
  editing: Record<number, boolean>;
  pendingCa: Record<number, string>;
  onStartEdit: (rowIndex: number, current?: string | null) => void;
  onCancelEdit: (rowIndex: number, current?: string | null) => void;
  onPendingChange: (rowIndex: number, v: string) => void;
  onSaveCa: (rowIndex: number) => void;

  // open tweets modal for this row
  onShowTweets: (scope: { ticker?: string | null; ca?: string | null }) => void;
};

/** Tiny arrow indicator for sort headers */
const Arrow = ({ active, asc }: { active: boolean; asc: boolean }) => (
  <span className={`ml-1 inline-block transition ${active ? "opacity-100" : "opacity-20"}`}>
    {asc ? "▲" : "▼"}
  </span>
);

// render one line progress bar
function LineBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 shrink-0 text-xs text-gray-400">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-white/60" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-10 shrink-0 text-right text-xs">{pct}%</div>
    </div>
  );
}

export default function CoinsTable({
  rows, loading, sort, asc, onHeaderSort,
  editing, pendingCa, onStartEdit, onCancelEdit, onPendingChange, onSaveCa,
  onShowTweets
}: Props) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-black/40 backdrop-blur text-xs text-gray-300">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left whitespace-nowrap">
            <th>
              <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("ticker")}>
                Ticker<Arrow active={sort==="ticker"} asc={asc}/>
              </button>
            </th>
            <th>
              <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("ca")}>
                CA (unique)<Arrow active={sort==="ca"} asc={asc}/>
              </button>
            </th>
            <th className="min-w-[320px]">
              <div className="flex gap-4">
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("tweets")}>
                  Tweets<Arrow active={sort==="tweets"} asc={asc}/>
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("views")}>
                  Views<Arrow active={sort==="views"} asc={asc}/>
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("engs")}>
                  Engs<Arrow active={sort==="engs"} asc={asc}/>
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("er")}>
                  ER<Arrow active={sort==="er"} asc={asc}/>
                </button>
              </div>
            </th>
            <th className="min-w-[220px]">
              <div className="flex gap-4">
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("kols")}>
                  Total KOLs<Arrow active={sort==="kols"} asc={asc}/>
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("followers")}>
                  Followers<Arrow active={sort==="followers"} asc={asc}/>
                </button>
              </div>
            </th>
            <th>Top KOLs</th>
            <th>Source Distribution</th>
            <th>gmgn</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-white/10">
          {rows.map((r, i) => {
            const s = r.sources ?? ({} as any);
            // Only CA, Ticker, Phrase; compute total from these three
            const total3 = (s.ca ?? 0) + (s.ticker ?? 0) + (s.phrase ?? 0);

            return (
              <tr key={`${r.ticker ?? "?"}|${r.ca ?? i}`} className="hover:bg-white/5 transition-colors">
                {/* Ticker + show tweets icon */}
                <td className="px-3 py-2 align-top font-medium">
                  <div className="flex items-center gap-2">
                    {r.ticker ? `$${r.ticker}` : "—"}
                    <button
                      className="p-1 rounded-md border border-white/10 hover:bg-white/10"
                      title="Show all tweets for this ticker"
                      onClick={() => onShowTweets({ ticker: r.ticker ?? undefined, ca: r.ca ?? undefined })}
                    >
                      <List size={14}/>
                    </button>
                  </div>
                </td>

                {/* CA with icon buttons */}
                <td className="px-3 py-2 align-top">
                  {editing[i] ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="px-2 py-1 rounded-md bg-black/30 border border-white/10 text-sm font-mono w-[260px]"
                        value={pendingCa[i] ?? ""}
                        onChange={(e) => onPendingChange(i, e.target.value)}
                        placeholder="Enter contract address…"
                      />
                      <button
                        className="p-1 rounded border border-emerald-400/50 bg-emerald-400/10 hover:bg-emerald-400/20"
                        onClick={() => onSaveCa(i)}
                        title="Save CA"
                      >
                        ✓
                      </button>
                      <button
                        className="p-1 rounded border border-white/10 hover:bg-white/10"
                        onClick={() => onCancelEdit(i, r.ca)}
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {r.ca ? (
                        <>
                          <code className="px-2 py-0.5 rounded bg-black/30 border border-white/10">{shortCa(r.ca)}</code>
                          <button
                            className="p-1 rounded-md border border-white/10 hover:bg-white/10"
                            onClick={() => { if (r.ca) navigator.clipboard.writeText(r.ca); }}
                            title="Copy CA"
                          >
                            <Copy size={14}/>
                          </button>
                        </>
                      ) : <span className="text-gray-400">No CA</span>}
                      <button
                        className="p-1 rounded-md border border-white/10 hover:bg-white/10"
                        onClick={() => onStartEdit(i, r.ca)}
                        title={r.ca ? "Edit CA" : "Set CA"}
                      >
                        <Pencil size={14}/>
                      </button>
                    </div>
                  )}
                </td>

                {/* Metrics pack */}
                <td className="px-3 py-2 align-top">
                  <div className="grid grid-cols-4 gap-2 text-[13px]">
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">Tweets</div>
                      <div className="font-medium" title="total / no-price tweets">
                        {fmtNum(r.totalTweets)}
                        <span className="ml-1 text-xs text-gray-400">
                          / {fmtNum(r.noPriceTweets ?? 0)} no-price
                        </span>
                      </div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">Views</div>
                      <div className="font-medium">{fmtNum(r.totalViews)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">Engs</div>
                      <div className="font-medium">{fmtNum(r.totalEngagements)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">ER</div>
                      <div className="font-medium">
                        {(r.er || 0).toLocaleString("en", { style: "percent", maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </td>

                {/* KOLs / Followers */}
                <td className="px-3 py-2 align-top">
                  <div className="grid grid-cols-2 gap-2 text-[13px]">
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">KOLs</div>
                      <div className="font-medium">{fmtNum(r.totalKols)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center">
                      <div className="text-xs text-gray-400">Followers</div>
                      <div className="font-medium">{fmtNum(r.totalFollowers)}</div>
                    </div>
                  </div>
                </td>

                {/* Top KOLs (compact) */}
                <td className="px-3 py-2 align-top text-xs">
                  {r.topKols?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {r.topKols.slice(0, 3).map((k) => (
                        <a key={k.username}
                           className="px-2 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10"
                           href={`https://x.com/${k.username}`} target="_blank" title={`${k.count} mentions`}>
                          @{k.username} <span className="text-gray-400">({k.count})</span>
                        </a>
                      ))}
                    </div>
                  ) : "—"}
                </td>

                {/* Source distribution (CA/Ticker/Phrase only, one per line) */}
                <td className="px-3 py-2 align-top text-xs">
                  <div className="space-y-1.5">
                    <LineBar label="CA"     value={s.ca ?? 0}     total={total3}/>
                    <LineBar label="Ticker" value={s.ticker ?? 0} total={total3}/>
                    <LineBar label="Phrase" value={s.phrase ?? 0} total={total3}/>
                  </div>
                </td>

                {/* gmgn */}
                <td className="px-3 py-2 align-top">
                  {r.ca ? (
                    <a
                      className="underline decoration-dotted"
                      href={`https://gmgn.ai/sol/token/${r.ca}`}
                      target="_blank"
                    >
                      Open
                    </a>
                  ) : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            );
          })}

          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                {loading ? "Loading…" : "No data"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
