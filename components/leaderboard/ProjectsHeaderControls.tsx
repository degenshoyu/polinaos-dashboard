// components/leaderboard/ProjectsHeaderControls.tsx
// Controls styled to feel consistent with KOL controls (light border, glassy bg).

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type SortKey = "attention" | "views" | "shillers" | "social" | "mcap" | "price";
type TokenType = "all" | "meme" | "utility";

export interface ControlsValue {
  preset: "7d" | "30d";
  q: string;
  type: TokenType;
  sort: SortKey;
  order: "asc" | "desc";
}

function setParam(sp: URLSearchParams, k: string, v?: string) {
  if (v && v.length) sp.set(k, v);
  else sp.delete(k);
}

export default function ProjectsHeaderControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize from URL
  const initial: ControlsValue = useMemo(
    () => ({
      preset: (searchParams.get("preset") as "7d" | "30d") ?? "7d",
      q: searchParams.get("q") ?? "",
      type: (searchParams.get("type") as TokenType) ?? "all",
      sort: (searchParams.get("sort") as SortKey) ?? "attention",
      order: (searchParams.get("order") as "asc" | "desc") ?? "desc",
    }),
    [searchParams],
  );

  const [q, setQ] = useState(initial.q);

  const applyChange = useCallback(
    (patch: Partial<ControlsValue>) => {
      const sp = new URLSearchParams(searchParams.toString());
      const next = { ...initial, q, ...patch };

      setParam(sp, "preset", next.preset);
      setParam(sp, "q", next.q.trim());
      setParam(sp, "type", next.type);
      setParam(sp, "sort", next.sort);
      setParam(sp, "order", next.order);
      setParam(sp, "page", "1"); // reset page on filter changes

      router.replace(`${pathname}?${sp.toString()}`);
    },
    [initial, pathname, q, router, searchParams],
  );

  const onSubmitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      applyChange({ q });
    },
    [applyChange, q],
  );

  const utilityOnly = initial.type === "utility";

  return (
    <div className="relative z-[60] w-full md:flex md:flex-nowrap md:items-center">
      {/* Search box */}
      <form
        onSubmit={onSubmitSearch}
        className="relative z-[60] shrink-0 self-end
                   flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2
                   w-full min-w-0 md:min-w-[240px] md:max-w-[380px] md:w-[min(38vw,380px)]"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any token (ticker / CA / name)…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500 text-white"
          aria-label="Search tokens"
        />
        <button
          type="submit"
          className="rounded-md border border-white/10 bg-white/10 px-2 py-1 text-sm text-white/80 hover:bg-white/15"
        >
          Search
        </button>
      </form>

      {/* Right cluster */}
      <div className="ml-auto mt-2 flex flex-col items-stretch gap-2 md:mt-0 md:flex-row md:flex-wrap md:items-center">
        {/* Period */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => applyChange({ preset: "7d" })}
            className={[
              "px-3 py-1 text-sm rounded-md",
              initial.preset === "7d" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={initial.preset === "7d"}
          >
            7d
          </button>
          <button
            onClick={() => applyChange({ preset: "30d" })}
            className={[
              "px-3 py-1 text-sm rounded-md",
              initial.preset === "30d" ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
            ].join(" ")}
            aria-pressed={initial.preset === "30d"}
          >
            30d
          </button>
        </div>

        {/* Type select (kept) */}
        <select
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/90"
          value={initial.type}
          onChange={(e) => applyChange({ type: e.target.value as TokenType })}
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="meme">Meme</option>
          <option value="utility">Utility</option>
        </select>

        {/* Sort */}
        <select
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/90"
          value={initial.sort}
          onChange={(e) => applyChange({ sort: e.target.value as SortKey })}
          aria-label="Sort by"
        >
          <option value="attention">Attention Score</option>
          <option value="views">Views</option>
          <option value="shillers">Unique Shillers</option>
          <option value="mcap">Market Cap</option>
          <option value="price">Price</option>
        </select>

        {/* Order */}
        <button
          className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/80 hover:text-white/100"
          onClick={() => applyChange({ order: initial.order === "desc" ? "asc" : "desc" })}
          aria-label="Toggle sort order"
        >
          {initial.order === "desc" ? "↓ Desc" : "↑ Asc"}
        </button>

        {/* Utility only toggle (slider) */}
        <button
          onClick={() => applyChange({ type: utilityOnly ? "all" : "utility" })}
          role="switch"
          aria-checked={utilityOnly}
          className={[
            "ml-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 border",
            utilityOnly
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
              : "border-white/10 bg-white/5 text-white/80",
          ].join(" ")}
          title="Show only Utility projects"
        >
          <span
            className={[
              "h-5 w-9 rounded-full border transition-colors",
              utilityOnly ? "border-emerald-400/50 bg-emerald-500/40" : "border-white/15 bg-white/10",
            ].join(" ")}
            aria-hidden
          >
            <span
              className={[
                "block h-5 w-5 rounded-full bg-white/90 transition-transform",
                utilityOnly ? "translate-x-4" : "translate-x-0",
              ].join(" ")}
            />
          </span>
          <span className="text-sm">Utility only</span>
        </button>
      </div>
    </div>
  );
}
