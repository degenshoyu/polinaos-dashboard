// app/gecko-test/page.tsx
"use client";
import { useState } from "react";
import { useGeckoSearch } from "@/hooks/useGeckoSearch";

export default function GeckoTest() {
  const [q, setQ] = useState("");
  const { items, loading, error, search } = useGeckoSearch({
    preferredChain: "solana",
    debounceMs: 300,
    limit: 10,
    enableBackendFallback: false,
  });

  return (
    <div className="p-6 space-y-4">
      <input
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3"
        placeholder="Search by ticker or address (e.g., moodeng, 0x..., 9n4...)"
        value={q}
        onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
      />
      {loading && <div>Loading…</div>}
      {error && <div className="text-red-400">Error: {error}</div>}
      <pre className="text-xs opacity-80 overflow-x-auto">
        {JSON.stringify(items, null, 2)}
      </pre>
    </div>
  );
}
