// components/leaderboard/KolTweetsModal.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, CalendarDays } from "lucide-react";
import Pagination from "@/components/ui/Pagination";

type CoinSnap = {
  tokenKey: string;
  tokenDisplay: string;
  priceUsdAt: number | null;
};

type TweetItem = {
  id: string;
  text: string;
  url: string;
  createdAt: string; // ISO
  detectedCoins: CoinSnap[];
};

type ApiResp = {
  items: TweetItem[];
  page: number;
  pageSize: number;
  total: number;
};

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
  handle: string;
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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Portal mount & body lock
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [open]);

  // Fetch tweets
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const qs = new URLSearchParams({ handle, days: String(days), page: String(page), pageSize: "10" });
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
  }, [open, handle, days, page]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const content = (
    <div
      aria-modal
      role="dialog"
      className="fixed inset-0 z-[1000]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="
          absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[min(100vw-24px,1000px)]
          max-h-[85vh] overflow-hidden
          rounded-2xl border border-white/10 bg-gradient-to-br from-[#0d1312] to-[#0a0f0e] shadow-2xl
        "
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <img src={avatar || "/favicon.ico"} alt={handle} className="h-9 w-9 rounded-full object-cover" />
          <div className="min-w-0">
            <div className="text-white font-semibold truncate">{displayName || handle}</div>
            <div className="text-xs text-gray-400 truncate">@{handle}</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
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

        {/* Body */}
        <div className="p-4 overflow-auto max-h-[calc(85vh-56px-64px)]">
          {loading && (
            <div className="text-sm text-gray-400">Loading tweets…</div>
          )}
          {err && (
            <div className="text-sm text-red-300">❌ {err}</div>
          )}
          {!loading && !err && data && data.items.length === 0 && (
            <div className="text-sm text-gray-400">No tweets in the selected period.</div>
          )}

          {/* Tweets list */}
          <div className="space-y-3">
            {data?.items.map((t) => (
              <article
                key={t.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <CalendarDays size={14} />
                  <time dateTime={t.createdAt}>
                    {new Date(t.createdAt).toLocaleString()}
                  </time>
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
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                  {t.text}
                </p>

                {t.detectedCoins?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.detectedCoins.map((c) => (
                      <span
                        key={`${t.id}-${c.tokenKey}`}
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200"
                        title={c.tokenKey}
                      >
                        {c.tokenDisplay}
                        <span className="opacity-80">
                          {c.priceUsdAt != null ? `$${c.priceUsdAt.toFixed(4)}` : "n/a"}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
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

