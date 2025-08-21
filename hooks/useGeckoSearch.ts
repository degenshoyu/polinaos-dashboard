// hooks/useGeckoSearch.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ===== GeckoTerminal Search Types (subset) =====
 * We only describe fields we actually use to keep types small.
 */
type GTApiPool = {
  id: string; // "solana_22Wr..."
  type: "pool";
  attributes: {
    name: string; // e.g. "MOODENG / SOL"
    address: string; // pool address on chain
    pool_created_at?: string;

    base_token_price_usd?: string | null;
    quote_token_price_usd?: string | null;

    volume_usd?: {
      h24?: string | null;
    };

    reserve_in_usd?: string | null; // liquidity
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
  };
  relationships: {
    base_token?: { data?: { id: string; type: "token" } | null };
    quote_token?: { data?: { id: string; type: "token" } | null };
    dex?: { data?: { id: string; type: "dex" } | null };
  };
};

type GTApiToken = {
  id: string; // "solana_ED5n..."
  type: "token";
  attributes: {
    address: string;
    name: string;
    symbol: string; // ticker
    image_url?: string | null;
    decimals?: number | null;
    website_url?: string | null;
  };
};

type GTApiDex = {
  id: string; // e.g. "raydium"
  type: "dex";
  attributes?: { name?: string | null };
};

type GTIncluded = Array<GTApiToken | GTApiDex>;

/**
 * ===== Public option returned to the combobox =====
 */
export type TokenOption = {
  /** composite score for sorting (higher is better) */
  score: number;

  /** ids & addresses */
  poolId: string;
  poolAddress: string;
  baseTokenId: string;
  tokenAddress: string;

  /** labels / visuals */
  symbol: string; // use as "projectName"
  name: string;
  chain: string; // "solana" | "ethereum" | ...
  dex?: string | null;
  logo?: string | null;

  /** numbers parsed to number */
  priceUsd?: number | null;
  vol24h: number;
  liquidity: number;
  marketCap?: number | null;
  fdv?: number | null;

  /** misc display */
  pairName: string;
  poolAge?: string | null;
};

export type UseGeckoSearchOptions = {
  /** debounce delay for typing */
  debounceMs?: number;
  /** optional chain preferences (small positive boosts in ranking) */
  preferredChains?: string[];
  /** result limit after grouping by token */
  limit?: number;
  /** override api base (handy for mocks) */
  apiBase?: string;
};

/* ====================== Defaults ====================== */
const DEFAULTS: Required<
  Pick<
    UseGeckoSearchOptions,
    "debounceMs" | "preferredChains" | "limit" | "apiBase"
  >
> = {
  debounceMs: 250,
  preferredChains: [],
  limit: 20,
  apiBase: "https://api.geckoterminal.com/api/v2",
};

/* ====================== Utilities ====================== */
const toNum = (v?: string | null): number => {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const chainFromId = (id?: string): string => {
  // "solana_ED5n..." -> "solana"
  if (!id) return "";
  const i = id.indexOf("_");
  return i > 0 ? id.slice(0, i) : "";
};

const extractTicker = (pairName: string, baseSymbol?: string): string => {
  // Prefer base token symbol if provided, else take left side of "FOO / BAR"
  if (baseSymbol && baseSymbol.trim()) return baseSymbol.trim().toUpperCase();
  const left = (pairName || "").split("/")[0]?.trim();
  return (left || "").toUpperCase();
};

const nameMatchBoost = (
  query: string,
  symbol: string,
  name: string,
): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const sym = symbol.toLowerCase();
  const nm = (name || "").toLowerCase();

  // strong boosts for exact symbol match; smaller boosts for startsWith/contains
  if (sym === q) return 3.0;
  if (sym.startsWith(q)) return 1.0;
  if (sym.includes(q)) return 0.5;

  // small boosts for name match
  if (nm === q) return 0.6;
  if (nm.startsWith(q)) return 0.3;
  if (nm.includes(q)) return 0.15;

  return 0;
};

const chainSmallBoost = (chain: string, preferred: string[]): number => {
  if (!preferred?.length || !chain) return 0;
  const i = preferred.findIndex((c) => c.toLowerCase() === chain.toLowerCase());
  if (i < 0) return 0;
  // 1st +0.3, 2nd +0.2, 3rd+ +0.1
  return Math.max(0.1, 0.3 - i * 0.1);
};

/**
 * Scoring function:
 *  - 24h volume: strongest signal
 *  - liquidity: second
 *  - market cap / FDV: third
 *  - exact/partial name match: additive boosts
 *  - optional chain boost
 *
 * log10 is used to tame huge numbers; +1 to avoid log(0)
 */
const scorePool = (
  vol24h: number,
  liq: number,
  mcapOrFdv: number,
  nameBoost: number,
  chainBoost: number,
): number => {
  const sVol = Math.log10(1 + Math.max(0, vol24h));
  const sLiq = Math.log10(1 + Math.max(0, liq));
  const sCap = Math.log10(1 + Math.max(0, mcapOrFdv));
  return 3.0 * sVol + 1.6 * sLiq + 1.2 * sCap + nameBoost + chainBoost;
};

