// lib/markets/geckoterminal.ts
// Solana-only token resolution helpers via GeckoTerminal.
// We support three inputs:
//   1) Tickers: "$bonk"  → resolveTickersToContracts
//   2) Contracts: <base58> → resolveContractsToMeta
//   3) Phrase Names: "unstable" → resolveNamesToContracts (search by token name)
//
// Ranking rule (after filtering to Solana):
//   Trending boost (if token is in Solana trending) >
//   DEX priority (PumpSwap > Raydium > Meteora > others) >
//   24h volume >
//   Liquidity (reserve USD) >
//   Market cap
//
// Quote preference: prefer SOL first, then USDC, then others.
// This is applied as an additive score on top of the DEX priority.

import { canonAddr, isSolAddr } from "@/lib/chains/address";

const GT_BASE =
  process.env.GECKOTERMINAL_BASE ?? "https://api.geckoterminal.com/api/v2";
const NETWORK = "solana";
const ACCEPTED_QUOTES = ["SOL", "USDC"] as const; // prefer SOL > USDC (weighted below)

// DEX priority: PumpSwap > Raydium > Meteora > others
function dexPriority(name?: string) {
  const s = String(name || "").toLowerCase();
  if (s.includes("pump")) return 3;
  if (s.includes("raydium")) return 2;
  if (s.includes("meteora")) return 1;
  return 0;
}

type VolUSD = { m5?: number; h1?: number; h6?: number; h24?: number };
type PoolAttrs = {
  reserve_in_usd?: number;
  volume_usd?: VolUSD;
  name?: string;
};
type TokenAttrs = { market_cap_usd?: number | null; fdv_usd?: number | null };

type Candidate = {
  addr: string; // base58 (canonical)
  symbol: string; // "$TICKER" for ticker flow, or real symbol for addr/name flow
  dexName: string; // e.g. Raydium
  dexScore: number; // 0..3
  volume24h: number; // numeric 24h USD
  reserveUsd: number; // pool reserve USD (liquidity)
  marketCap: number; // market_cap_usd or fdv_usd
  quoteSymbol?: string; // quote token symbol (for SOL/USDC preference)
  trendingBoost?: number; // 0..N (optional)
};

type GTToken = {
  id: string;
  symbol: string;
  address: string;
  attrs: TokenAttrs;
};

type GTDex = { id: string; name: string };

function pickVolume(v?: VolUSD): number {
  if (!v) return 0;
  return (
    (typeof v.h24 === "number" && v.h24) ||
    (typeof v.h6 === "number" && v.h6) ||
    (typeof v.h1 === "number" && v.h1) ||
    (typeof v.m5 === "number" && v.m5) ||
    0
  );
}
function pickMcap(t?: TokenAttrs): number {
  if (!t) return 0;
  if (typeof t.market_cap_usd === "number") return t.market_cap_usd;
  if (typeof t.fdv_usd === "number") return t.fdv_usd;
  return 0;
}

/** Additional score: prefer quote SOL > USDC > others */
function quotePreferenceScore(sym?: string): number {
  const s = (sym || "").toUpperCase();
  if (s === "SOL") return 2;
  if (s === "USDC") return 1;
  return 0;
}

/** Composite comparator for candidates */
function compareCandidates(a: Candidate, b: Candidate): number {
  const aScore =
    (a.trendingBoost ?? 0) * 100_000 + // trending weight dominates
    a.dexScore * 10_000 +
    quotePreferenceScore(a.quoteSymbol) * 5_000 +
    a.volume24h * 50 +
    a.reserveUsd * 5 +
    a.marketCap;

  const bScore =
    (b.trendingBoost ?? 0) * 100_000 +
    b.dexScore * 10_000 +
    quotePreferenceScore(b.quoteSymbol) * 5_000 +
    b.volume24h * 50 +
    b.reserveUsd * 5 +
    b.marketCap;

  return bScore - aScore;
}

/* -------------------------------------------------------------
 * Trending: we try a couple of GT endpoints and fallback to empty.
 * Keep this tolerant — GT may evolve the route path.
 * ----------------------------------------------------------- */
async function fetchSolanaTrendingAddrs(): Promise<Set<string>> {
  const out = new Set<string>();

  // Helper to process one response payload into addresses
  const collect = (j: any) => {
    const included = Array.isArray(j?.included) ? j.included : [];
    for (const x of included) {
      const ty = String(x?.type || "");
      if (!ty.includes("token")) continue;
      const addr = canonAddr(String(x?.attributes?.address || ""));
      if (addr && isSolAddr(addr)) out.add(addr);
    }
  };

  // Try likely endpoints in order; stop on first success with data
  const endpoints = [
    `${GT_BASE}/networks/${NETWORK}/trending_pools?include=base_token,quote_token`,
    `${GT_BASE}/trending_pools?network=${NETWORK}&include=base_token,quote_token`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j) collect(j);
      if (out.size > 0) break; // got something
    } catch {
      // ignore and try next endpoint
    }
  }

  return out;
}

