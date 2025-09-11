// lib/markets/geckoterminal.ts
// Thin facade: exposes public APIs while delegating to modular pieces.

import {
  TICKER_ALIASES,
  MIN_LIQUIDITY_USD,
  MIN_VOLUME24H_USD,
  quotePreferenceScore,
} from "./gt.util";
import { fetchSolanaTrendingAddrs } from "./gt.api";
import {
  searchPoolsAsCandidates,
  tokenFallbackAsCandidates,
  pickBestForTicker,
  compareCandidates,
} from "./gt.build";
import { Candidate, TickerCandidateVerbose } from "./gt.types";

// In-memory trending symbols flag
let trendingSolanaSymbols = new Set<string>();
export function setTrendingSymbols(list: string[]) {
  trendingSolanaSymbols = new Set(list.map((s) => String(s).toLowerCase()));
}

/** $tickers → Map<ticker, { tokenKey, tokenDisplay, boostedConf }> */
export async function resolveTickersToContracts(tickers: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!tickers?.length) return out;

  const trendingAddrs = await fetchSolanaTrendingAddrs();

  for (const raw of tickers) {
    const t0 = String(raw || "")
      .replace(/^\$+/, "")
      .toLowerCase();
    if (!t0) continue;
    const symbolDisplay = `$${t0.toUpperCase()}`;

    // Build query variants: ticker, $ticker, aliases
    const variants = new Set<string>([t0, `$${t0}`]);
    for (const alias of TICKER_ALIASES[t0] || []) {
      variants.add(alias.toLowerCase());
      variants.add(`$${alias.toLowerCase()}`);
    }

    // 1) Pool-centric
    let merged: Candidate[] = [];
    for (const q of variants) {
      const part = await searchPoolsAsCandidates(
        q,
        "ticker",
        trendingAddrs,
        trendingSolanaSymbols,
      );
      merged.push(...part);
    }

    // 2) Token-centric fallback
    if (merged.length === 0) {
      merged = await tokenFallbackAsCandidates(
        Array.from(variants),
        trendingAddrs,
        trendingSolanaSymbols,
      );
    }
    if (!merged.length) continue;

    // Address clustering: frequency > totalVol > totalRes > bestDEX > bestQuote
    type Agg = {
      count: number;
      totalVol: number;
      totalRes: number;
      bestDex: number;
      bestQP: number;
    };
    const aggByAddr = new Map<string, Agg>();
    for (const c of merged) {
      const prev = aggByAddr.get(c.addr) || {
        count: 0,
        totalVol: 0,
        totalRes: 0,
        bestDex: 0,
        bestQP: 0,
      };
      prev.count += 1;
      prev.totalVol += Number(c.volume24h || 0);
      prev.totalRes += Number(c.reserveUsd || 0);
      prev.bestDex = Math.max(prev.bestDex, c.dexScore);
      prev.bestQP = Math.max(prev.bestQP, quotePreferenceScore(c.quoteSymbol));
      aggByAddr.set(c.addr, prev);
    }
    const bestAddr = Array.from(aggByAddr.entries()).sort((a, b) => {
      const A = a[1],
        B = b[1];
      return (
        B.count - A.count ||
        B.totalVol - A.totalVol ||
        B.totalRes - A.totalRes ||
        B.bestDex - A.bestDex ||
        B.bestQP - A.bestQP
      );
    })[0]?.[0];

    const cluster = merged
      .filter((c) => c.addr === bestAddr)
      .sort(compareCandidates);
    const best = pickBestForTicker(cluster);

    if (
      best &&
      ((best.volume24h ?? 0) >= MIN_VOLUME24H_USD ||
        (best.reserveUsd ?? 0) >= MIN_LIQUIDITY_USD)
    ) {
      out.set(t0, {
        tokenKey: best.addr,
        tokenDisplay: symbolDisplay,
        boostedConf: Math.min(
          100,
          98 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
        ),
      });
    }
  }
  return out;
}