const uniqByKeepMaxScore = <T extends { score: number }>(
  arr: T[],
  key: (t: T) => string,
): T[] => {
  const map = new Map<string, T>();
  for (const it of arr) {
    const k = key(it);
    const prev = map.get(k);
    if (!prev || it.score > prev.score) map.set(k, it);
  }
  return Array.from(map.values());
};

const humanAge = (iso?: string | null): string | null => {
  if (!iso) return null;
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return null;
  const ms = Date.now() - created;
  if (ms < 0) return null;

  const d = Math.floor(ms / (24 * 3600 * 1000));
  const m = Math.floor(d / 30);
  const y = Math.floor(m / 12);
  if (y > 0) return `${y}y ${m % 12}mo`;
  if (m > 0) return `${m}mo ${d % 30}d`;
  return `${d}d`;
};

/* ====================== Hook ====================== */
export function useGeckoSearch(options?: UseGeckoSearchOptions) {
  const { debounceMs, preferredChains, limit, apiBase } = {
    ...DEFAULTS,
    ...(options || {}),
  };

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TokenOption[]>([]);

  const qRef = useRef(query);
  useEffect(() => {
    qRef.current = query;
  }, [query]);

  useEffect(() => {
    // reset list on empty query
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const url = `${apiBase}/search/pools?query=${encodeURIComponent(
          query.trim(),
        )}&include=base_token,quote_token`;

        const res = await fetch(url, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);

        const payload = (await res.json()) as {
          data?: GTApiPool[];
          included?: GTIncluded;
        };

        const pools = payload?.data ?? [];
        const included = payload?.included ?? [];

        // Build included maps (tokens & dexes)
        const tokenById = new Map<string, GTApiToken>();
        const dexById = new Map<string, GTApiDex>();
        for (const inc of included) {
          if (inc.type === "token") tokenById.set(inc.id, inc as GTApiToken);
          else if (inc.type === "dex") dexById.set(inc.id, inc as GTApiDex);
        }

        // Map pools → TokenOption
        const mapped: TokenOption[] = pools.map((p) => {
          const baseId = p.relationships?.base_token?.data?.id || "";
          const quoteId = p.relationships?.quote_token?.data?.id || "";
          const dexId = p.relationships?.dex?.data?.id || null;

          const base = tokenById.get(baseId);
          const quote = tokenById.get(quoteId);
          const dexName = dexId
            ? dexById.get(dexId)?.attributes?.name || dexId
            : null;

          const chain = chainFromId(base?.id || baseId);
          const ticker = extractTicker(
            p.attributes.name,
            base?.attributes?.symbol,
          );
          const displayName = base?.attributes?.name || ticker;

          const priceUsd = toNum(p.attributes.base_token_price_usd);
          const vol24h = toNum(p.attributes.volume_usd?.h24);
          const liquidity = toNum(p.attributes.reserve_in_usd);
          const marketCap = toNum(p.attributes.market_cap_usd) || null;
          const fdv = toNum(p.attributes.fdv_usd) || null;

          const capOrFdv = marketCap || fdv || 0;

          const nBoost = nameMatchBoost(qRef.current, ticker, displayName);
          const cBoost = chainSmallBoost(chain, preferredChains);
          const score = scorePool(vol24h, liquidity, capOrFdv, nBoost, cBoost);

          const tokenAddr = base?.attributes?.address || "";

          const opt: TokenOption = {
            score,
            poolId: p.id,
            poolAddress: p.attributes.address,
            baseTokenId: baseId,
            tokenAddress: tokenAddr,

            symbol: ticker,
            name: displayName,
            chain,
            dex: dexName,
            logo: base?.attributes?.image_url ?? null,

            priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
            vol24h,
            liquidity,
            marketCap,
            fdv,

            pairName: p.attributes.name,
            poolAge: humanAge(p.attributes.pool_created_at),
          };

          return opt;
        });

        // Group by base token contract (fallback to baseTokenId) and keep the highest score
        const grouped = uniqByKeepMaxScore(
          mapped,
          (o) => `${o.chain}:${o.tokenAddress || o.baseTokenId}`,
        );

        // Sort by:
        //  1) score desc (volume/liquidity dominate)
        //  2) vol24h desc as tie-breaker
        //  3) liquidity desc
        //  4) marketCap/FDV desc
        const sorted = grouped.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.vol24h !== a.vol24h) return b.vol24h - a.vol24h;
          if (b.liquidity !== a.liquidity) return b.liquidity - a.liquidity;
          const aCap = a.marketCap ?? a.fdv ?? 0;
          const bCap = b.marketCap ?? b.fdv ?? 0;
          return bCap - aCap;
        });

        setResults(sorted.slice(0, limit));
      } catch (e: any) {
        setError(e?.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [apiBase, debounceMs, limit, preferredChains, query]);

  const state = useMemo(
    () => ({ query, setQuery, loading, error, results }),
    [query, loading, error, results],
  );

  return state;
}
