"use client";

import { useEffect, useMemo, useState } from "react";
import type { TweetItem, TopKol } from "./types";
import { fmtNum } from "./types";
import { X, ExternalLink, RefreshCcw, DollarSign } from "lucide-react";

/** Compute days so that the backend window (now - days) covers the 'from' time. */
function daysSince(fromISO: string) {
  const ms = Date.now() - new Date(fromISO).getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Format USD price from string/number into a readable value. */
function fmtPrice(p?: string | number | null) {
  if (p == null) return "—";
  const n = typeof p === "string" ? Number(p) : p;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(n);
}

/** Row status for per-tweet progress */
type RowStatus = "idle" | "pending" | "ok" | "err";

export default function TweetListModal({
  open,
  onClose,
  fromISO,
  toISO,
  scope, // { ticker?: string | null; ca?: string | null }
}: {
  open: boolean;
  onClose: () => void;
  fromISO: string;
  toISO: string;
  scope: { ticker?: string | null; ca?: string | null };
}) {
  // data
  const [items, setItems] = useState<TweetItem[]>([]);
  const [topKols, setTopKols] = useState<TopKol[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // paging
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // filters
  const [filterUser, setFilterUser] = useState<string>("");

  // light loading flags
  const [pageLoading, setPageLoading] = useState(false);

  // per-row status + bulk progress
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  const title = useMemo(() => {
    if (scope.ticker) return `Tweets for $${scope.ticker}`;
    if (scope.ca) return `Tweets for CA ${scope.ca}`;
    return "Tweets";
  }, [scope]);

  /** Load a page from /api/kols/coins/tweets (does NOT block per-row buttons) */
  const fetchPage = async (p: number) => {
    setPageLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      sp.set("from", fromISO);
      sp.set("to", toISO);
      sp.set("page", String(p));
      sp.set("pageSize", String(pageSize));
      if (scope.ticker) sp.set("ticker", scope.ticker);
      if (scope.ca) sp.set("ca", scope.ca);
      const r = await fetch(`/api/kols/coins/tweets?${sp.toString()}`, { cache: "no-store" });
      const ct = r.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await r.json() : { ok: false, error: "invalid response" };
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "load failed");
      setItems(data.items as TweetItem[]);
      setTopKols(data.topKols as TopKol[]);
      setTotal(Number(data.total || 0));
      setPage(p);
      // reset row statuses after fresh load
      setRowStatus({});
    } catch (e: any) {
      setErr(e?.message ?? "load failed");
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // reset when opening or scope changes
    setItems([]);
    setTopKols([]);
    setPage(1);
    setTotal(0);
    setFilterUser("");
    setRowStatus({});
    setBulkRunning(false);
    setBulkDone(0);
    setBulkTotal(0);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope?.ticker, scope?.ca, fromISO, toISO]);

  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));

  /** Broad fill (backend fills ONLY NULL prices). Supports optional author + current scope. */
  const fillPricesBroad = async (opts: { screenName?: string }) => {
    const body = {
      screen_name: opts.screenName, // optional: narrow to a single user
      days: daysSince(fromISO),
      limit: 300,
      onlyCA: true,
      network: "solana",
      debug: false,
      tryPools: 3,
      graceSeconds: 90,
      // pass current modal scope so backend only touches relevant mentions
      ticker: scope.ticker ?? undefined,
      ca: scope.ca ?? undefined,
    };
    const r = await fetch("/api/kols/fill-mention-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await r.json() : { ok: false, error: "invalid response" };
    if (!r.ok || !data?.ok) throw new Error(data?.error ?? `Fill prices failed (HTTP ${r.status})`);
    return data as { ok: true; updated: number; scanned: number };
  };

  /** Precise fill for a single mention scope: tweetId + tokenKey (CA). */
  const fillExactForMention = async (tweetId: string, tokenKey: string) => {
    const r = await fetch("/api/kols/fill-mention-prices-tweet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tweetId,
        tokenKey,
        network: "solana",
        tryPools: 3,
        graceSeconds: 90,
        debug: false,
      }),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await r.json() : { ok: false, error: "invalid response" };
    if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
    return data as { ok: true; updated: number; price?: number };
  };

  /** Update one row: prefer precise (has CA), fallback to broad (by author). */
  const updateOneRow = async (tweetId: string, username: string) => {
    setRowStatus((m) => ({ ...m, [tweetId]: "pending" }));
    try {
      if (scope.ca) {
        await fillExactForMention(tweetId, scope.ca);
      } else {
        await fillPricesBroad({ screenName: username });
      }
      setRowStatus((m) => ({ ...m, [tweetId]: "ok" }));
      // Lazy refresh: reload current page to fetch updated prices
      await fetchPage(page);
    } catch (e: any) {
      setRowStatus((m) => ({ ...m, [tweetId]: "err" }));
      setErr(e?.message ?? "update failed");
    }
  };

  /** Bulk update helper over a list of tweet rows (sequential, with progress). */
  const runBulk = async (targetRows: TweetItem[]) => {
    setBulkRunning(true);
    setBulkDone(0);
    setBulkTotal(targetRows.length);

    // If CA exists in scope, use precise for each row; else dedupe authors and use broad.
    const processedUsers = new Set<string>();

    for (const it of targetRows) {
      setRowStatus((m) => ({ ...m, [it.tweetId]: "pending" }));
      try {
        if (scope.ca) {
          await fillExactForMention(it.tweetId, scope.ca);
        } else {
          if (!processedUsers.has(it.username)) {
            await fillPricesBroad({ screenName: it.username });
            processedUsers.add(it.username);
          }
        }
        setRowStatus((m) => ({ ...m, [it.tweetId]: "ok" }));
      } catch {
        setRowStatus((m) => ({ ...m, [it.tweetId]: "err" }));
      } finally {
        setBulkDone((d) => d + 1);
      }
    }

    // one final refresh to pull updated prices
    await fetchPage(page);
    setBulkRunning(false);
  };

  /** Bulk: update all rows currently visible (backend still fills NULL only). */
  const onUpdateAllPage = async () => {
    const visible = items.filter((it) => !filterUser || it.username === filterUser);
    await runBulk(visible);
  };

  /** Bulk: update only rows with NULL prices (UI-level filter). */
  const onUpdateNullOnly = async () => {
    const visible = items.filter((it) => !filterUser || it.username === filterUser);
    const nulls = visible.filter((it) => !it.priceUsdAt);
    await runBulk(nulls);
  };

  const bulkPct = bulkTotal > 0 ? Math.round((bulkDone / bulkTotal) * 100) : 0;

  return (
    <div className={`fixed inset-0 z-[100] ${open ? "" : "pointer-events-none opacity-0"} transition`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Panel */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1000px,95vw)] max-h-[92vh]
                      rounded-2xl border border-white/15 bg-black/90 backdrop-blur p-4 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <div className="flex items-center gap-2">
            {/* Bulk price actions */}
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
              title="Fill prices for all tweets in the list (backend fills NULL only)"
              onClick={onUpdateAllPage}
              disabled={bulkRunning || pageLoading}
            >
              <DollarSign size={14}/> Update all on page
            </button>
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
              title="Fill prices for tweets with NULL price only (backend fills NULL only)"
              onClick={onUpdateNullOnly}
              disabled={bulkRunning || pageLoading}
            >
              <RefreshCcw size={14}/> Update null prices
            </button>
            <button aria-label="Close" onClick={onClose}
                    className="p-1 rounded-md border border-white/10 hover:bg-white/10">
              <X size={16}/>
            </button>
          </div>
        </div>

        {/* Bulk progress bar */}
        {(bulkRunning || bulkTotal > 0) && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div>Updating prices… {bulkDone}/{bulkTotal}</div>
              <div>{bulkPct}%</div>
            </div>
            <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-white/60" style={{ width: `${bulkPct}%` }} />
            </div>
          </div>
        )}

        {/* Top KOLs filter row */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-gray-400">Top KOLs:</span>
          <button
            className={`text-xs px-2 py-1 rounded border ${!filterUser ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10 hover:bg-white/10"}`}
            onClick={() => setFilterUser("")}
            disabled={bulkRunning}
          >
            All
          </button>
          {topKols?.length ? topKols.map(k => (
            <button
              key={k.username}
              className={`text-xs px-2 py-1 rounded border ${filterUser===k.username ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10 hover:bg-white/10"}`}
              onClick={() => setFilterUser(k.username)}
              title={`${k.username} · ${k.count} tweets`}
              disabled={bulkRunning}
            >
              @{k.username} <span className="text-gray-400">({k.count})</span>
            </button>
          )) : null}
        </div>

        {/* List */}
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 overflow-auto" style={{maxHeight: "64vh"}}>
          {pageLoading && <div className="p-4 text-sm text-gray-400">Loading…</div>}
          {err && <div className="p-4 text-sm text-red-400">{err}</div>}
          {!pageLoading && !err && items.length === 0 && <div className="p-4 text-sm text-gray-400">No tweets</div>}
          {!pageLoading && !err && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-black/50 text-xs text-gray-400">
                <tr className="[&>th]:px-3 [&>th]:py-2 text-left whitespace-nowrap">
                  <th>Tweet ID</th>
                  <th>User</th>
                  <th>Views</th>
                  <th>Engs</th>
                  <th>Published</th>
                  <th className="text-right pr-3">Price</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {items
                  .filter(it => !filterUser || it.username === filterUser)
                  .map(it => {
                    const st = rowStatus[it.tweetId] ?? "idle";
                    return (
                      <tr key={it.tweetId} className="hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-xs">{it.tweetId}</td>
                        <td className="px-3 py-2">
                          <a className="underline decoration-dotted" href={`https://x.com/${it.username}`} target="_blank" rel="noreferrer">
                            @{it.username}
                          </a>
                        </td>
                        <td className="px-3 py-2">{fmtNum(it.views)}</td>
                        <td className="px-3 py-2">{fmtNum(it.engagements)}</td>
                        <td className="px-3 py-2 text-xs text-gray-400">
                          {new Date(it.publish).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtPrice(it.priceUsdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <a
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs"
                              href={`https://x.com/i/web/status/${it.tweetId}`}
                              target="_blank" rel="noreferrer"
                            >
                              Open <ExternalLink size={14}/>
                            </a>
                            <button
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-xs disabled:opacity-50"
                              title={scope.ca ? "Fill price for this tweet (exact CA)" : "Fill price by author scope"}
                              onClick={() => updateOneRow(it.tweetId, it.username)}
                              disabled={bulkRunning}
                            >
                              <RefreshCcw size={14}/>
                              {st === "pending" && <span className="animate-spin inline-block ml-1">⟳</span>}
                              {st === "ok" && <span className="ml-1 text-emerald-400">ok</span>}
                              {st === "err" && <span className="ml-1 text-red-400">err</span>}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pager */}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
          <div>Page <b className="text-white">{page}</b> / {pageCount} · {total} tweets</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => fetchPage(1)} disabled={page<=1 || bulkRunning}>«</button>
            <button className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => fetchPage(Math.max(1, page-1))} disabled={page<=1 || bulkRunning}>‹</button>
            <button className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => fetchPage(Math.min(pageCount, page+1))} disabled={page>=pageCount || bulkRunning}>›</button>
            <button className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => fetchPage(pageCount)} disabled={page>=pageCount || bulkRunning}>»</button>
          </div>
        </div>
      </div>
    </div>
  );
}