/** addrs → Map<addr, { tokenKey, tokenDisplay, boostedConf }> */
export async function resolveContractsToMeta(addrs: string[]) {
  // Keep your previous implementation style — you can reuse searchPoolsAsCandidates + pickBestForTicker here.
  const trendingAddrs = await fetchSolanaTrendingAddrs();
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  const uniq = Array.from(new Set(addrs.map((a) => String(a || ""))));

  for (const addr of uniq) {
    const cands = (
      await searchPoolsAsCandidates(
        addr,
        "addr",
        trendingAddrs,
        trendingSolanaSymbols,
      )
    ).sort(compareCandidates);
    const best = pickBestForTicker(cands);
    if (
      best &&
      ((best.volume24h ?? 0) >= MIN_VOLUME24H_USD ||
        (best.reserveUsd ?? 0) >= MIN_LIQUIDITY_USD)
    ) {
      const sym = String(best.symbol || "").trim();
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay: sym
          ? `$${sym.toUpperCase()}`
          : `${addr.slice(0, 4)}…${addr.slice(-4)}`,
        boostedConf: Math.min(
          100,
          99 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
        ),
      });
    } else {
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay: `${addr.slice(0, 4)}…${addr.slice(-4)}`,
        boostedConf: 90,
      });
    }
  }
  return out;
}

/** names → Map<name(lower), { tokenKey, tokenDisplay, boostedConf }> */
export async function resolveNamesToContracts(names: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!names?.length) return out;

  const trendingAddrs = await fetchSolanaTrendingAddrs();

  for (const raw of names) {
    const q = String(raw || "").trim();
    const qLower = q.toLowerCase();
    if (!qLower) continue;

    // pool name fuzzy
    let cands = await searchPoolsAsCandidates(
      qLower,
      "name",
      trendingAddrs,
      trendingSolanaSymbols,
    );
    if (!cands.length)
      cands = await searchPoolsAsCandidates(
        `${qLower} coin`,
        "name",
        trendingAddrs,
        trendingSolanaSymbols,
      );
    cands = cands.sort(compareCandidates);

    const best = pickBestForTicker(cands);
    if (
      best &&
      ((best.volume24h ?? 0) >= MIN_VOLUME24H_USD ||
        (best.reserveUsd ?? 0) >= MIN_LIQUIDITY_USD)
    ) {
      const sym = String(best.symbol || "").trim();
      out.set(qLower, {
        tokenKey: best.addr,
        tokenDisplay: sym
          ? `$${sym.toUpperCase()}`
          : `${best.addr.slice(0, 4)}…${best.addr.slice(-4)}`,
        boostedConf: Math.min(
          100,
          95 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
        ),
      });
    } else {
      out.set(qLower, { tokenKey: qLower, tokenDisplay: q, boostedConf: 70 });
    }
  }
  return out;
}

/** verbose candidates for auditing (used by scripts/scout-ticker.ts) */
export async function getTickerCandidatesVerbose(
  tickers: string[],
  maxPer = 20,
): Promise<Map<string, TickerCandidateVerbose[]>> {
  const out = new Map<string, TickerCandidateVerbose[]>();
  if (!Array.isArray(tickers) || tickers.length === 0) return out;

  const trendingAddrs = await fetchSolanaTrendingAddrs();

  const compositeScore = (c: Candidate) =>
    c.trendingBoost * 100_000 +
    c.dexScore * 10_000 +
    (c.quoteSymbol
      ? ["SOL", "WSOL"].includes(c.quoteSymbol)
        ? 2
        : c.quoteSymbol === "USDC"
          ? 1
          : 0
      : 0) *
      5_000 +
    (c.volume24h ?? 0) * 50 +
    (c.reserveUsd ?? 0) * 5 +
    (c.marketCap ?? 0);

  for (const raw of tickers) {
    const t0 = String(raw || "")
      .replace(/^\$+/, "")
      .toLowerCase();
    if (!t0) continue;

    const variants = new Set<string>([t0, `$${t0}`]);
    for (const alias of TICKER_ALIASES[t0] || []) {
      variants.add(alias.toLowerCase());
      variants.add(`$${alias.toLowerCase()}`);
    }

    let merged: Candidate[] = [];
    for (const q of variants) {
      merged.push(
        ...(await searchPoolsAsCandidates(
          q,
          "ticker",
          trendingAddrs,
          trendingSolanaSymbols,
        )),
      );
    }
    if (merged.length === 0)
      merged = await tokenFallbackAsCandidates(
        Array.from(variants),
        trendingAddrs,
        trendingSolanaSymbols,
      );

    const freq = new Map<string, number>();
    for (const c of merged) freq.set(c.addr, (freq.get(c.addr) || 0) + 1);

    const ranked = merged.sort(compareCandidates).slice(0, Math.max(1, maxPer));
    out.set(
      t0,
      ranked.map((c) => ({
        ...c,
        score: compositeScore(c),
        addrFreq: freq.get(c.addr) || 1,
      })),
    );
  }
  return out;
}
