"use client";

import { useEffect, useState } from "react";
import { Search, List } from "lucide-react";
import type { DupeItem } from "@/components/admin/coins/types";

/** Props:
 * - fromISO/toISO: current time window
 * - onSearchTicker: trigger main table search with this ticker
 * - onShowTweets: open tweets modal (we pass { ticker } here)
 */
type Props = {
  fromISO: string;
  toISO: string;
  onSearchTicker: (ticker: string) => void;
  onShowTweets: (scope: { ticker?: string | null; ca?: string | null }) => void;
};

export function DuplicatesPanel({ fromISO, toISO, onSearchTicker, onShowTweets }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<DupeItem[]>([]);

  const fetchDupes = async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("from", fromISO);
      sp.set("to", toISO);
      const r = await fetch(`/api/kols/coins/duplicates?${sp.toString()}`, { cache: "no-store" });
      const ct = r.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await r.json() : { ok: false, error: "invalid response" };
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "load failed");
      setItems(data.items as DupeItem[]);
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDupes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromISO, toISO]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Duplicate Tickers</h3>
        <button
          onClick={fetchDupes}
          className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      <p className="mt-1 text-xs text-gray-400">
        Showing tickers that map to multiple CAs in the current time range.
      </p>

      {loading && <div className="mt-3 text-sm text-gray-400">Loading…</div>}
      {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
      {!loading && !err && items.length === 0 && (
        <div className="mt-3 text-sm text-gray-400">0 tickers</div>
      )}

      {!loading && !err && items.length > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {items.map((it) => (
            <div
              key={it.ticker}
              className="rounded-xl border border-white/10 bg-black/40 p-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  ${it.ticker}
                  <span className="ml-2 text-xs text-gray-400">
                    {it.cas.length} CAs · {it.totalMentions} mentions
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* search this ticker in main table */}
                  <button
                    className="p-1 rounded border border-white/10 hover:bg-white/10"
                    title="Search this ticker"
                    onClick={() => onSearchTicker(it.ticker)}
                  >
                    <Search size={16} />
                  </button>
                  {/* open tweets modal scoped by ticker */}
                  <button
                    className="p-1 rounded border border-white/10 hover:bg-white/10"
                    title="Show all tweets for this ticker"
                    onClick={() => onShowTweets({ ticker: it.ticker })}
                  >
                    <List size={16} />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {it.cas.map((x) => (
                  <button
                    key={x.ca}
                    className="text-xs px-2 py-1 rounded-full border border-white/10 hover:bg-white/10"
                    title="Show tweets with this CA"
                    onClick={() => onShowTweets({ ticker: it.ticker, ca: x.ca })}
                  >
                    <span className="font-mono">{x.ca}</span>
                    <span className="ml-2 text-gray-400">({x.mentions})</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 同时导出默认，便于 `import DuplicatesPanel from ...`
export default DuplicatesPanel;