/* -------------------------------------------------------------
 * Shared low-level fetcher for /search/pools
 * Returns Candidate[] for a given query string and interpretation.
 * mode: "ticker" | "addr" | "name"
 * ----------------------------------------------------------- */
async function searchPoolsAsCandidates(
  query: string,
  mode: "ticker" | "addr" | "name",
  trendingSet: Set<string>,
): Promise<Candidate[]> {
  try {
    const url = `${GT_BASE}/search/pools?query=${encodeURIComponent(query)}&network=${NETWORK}&include=base_token,quote_token,dex`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j: any = await res.json();
    const data = (Array.isArray(j?.data) ? j.data : []) as any[];
    const included = (Array.isArray(j?.included) ? j.included : []) as any[];

    const tokens: GTToken[] = included
      .filter((x: any) => String(x?.type || "").includes("token"))
      .map(
        (x: any): GTToken => ({
          id: String(x?.id ?? ""),
          symbol: String(x?.attributes?.symbol ?? ""),
          address: String(x?.attributes?.address ?? ""),
          attrs: {
            market_cap_usd: (x?.attributes?.market_cap_usd ??
              x?.attributes?.fdv_usd ??
              null) as number | null,
            fdv_usd: (x?.attributes?.fdv_usd ?? null) as number | null,
          },
        }),
      );

    const dexes: GTDex[] = included
      .filter((x: any) => String(x?.type || "").includes("dex"))
      .map(
        (x: any): GTDex => ({
          id: String(x?.id ?? ""),
          name: String(x?.attributes?.name ?? x?.attributes?.slug ?? ""),
        }),
      );
    const dexNameById = new Map(dexes.map((d) => [d.id, d.name]));

    const cands: Candidate[] = [];
    const qTicker =
      mode === "ticker" ? query.replace(/^\$+/, "").toLowerCase() : null;

    for (const p of data) {
      const attrs = (p?.attributes ?? {}) as PoolAttrs;
      const rels = p?.relationships ?? {};

      const baseId: string = String(rels?.base_token?.data?.id ?? "");
      const quoteId: string = String(rels?.quote_token?.data?.id ?? "");
      const dexRelId: string = String(rels?.dex?.data?.id ?? "");

      const base = tokens.find((t) => t.id === baseId);
      const quote = tokens.find((t) => t.id === quoteId);
      const dexName =
        dexNameById.get(dexRelId) ||
        String((attrs as any).dex_name ?? attrs.name ?? "");

      // Filter to pools that have a valid Solana base or quote address
      const baseIsSol = isSolAddr(base?.address || "");
      const quoteIsSol = isSolAddr(quote?.address || "");
      if (!baseIsSol && !quoteIsSol) continue;

      // Quote filter & score preference: prefer SOL > USDC, but allow others
      const quoteSymbol = String(quote?.symbol || "").toUpperCase();

      // Build candidate depending on mode
      let chosenAddr: string | null = null;
      let chosenSymbol: string = "";

      if (mode === "addr") {
        // We are resolving an address: pick the side that matches the query addr
        const addrLower = query;
        if (baseIsSol && canonAddr(base!.address) === addrLower) {
          chosenAddr = canonAddr(base!.address);
          chosenSymbol = base?.symbol || "";
        } else if (quoteIsSol && canonAddr(quote!.address) === addrLower) {
          chosenAddr = canonAddr(quote!.address);
          chosenSymbol = quote?.symbol || "";
        } else {
          continue;
        }
      } else if (mode === "ticker") {
        // Exact ticker match on either side; if both match, we prefer base side
        const baseMatch = String(base?.symbol || "").toLowerCase() === qTicker;
        const quoteMatch =
          String(quote?.symbol || "").toLowerCase() === qTicker;

        if (baseIsSol && baseMatch) {
          chosenAddr = canonAddr(base!.address);
          chosenSymbol = base?.symbol || "";
        } else if (quoteIsSol && quoteMatch) {
          chosenAddr = canonAddr(quote!.address);
          chosenSymbol = quote?.symbol || "";
        } else {
          continue;
        }
      } else {
        // mode === "name": fuzzy by name/symbol; prefer base side
        const nameQ = query.toLowerCase();
        const baseHit =
          String(base?.symbol || "").toLowerCase() === nameQ ||
          String(base?.symbol || "")
            .toLowerCase()
            .includes(nameQ);
        const quoteHit =
          String(quote?.symbol || "").toLowerCase() === nameQ ||
          String(quote?.symbol || "")
            .toLowerCase()
            .includes(nameQ);
        if (baseIsSol && baseHit) {
          chosenAddr = canonAddr(base!.address);
          chosenSymbol = base?.symbol || "";
        } else if (quoteIsSol && quoteHit) {
          chosenAddr = canonAddr(quote!.address);
          chosenSymbol = quote?.symbol || "";
        } else {
          continue;
        }
      }

      if (!chosenAddr) continue;

      const volume24h = pickVolume(attrs.volume_usd as VolUSD | undefined);
      const reserveUsd = Number(attrs.reserve_in_usd ?? 0);
      const trendingBoost = trendingSet.has(chosenAddr) ? 1 : 0;

      cands.push({
        addr: chosenAddr,
        symbol: chosenSymbol,
        dexName,
        dexScore: dexPriority(dexName),
        volume24h,
        reserveUsd,
        marketCap: pickMcap(
          // use the side we chose
          (chosenSymbol && base?.symbol === chosenSymbol
            ? base?.attrs
            : quote?.attrs) as TokenAttrs | undefined,
        ),
        quoteSymbol,
        trendingBoost,
      });
    }

    // Apply a small hard filter: if quote token is present, prefer SOL/USDC first in sorting
    // (we still allow others; preference is encoded via compareCandidates)
    return cands.sort(compareCandidates);
  } catch {
    return [];
  }
}

