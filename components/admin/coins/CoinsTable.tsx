// components/admin/coins/CoinsTable.tsx
"use client";

import { useState } from "react";
import { CoinRow, SortKey, fmtNum, shortCa } from "./types";
import { Pencil, List, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Tiny arrow used in sortable headers */
function Arrow({ active, asc }: { active: boolean; asc: boolean }) {
  return (
    <span className={`inline-block ml-1 transition-opacity ${active ? "opacity-100" : "opacity-30"}`}>
      {asc ? "▲" : "▼"}
    </span>
  );
}

/** Compact stacked bar for source distribution (CA / Ticker / Phrase) */
function SourceBar({
  ca = 0,
  ticker = 0,
  phrase = 0,
}: {
  ca?: number;
  ticker?: number;
  phrase?: number;
}) {
  const total = Math.max(1, ca + ticker + phrase);
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <div className="flex flex-col items-start gap-1">
      {/* stacked bar */}
      <div className="flex h-2 w-40 overflow-hidden rounded">
        <div className="h-full bg-emerald-400/70" style={{ width: `${pct(ca)}%` }} />
        <div className="h-full bg-sky-400/70" style={{ width: `${pct(ticker)}%` }} />
        <div className="h-full bg-amber-400/70" style={{ width: `${pct(phrase)}%` }} />
      </div>
      {/* labeled ratios under the bar */}
      <div className="text-xs text-gray-400">
        {pct(ca)} CA / {pct(ticker)} Ticker / {pct(phrase)} Phrase
      </div>
    </div>
  );
}

type Props = {
  rows: CoinRow[];
  loading: boolean;
  sort: SortKey;
  asc: boolean;
  onHeaderSort: (key: SortKey) => void;

  // inline CA edit
  editing: Record<number, boolean>;
  pendingCa: Record<number, string>;
  onStartEdit: (rowIndex: number, currentCa?: string | null) => void;
  onCancelEdit: (rowIndex: number) => void;
  onPendingChange: (rowIndex: number, next: string) => void;
  onSaveCa: (rowIndex: number) => void;

  // open tweets modal for this row
  onShowTweets: (scope: { ticker?: string | null; ca?: string | null }) => void;

  // delete a row (by CA)
  onDeleteRow: (rowIndex: number, ca: string, excludeTweets: boolean) => Promise<void> | void;
};

