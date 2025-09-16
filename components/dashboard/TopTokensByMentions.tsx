"use client";

/**
 * Card: Top Tokens by Mentions (presentational only)
 * - Visual style matches the "Top KOLs by Coins Views" card.
 * - Row: $TICKER · <shortened contract> · N shills
 * - No local fetching or days toggle (driven by the server page).
 */

import * as React from "react";
import { cn } from "@/components/ui/utils";
import { Copy } from "lucide-react";

export type TokenMentionsItem = {
  tokenKey: string;
  tokenDisplay: string;
  contractAddress?: string | null;
  mentions: number;
};

type Props = {
  rows: TokenMentionsItem[];
  days: 7 | 30;
  title?: string;
};

export default function TopTokensByMentions({ rows, days, title = "Top Tokens by Mentions" }: Props) {
  const [copied, setCopied] = React.useState<string | null>(null);

  const copyCA = async (ca?: string | null) => {
    if (!ca) return;
    try {
      await navigator.clipboard.writeText(ca);
      setCopied(ca);
      setTimeout(() => setCopied(null), 900);
    } catch {/* no-op */}
  };

  return (
    <div
      className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-4
                 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20
                 hover:shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
    >
      {/* subtle highlight like the KOLs card */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative flex items-center gap-2 mb-3">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-emerald-300" fill="currentColor" aria-hidden>
          <path d="M12 2a1 1 0 0 1 .894.553l1.276 2.553 2.82.41a1 1 0 0 1 .554 1.705l-2.04 1.988.482 2.81a1 1 0 0 1-1.451 1.054L12 12.87l-2.535 1.334a1 1 0 0 1-1.45-1.054l.482-2.81-2.04-1.988a1 1 0 0 1 .554-1.705l2.82-.41L11.106 2.553A1 1 0 0 1 12 2Z"/>
        </svg>
        <div className="font-medium">
          {title} <span className="opacity-70">({days}d)</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No tokens found in this range.</div>
      ) : (
        <ul className="relative space-y-2 text-sm">
          {rows.map((r) => {
            const ca = r.contractAddress ?? "";
            const isCopied = copied === ca;
            return (
              <li
                key={`${r.tokenKey}-${ca || "noca"}`}
                className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 bg-black/30
                           transition-all duration-200 hover:border-white/20 hover:bg-black/40 hover:-translate-y-0.5
                           hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]"
              >
                {/* left: ticker + shortened contract (copyable, no 'CA ' prefix) */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/90">
                    {r.tokenDisplay || r.tokenKey.toUpperCase()}
                  </span>

                  {ca ? (
                    <button
                      onClick={() => copyCA(ca)}
                      className={cn(
                        "group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                        "border-white/10 bg-white/5 hover:bg-white/10 text-gray-200"
                      )}
                      title="Copy contract address"
                      aria-label={`Copy ${ca}`}
                    >
                      <span className="truncate max-w-[38vw] md:max-w-[28vw]">{shorten(ca)}</span>
                      {isCopied ? (
                        <span className="text-emerald-300">✓</span>
                      ) : (
                        <Copy className="h-3.5 w-3.5 opacity-60 group-hover:opacity-90" />
                      )}
                    </button>
                  ) : null}
                </div>

                {/* right: shills */}
                <div className="shrink-0 text-right text-xs md:text-sm text-gray-300">
                  <span className="font-semibold text-white/90 tabular-nums">{r.mentions}</span> shills
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function shorten(s: string, left = 5, right = 5) {
   if (!s) return s;
   const min = left + right + 1; // +1 for the ellipsis
   return s.length <= min ? s : `${s.slice(0, left)}…${s.slice(-right)}`;
}