/* =============================================================
 * Public APIs
 * =========================================================== */

/** Resolve `$tickers` → Map<ticker(lower), { tokenKey: CA, tokenDisplay: "$TICKER", boostedConf }> */
export async function resolveTickersToContracts(tickers: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!tickers?.length) return out;

  const trending = await fetchSolanaTrendingAddrs();

  for (const raw of tickers) {
    const ticker = raw.replace(/^\$+/, "").toLowerCase();
    const symbolDisplay = `$${ticker.toUpperCase()}`;

    const cands = await searchPoolsAsCandidates(ticker, "ticker", trending);
    const best = cands[0];

    if (best) {
      out.set(ticker, {
        tokenKey: best.addr,
        tokenDisplay: symbolDisplay,
        // High confidence on Solana match; +1 if on preferred DEX; +1 if trending
        boostedConf:
          98 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost ? 1 : 0),
      });
    } else {
      // Fallback: unresolved ticker keeps a conservative confidence
      out.set(ticker, {
        tokenKey: ticker,
        tokenDisplay: symbolDisplay,
        boostedConf: 95,
      });
    }
  }

  return out;
}

/** Resolve contract addresses (base58) → Map<addr, { tokenKey: addr, tokenDisplay: "$SYMBOL" | "$Abc…xyz", boostedConf }> */
export async function resolveContractsToMeta(addrs: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!addrs?.length) return out;

  const trending = await fetchSolanaTrendingAddrs();
  const uniq = Array.from(
    new Set(addrs.map((a) => canonAddr(String(a || ""))).filter(isSolAddr)),
  );

  for (const addr of uniq) {
    const cands = await searchPoolsAsCandidates(addr, "addr", trending);
    const best = cands[0];

    if (best) {
      const sym = String(best.symbol || "").trim();
      const tokenDisplay = sym
        ? `$${sym.toUpperCase()}`
        : `$${addr.slice(0, 4)}…${addr.slice(-4)}`;
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay,
        boostedConf:
          99 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost ? 1 : 0),
      });
    } else {
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay: `$${addr.slice(0, 4)}…${addr.slice(-4)}`,
        boostedConf: 90,
      });
    }
  }

  return out;
}

/** Resolve phrase names (token names) → Map<name(lower), { tokenKey: CA, tokenDisplay: "$SYMBOL" | "$Abc…xyz", boostedConf }> */
export async function resolveNamesToContracts(names: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!names?.length) return out;

  const trending = await fetchSolanaTrendingAddrs();

  for (const raw of names) {
    const q = String(raw || "").trim();
    const qLower = q.toLowerCase();
    if (!qLower) continue;

    const cands = await searchPoolsAsCandidates(qLower, "name", trending);
    const best = cands[0];

    if (best) {
      const sym = String(best.symbol || "").trim();
      out.set(qLower, {
        tokenKey: best.addr,
        tokenDisplay: sym
          ? `$${sym.toUpperCase()}`
          : `$${best.addr.slice(0, 4)}…${best.addr.slice(-4)}`,
        boostedConf:
          95 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost ? 1 : 0),
      });
    } else {
      // unresolved; keep original phrase as display and low confidence
      out.set(qLower, { tokenKey: qLower, tokenDisplay: q, boostedConf: 70 });
    }
  }

  return out;
}