export default function CoinsTable({
  rows,
  loading,
  sort,
  asc,
  onHeaderSort,
  editing,
  pendingCa,
  onStartEdit,
  onCancelEdit,
  onPendingChange,
  onSaveCa,
  onShowTweets,
  onDeleteRow,
}: Props) {
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ idx: number; ca: string } | null>(null);
  const [deleting, setDeleting] = useState<false | "basic" | "exclude">(false);

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-black/40 backdrop-blur text-xs text-gray-300">
          <tr className="[&>th]:px-3 [&>th]:py-2 whitespace-nowrap">
            <th className="text-left">
              <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("ticker")}>
                Ticker<Arrow active={sort === "ticker"} asc={asc} />
              </button>
            </th>
            <th className="text-left">
              <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("ca")}>
                CA<Arrow active={sort === "ca"} asc={asc} />
              </button>
            </th>
            <th className="min-w-[320px] text-left">
              <div className="flex items-center gap-4">
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("tweets")}>
                  Tweets / No P.<Arrow active={sort === "tweets"} asc={asc} />
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("views")}>
                  Views<Arrow active={sort === "views"} asc={asc} />
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("engs")}>
                  Engs<Arrow active={sort === "engs"} asc={asc} />
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("er")}>
                  ER<Arrow active={sort === "er"} asc={asc} />
                </button>
              </div>
            </th>
            <th className="min-w-[220px] text-left">
              <div className="flex items-center gap-4">
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("kols")}>
                  Total KOLs<Arrow active={sort === "kols"} asc={asc} />
                </button>
                <button className="hover:underline decoration-dotted" onClick={() => onHeaderSort("followers")}>
                  Followers<Arrow active={sort === "followers"} asc={asc} />
                </button>
              </div>
            </th>
            <th className="text-left">Top KOLs</th>
            <th className="text-left">Source Distribution</th>
            <th className="text-left">gmgn / Actions</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-white/10">
          {rows.map((r, i) => {
            const s = r.sources ?? ({} as any); // { ca, ticker, phrase, ... }
            return (
              <tr key={`${r.ticker ?? "?"}|${r.ca ?? i}`} className="hover:bg-white/5 transition-colors">
                {/* Ticker + quick open tweets */}
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.ticker ?? "—"}</span>
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/10"
                      title="Show tweets"
                      onClick={() => onShowTweets({ ticker: r.ticker ?? undefined, ca: r.ca ?? undefined })}
                    >
                      <List size={14} /> View
                    </button>
                  </div>
                </td>

                {/* CA (click to copy) + inline edit */}
                <td className="px-3 py-2 align-top">
                  {editing[i] ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={pendingCa[i] ?? r.ca ?? ""}
                        onChange={(e) => onPendingChange(i, e.target.value)}
                        className="w-[340px] rounded-md border border-white/10 bg-black/30 px-2 py-1"
                        placeholder="Enter Solana mint address"
                      />
                      <button
                        className="rounded-md border border-white/10 bg-emerald-500/10 px-2 py-1 hover:bg-emerald-500/20"
                        onClick={() => onSaveCa(i)}
                        title="Save"
                      >
                        Save
                      </button>
                      <button
                        className="rounded-md border border-white/10 bg-white/10 px-2 py-1 hover:bg-white/20"
                        onClick={() => onCancelEdit(i)}
                        title="Cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {r.ca ? (
                        <>
                          <code
                            className="px-2 py-0.5 rounded bg-black/30 border border-white/10 cursor-pointer select-none"
                            title={copiedRow === i ? "Copied!" : "Click to copy"}
                            onClick={async () => {
                              await navigator.clipboard.writeText(r.ca!);
                              setCopiedRow(i);
                              setTimeout(() => setCopiedRow(null), 1200);
                            }}
                          >
                            {shortCa(r.ca)}
                          </code>
                          {copiedRow === i && <span className="text-xs text-emerald-400">Copied</span>}
                        </>
                      ) : (
                        <span className="text-gray-400">No CA</span>
                      )}
                      <button
                        className="p-1 rounded-md border border-white/10 hover:bg-white/10"
                        onClick={() => onStartEdit(i, r.ca)}
                        title={r.ca ? "Edit CA" : "Set CA"}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  )}
                </td>

                {/* Metrics pack: numbers only (Tweets / No-price, Views, Engs, ER) */}
                <td className="px-3 py-2 align-top">
                  <div className="grid grid-cols-4 gap-2 text-[13px]">
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium" title="total / no-price tweets">
                        {fmtNum(r.totalTweets)} <span className="text-xs text-gray-400">/ {fmtNum(r.noPriceTweets ?? 0)}</span>
                      </div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium">{fmtNum(r.totalViews)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium">{fmtNum(r.totalEngagements)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium">
                        {(r.er || 0).toLocaleString("en", { style: "percent", maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </td>

                {/* KOLs / Followers: numbers only */}
                <td className="px-3 py-2 align-top">
                  <div className="grid grid-cols-2 gap-2 text-[13px]">
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium">{fmtNum(r.totalKols)}</div>
                    </div>
                    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-2 text-center">
                      <div className="font-medium">{fmtNum(r.totalFollowers)}</div>
                    </div>
                  </div>
                </td>

                {/* Top KOLs */}
                <td className="px-3 py-2 align-top">
                  {Array.isArray((r as any).topKols) && (r as any).topKols.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {((r as any).topKols as Array<any>).slice(0, 5).map((k, idx) => {
                        const uname = String(k.username || "").replace(/^@+/, "");
                        const title = `${k.displayName ? `${k.displayName} ` : ""}(@${uname}) • ${
                          Intl.NumberFormat("en", { notation: "compact" }).format(k.followers ?? 0)
                        } followers • ${k.mentions ?? 0} mentions`;
                        return (
                          <a
                            key={`${uname}-${idx}`}
                            href={`https://twitter.com/${uname}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-[12px] hover:bg-white/15"
                            title={title}
                            aria-label={`Open @${uname} on Twitter`}
                          >
                            @{uname}
                          </a>
                        );
                      })}
                      {(r as any).topKols.length > 5 && (
                        <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[12px] text-gray-300">
                          +{(r as any).topKols.length - 5}
                        </span>
                      )}
                    </div>
                  ) : (r as any).topKolsLabel ? (
                    <div className="text-[13px] text-gray-200">{(r as any).topKolsLabel}</div>
                  ) : (
                    <div className="text-[13px] text-gray-400">—</div>
                  )}
                </td>

                {/* Source Distribution */}
                <td className="px-3 py-2 align-top">
                  <SourceBar ca={s.ca ?? 0} ticker={s.ticker ?? 0} phrase={s.phrase ?? 0} />
                </td>

                {/* gmgn / Actions */}
                <td className="px-3 py-2 align-top">
                  {r.ca ? (
                    <div className="flex items-center gap-2">
                      <a
                        className="underline decoration-dotted"
                        href={`https://gmgn.ai/sol/token/${r.ca}`}
                        target="_blank"
                      >
                        Open
                      </a>
                      <button
                        className="p-1 rounded-md border border-red-400/40 bg-red-400/10 hover:bg-red-400/20"
                        title="Delete token & related mentions"
                        onClick={() => setDeleteTarget({ idx: i, ca: r.ca! })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}

          {/* Empty state row */}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                {loading ? "Loading…" : "No data"}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Delete dialog with two options */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete token mapping</DialogTitle>
            <DialogDescription>
              Contract Address:{" "}
              <code className="px-1.5 py-0.5 rounded bg-black/30 border border-white/10">
                {deleteTarget?.ca ?? ""}
              </code>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-white/10 p-3 bg-white/5">
              <div className="font-medium mb-1">Option 1</div>
              <p>Remove from <code>coin_ca_ticker</code> and <code>tweet_token_mentions</code>.</p>
            </div>
            <div className="rounded-lg border border-white/10 p-3 bg-white/5">
              <div className="font-medium mb-1">Option 2</div>
              <p>
                Do Option 1, <span className="underline">and</span> set related{" "}
                <code>kol_tweets</code> to <code>excluded=true</code> so they won’t be counted again.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={!!deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!deleting}
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  setDeleting("basic");
                  await onDeleteRow(deleteTarget.idx, deleteTarget.ca, false);
                  setDeleteTarget(null);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting === "basic" ? "Deleting…" : "Delete (Option 1)"}
            </Button>
            <Button
              variant="destructive"
              disabled={!!deleting}
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  setDeleting("exclude");
                  await onDeleteRow(deleteTarget.idx, deleteTarget.ca, true);
                  setDeleteTarget(null);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting === "exclude" ? "Working…" : "Delete + Exclude (Option 2)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
