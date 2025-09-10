// components/leaderboard/KolTweetsModal.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, CalendarDays, Table2, Copy } from "lucide-react";
import Pagination from "@/components/ui/Pagination";

type CoinSnap = {
  tokenKey: string;
  tokenDisplay: string;
  // Backend may return string for DECIMAL; we accept string | number | null
  priceUsdAt: string | number | null;
};

type TweetItem = {
  id: string;        // tweet id
  text: string;
  url: string;       // tweet link
  createdAt: string; // ISO
  views: number;
  replies: number;
  retweets: number;  // = Reposts
  likes: number;
  detectedCoins: CoinSnap[];
  hasCoins?: boolean; // hint for quick filtering on client
};

type ApiResp = {
  items: TweetItem[];
  page: number;
  pageSize: number;
  total: number;
  kol?: {
    username: string;
    followers?: number;
    bio?: string | null;
    avatar?: string | null;
  };
};

type ViewMode = "content" | "stats";
type FilterMode = "all" | "coins";

export default function KolTweetsModal({
  open,
  onClose,
  handle,
  displayName,
  avatar,
  initialDays,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;   // username without "@"
  displayName?: string;
  avatar?: string;
  initialDays: 7 | 30;
}) {
  const [mounted, setMounted] = useState(false);
  const [days, setDays] = useState<7 | 30>(initialDays);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Default view: stats + coins only (as requested)
  const [view, setView] = useState<ViewMode>("stats");
  const [filterMode, setFilterMode] = useState<FilterMode>("coins");

  // Sorting for stats mode
  const [sortKey, setSortKey] = useState<keyof TweetItem>("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Copy feedback state per tokenKey (short-lived)
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Portal mount & lock body scroll while open
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [open]);

  // Fetch tweets when params change
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        // Pass filter/sort/dir/mode to backend; UI still works if backend ignores them
        const qs = new URLSearchParams({
          handle,
          days: String(days),
          page: String(page),
          pageSize: "10",
          filter: filterMode,  // 'all' | 'coins'
          mode: view,          // 'content' | 'stats'
          sort: sortKey,
          dir: sortDir,
        });
        const r = await fetch(`/api/kols/tweets?${qs.toString()}`, { cache: "no-store" });
        const json = (await r.json()) as ApiResp;
        if (!r.ok) throw new Error((json as any)?.error || r.statusText);
        if (!aborted) setData(json);
      } catch (e: any) {
        if (!aborted) setErr(e?.message || "Failed to load tweets");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [open, handle, days, page, filterMode, view, sortKey, sortDir]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Cleanup copy feedback timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const profileUrl = `https://x.com/${handle}`;

  // Local sorting (safeguard if backend doesn't implement sorting)
  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    const list = [...data.items];

    if (view === "stats") {
      list.sort((a, b) => {
        const av = (a as any)[sortKey] ?? 0;
        const bv = (b as any)[sortKey] ?? 0;
        if (typeof av === "string" && typeof bv === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (av === bv) return 0;
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }

    if (filterMode === "coins") {
      return list.filter((t) => t.hasCoins ?? (t.detectedCoins?.length > 0));
    }
    return list;
  }, [data, view, sortKey, sortDir, filterMode]);

  // Deduplicate coins by tokenKey for rendering (avoid duplicate keys/badges)
  const uniqueCoins = (coins: CoinSnap[]) =>
    Array.from(new Map(coins.map((c) => [c.tokenKey, c])).values());

  // Copy tokenKey (CA) helper with small feedback
  const handleCopy = async (ca: string) => {
    try {
      await navigator.clipboard.writeText(ca);
      setCopiedKey(ca);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      // no-op; keep UI silent if clipboard denied
    }
  };

  if (!mounted || !open) return null;

  /* ========== Header ========== */
  const header = (
    <div className="flex items-start gap-3 p-4 border-b border-white/10">
      <img
        src={data?.kol?.avatar || avatar || "/favicon.ico"}
        alt={handle}
        className="h-10 w-10 rounded-full object-cover"
      />
      <div className="min-w-0 flex-1">
        {/* username only, clickable to X profile */}
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white font-semibold truncate hover:underline"
          title={`Open @${handle} on X`}
        >
          {data?.kol?.username || handle}
        </a>

        {/* followers on one line */}
        <div className="text-xs text-gray-300">
          {typeof data?.kol?.followers === "number" &&
            `${data.kol.followers.toLocaleString()} followers`}
        </div>

        {/* bio on its own line under followers */}
        {data?.kol?.bio && (
          <div className="mt-1 text-xs text-gray-400 line-clamp-2">
            {data.kol.bio}
          </div>
        )}
      </div>

      {/* Right-side controls: Days / Filter / View / Close */}
      <div className="ml-2 flex items-center gap-2">
        {/* Days: 7d / 30d */}
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => { setDays(7); setPage(1); }}
            className={[
              "px-3 py-1 text-sm rounded-md",
              days === 7 ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={days === 7}
          >
            7d
          </button>
          <button
            onClick={() => { setDays(30); setPage(1); }}
            className={[
              "px-3 py-1 text-sm rounded-md",
              days === 30 ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={days === 30}
          >
            30d
          </button>
        </div>

        {/* Filter: Show All / Coins only (default coins) */}
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => { setFilterMode("all"); setPage(1); }}
            className={[
              "px-3 py-1 text-sm rounded-md",
              filterMode === "all" ? "bg-white/15 text-white" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={filterMode === "all"}
            title="Show All tweets"
          >
            Show All
          </button>
          <button
            onClick={() => { setFilterMode("coins"); setPage(1); }}
            className={[
              "px-3 py-1 text-sm rounded-md",
              filterMode === "coins" ? "bg-white/15 text-white" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={filterMode === "coins"}
            title="Show tweets with coins only"
          >
            Coins only
          </button>
        </div>

        {/* View mode: Content / Stats (default stats) */}
        <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => setView("content")}
            className={[
              "px-3 py-1 text-sm rounded-md",
              view === "content" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={view === "content"}
            title="Content mode"
          >
            Content
          </button>
          <button
            onClick={() => setView("stats")}
            className={[
              "px-3 py-1 text-sm rounded-md",
              view === "stats" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={view === "stats"}
            title="Stats mode"
          >
            Stats
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="rounded-lg p-2 border border-white/10 text-gray-200 hover:bg-white/10"
          aria-label="Close"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );

  /* ========== Content Mode ========== */
  const contentList = (
    <div className="space-y-3">
      {sortedItems.map((t) => (
        <article key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <CalendarDays size={14} />
            <time dateTime={t.createdAt}>{new Date(t.createdAt).toLocaleString()}</time>
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto underline hover:text-gray-200"
              onClick={(e) => e.stopPropagation()}
            >
              View on X
            </a>
          </div>

          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{t.text}</p>

          {/* Metrics */}
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-white/10 px-2 py-1 text-gray-300">Views: {t.views.toLocaleString()}</span>
            <span className="rounded-md border border-white/10 px-2 py-1 text-gray-300">Replies: {t.replies.toLocaleString()}</span>
            <span className="rounded-md border border-white/10 px-2 py-1 text-gray-300">Reposts: {t.retweets.toLocaleString()}</span>
            <span className="rounded-md border border-white/10 px-2 py-1 text-gray-300">Likes: {t.likes.toLocaleString()}</span>
          </div>

          {/* Coins (deduplicated) */}
          {t.detectedCoins?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {uniqueCoins(t.detectedCoins).map((c, idx) => {
                const num = typeof c.priceUsdAt === "string" ? Number(c.priceUsdAt) : c.priceUsdAt;
                const priceText =
                  num != null && !Number.isNaN(num) ? `$${num.toFixed(6)}` : "n/a";
                const isCopied = copiedKey === c.tokenKey;
                return (
                  <span
                    key={`${t.id}-${c.tokenKey}-${idx}`}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200"
                    title={c.tokenKey}
                  >
                    {c.tokenDisplay}
                    <span className="opacity-80">{priceText}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(c.tokenKey)}
                      className="ml-1 inline-flex items-center rounded px-1 py-[2px] hover:bg-emerald-400/20"
                      title="Copy contract address"
                      aria-label="Copy contract address"
                    >
                      <Copy size={12} />
                    </button>
                    {isCopied && <span className="ml-1 text-[10px] text-emerald-200/80">Copied!</span>}
                  </span>
                );
              })}
            </div>
          )}
        </article>
      ))}
    </div>
  );

  /* ========== Stats Mode ========== */
  const thCls = "px-3 py-2 text-left text-xs font-semibold text-gray-300 cursor-pointer select-none";
  const tdCls = "px-3 py-2 text-sm text-gray-200 border-t border-white/5";

  const statsTable = (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-white/[0.03]">
          <tr>
            {([
              ["id", "Tweet ID"],
              ["views", "Views"],
              ["replies", "Replies"],
              ["retweets", "Reposts"],
              ["likes", "Likes"],
              ["createdAt", "Published"],
              ["detectedCoins", "Token & Price"],
            ] as const).map(([key, label]) => (
              <th
                key={key}
                className={thCls}
                onClick={() => {
                  if (key === "detectedCoins") return; // No sorting on coin column
                  const k = key as keyof TweetItem;
                  if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  else { setSortKey(k); setSortDir("desc"); }
                }}
                aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                <span className="inline-flex items-center gap-1">
                  {label}
                  {sortKey === key && <Table2 size={14} className="opacity-60" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((t) => {
            const first = uniqueCoins(t.detectedCoins)[0];
            const firstNum =
              first && (typeof first.priceUsdAt === "string" ? Number(first.priceUsdAt) : first.priceUsdAt);
            const priceText =
              firstNum != null && !Number.isNaN(firstNum) ? `$${firstNum.toFixed(6)}` : "(n/a)";
            const isCopied = first ? copiedKey === first.tokenKey : false;

            return (
              <tr key={t.id} className="hover:bg-white/[0.03]">
                <td className={tdCls}>
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {t.id}
                  </a>
                </td>
                <td className={tdCls}>{t.views.toLocaleString()}</td>
                <td className={tdCls}>{t.replies.toLocaleString()}</td>
                <td className={tdCls}>{t.retweets.toLocaleString()}</td>
                <td className={tdCls}>{t.likes.toLocaleString()}</td>
                <td className={tdCls}>
                  <time dateTime={t.createdAt}>{new Date(t.createdAt).toLocaleString()}</time>
                </td>
                <td className={tdCls}>
                  {first ? (
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-200">{first.tokenDisplay}</span>
                      <span className="opacity-80">{priceText}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(first.tokenKey)}
                        className="inline-flex items-center rounded px-1 py-[2px] hover:bg-emerald-400/20"
                        title="Copy contract address"
                        aria-label="Copy contract address"
                      >
                        <Copy size={14} />
                      </button>
                      {isCopied && <span className="text-[10px] text-emerald-200/80">Copied!</span>}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /* ========== Layout Shell ========== */
  const content = (
    <div aria-modal role="dialog" className="fixed inset-0 z-[1000]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      {/* Panel */}
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="
          absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(100vw-24px,1100px)]
          max-h-[85vh] overflow-hidden
          rounded-2xl border border-white/10 bg-gradient-to-br from-[#0d1312] to-[#0a0f0e] shadow-2xl
        "
      >
        {header}

        {/* Body */}
        <div className="p-4 overflow-auto max-h-[calc(85vh-56px-64px)]">
          {loading && <div className="text-sm text-gray-400">Loading tweets…</div>}
          {err && <div className="text-sm text-red-300">❌ {err}</div>}
          {!loading && !err && data && sortedItems.length === 0 && (
            <div className="text-sm text-gray-400">No tweets in the selected period.</div>
          )}

          {!loading && !err && data && (view === "content" ? contentList : statsTable)}
        </div>

        {/* Footer (pagination) */}
        <div className="p-4 border-t border-white/10">
          {data && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
              className="justify-center"
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
