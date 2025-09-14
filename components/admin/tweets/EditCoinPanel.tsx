"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

type CoinOption = {
  id: string;
  tokenTicker: string;
  contractAddress: string;
};

function shortCa(ca?: string | null) {
  if (!ca) return "";
  return ca.length >= 8 ? `${ca.slice(0, 4)}…${ca.slice(-4)}` : ca;
}

// store token_display as "$TICKER"
function buildDisplay(opt: CoinOption) {
  return `$${opt.tokenTicker}`;
}

export default function EditCoinPanel({
  open,
  selectedCount,
  selectedTweetIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  selectedCount: number;
  selectedTweetIds: string[];
  onClose: () => void;
  onSaved: () => void; // caller will refresh + clear selection
}) {
  const [term, setTerm] = useState("");
  const [opts, setOpts] = useState<CoinOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CoinOption | null>(null);
  const debounce = useRef<NodeJS.Timeout | null>(null);

  // reset when toggling open
  useEffect(() => {
    if (!open) return;
    setTerm("");
    setOpts([]);
    setErr(null);
    setChosen(null);
  }, [open]);

  // debounced search
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const q = term.trim();
      if (!q) {
        setOpts([]);
        setErr(null);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const sp = new URLSearchParams();
        sp.set("q", q);
        sp.set("limit", "20");
        const r = await fetch(`/api/kols/coins/search?${sp.toString()}`, {
          cache: "no-store",
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
        setOpts((data.items ?? []) as CoinOption[]);
      } catch (e: any) {
        setErr(e?.message ?? "search failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, open]);

  const save = async () => {
    if (!chosen || selectedTweetIds.length === 0) return;
    try {
      const body = {
        tweetIds: selectedTweetIds,
        newTokenKey: chosen.contractAddress,
        newTokenDisplay: buildDisplay(chosen),
      };
      const r = await fetch("/api/kols/mentions/bulk-set-coin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      onSaved(); // parent will refresh + clear selection
    } catch (e: any) {
      setErr(e?.message ?? "save failed");
    }
  };

  if (!open) return null;

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <Search size={14} className="opacity-70" />
        <input
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-500"
          placeholder="Search coin by ticker or contract address…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
        />
        <div className="text-xs text-gray-400">
          Selected:{" "}
          <b className="text-white">
            {chosen ? `$${chosen.tokenTicker}` : "—"}
          </b>
        </div>
      </div>
      {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
      <div className="mt-2 max-h-40 overflow-auto rounded border border-white/10">
        {loading && <div className="p-2 text-xs text-gray-400">Searching…</div>}
        {!loading && opts.length === 0 && term && (
          <div className="p-2 text-xs text-gray-400">No results</div>
        )}
        {!loading && opts.length > 0 && (
          <ul className="text-sm">
            {opts.map((opt) => (
              <li
                key={opt.id}
                className={`px-3 py-2 cursor-pointer hover:bg-white/10 ${
                  chosen?.id === opt.id ? "bg-white/10" : ""
                }`}
                onClick={() => setChosen(opt)}
                title={opt.contractAddress}
              >
                <span className="font-medium">${opt.tokenTicker}</span>{" "}
                <span className="text-gray-400">({shortCa(opt.contractAddress)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
        <div>{selectedCount} tweets selected</div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 disabled:opacity-50"
            onClick={save}
            disabled={!chosen || selectedTweetIds.length === 0}
            title="Apply coin to selected tweets and reset their price_usd_at"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
