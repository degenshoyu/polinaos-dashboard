// lib/markets/gt.build.ts
// Parse/construct candidates, sorters & fallbacks

import { Candidate, GTDex, GTToken, PoolAttrs, TokenAttrs } from "./gt.types";
import {
  dice,
  isAllowedDex,
  dexPriority,
  pickVolume,
  pickPoolMcap,
  pickTokenMcap,
  quotePreferenceScore,
  stripDollar,
  toNum,
  MIN_LIQUIDITY_USD,
  MIN_VOLUME24H_USD,
} from "./gt.util";
import { canonAddr, isSolAddr } from "@/lib/chains/address";
import { searchPools, searchTokens, fetchPoolsForToken } from "./gt.api";

export function compareCandidates(a: Candidate, b: Candidate): number {
  const aScore =
    a.trendingBoost * 100_000 +
    a.dexScore * 10_000 +
    quotePreferenceScore(a.quoteSymbol) * 5_000 +
    a.volume24h * 50 +
    a.reserveUsd * 5 +
    a.marketCap;

  const bScore =
    b.trendingBoost * 100_000 +
    b.dexScore * 10_000 +
    quotePreferenceScore(b.quoteSymbol) * 5_000 +
    b.volume24h * 50 +
    b.reserveUsd * 5 +
    b.marketCap;

  return bScore - aScore;
}

function parseIncludedTokens(included: any[]): GTToken[] {
  return included
    .filter((x: any) => String(x?.type || "").includes("token"))
    .map(
      (x: any): GTToken => ({
        id: String(x?.id ?? ""),
        symbol: String(x?.attributes?.symbol ?? ""),
        name: String(x?.attributes?.name ?? ""),
        address: String(x?.attributes?.address ?? ""),
        attrs: {
          market_cap_usd: (x?.attributes?.market_cap_usd ??
            x?.attributes?.fdv_usd ??
            null) as number | null,
          fdv_usd: (x?.attributes?.fdv_usd ?? null) as number | null,
        },
      }),
    );
}

function parseIncludedDexes(included: any[]): GTDex[] {
  return included
    .filter((x: any) => String(x?.type || "").includes("dex"))
    .map(
      (x: any): GTDex => ({
        id: String(x?.id ?? ""),
        name: String(x?.attributes?.name ?? x?.attributes?.slug ?? ""),
      }),
    );
}

export function buildCandidatesFromPoolsResponse(
  j: any,
  query: string,
  mode: "ticker" | "addr" | "name",
  trendingAddrs: Set<string>,
  trendingSymbols: Set<string>,
): Candidate[] {
  const data = (Array.isArray(j?.data) ? j.data : []) as any[];
  const included = (Array.isArray(j?.included) ? j.included : []) as any[];
  const tokens = parseIncludedTokens(included);
  const dexes = parseIncludedDexes(included);
  const dexNameById = new Map(dexes.map((d) => [d.id, d.name]));

  const cands: Candidate[] = [];
  const qTicker = mode === "ticker" ? stripDollar(String(query || "")) : null;
  const qName = mode === "name" ? String(query || "").toLowerCase() : null;

  for (const row of data) {
    const attrs: PoolAttrs = (row?.attributes as PoolAttrs) || {};
    const baseId = String(row?.relationships?.base_token?.data?.id || "");
    const quoteId = String(row?.relationships?.quote_token?.data?.id || "");
    const dexRelId = String(row?.relationships?.dex?.data?.id || "");

    const base = tokens.find((t) => t.id === baseId);
    const quote = tokens.find((t) => t.id === quoteId);
    const dexName =
      dexNameById.get(dexRelId) ||
      String((attrs as any).dex_name ?? attrs.name ?? "");

    if (!isAllowedDex(dexName)) continue;

    const baseIsSol = isSolAddr(base?.address || "");
    const quoteIsSol = isSolAddr(quote?.address || "");
    if (!baseIsSol && !quoteIsSol) continue;

    const quoteSymbol = String(quote?.symbol || "").toUpperCase();
    if (!["SOL", "WSOL", "USDC"].includes(quoteSymbol)) continue;

    let chosenAddr: string | null = null;
    let chosenSymbol = "";

    if (mode === "addr") {
      const qAddr = canonAddr(String(query || ""));
      if (baseIsSol && canonAddr(base!.address) === qAddr) {
        chosenAddr = qAddr;
        chosenSymbol = base?.symbol || "";
      } else if (quoteIsSol && canonAddr(quote!.address) === qAddr) {
        chosenAddr = qAddr;
        chosenSymbol = quote?.symbol || "";
      } else continue;
    } else if (mode === "ticker") {
      const baseMatch = stripDollar(String(base?.symbol || "")) === qTicker;
      const quoteMatch = stripDollar(String(quote?.symbol || "")) === qTicker;
      if (baseIsSol && baseMatch) {
        chosenAddr = canonAddr(base!.address);
        chosenSymbol = String(base?.symbol || "");
      } else if (quoteIsSol && quoteMatch) {
        chosenAddr = canonAddr(quote!.address);
        chosenSymbol = String(quote?.symbol || "");
      } else continue;
    } else {
      // fuzzy "name" mode
      const baseSym = String(base?.symbol || "");
      const baseName = String(base?.name || "");
      const quoteSym = String(quote?.symbol || "");
      const quoteName = String(quote?.name || "");
      const pairName = String(attrs?.name || `${baseSym}/${quoteSym}`);
      const TH = 0.28;
      const like = (q: string, s: string) =>
        !!s && (s.toLowerCase().includes(q) || dice(q, s) >= TH);

      const baseHit = like(qName!, baseSym) || like(qName!, baseName);
      const quoteHit = like(qName!, quoteSym) || like(qName!, quoteName);
      const pairHit = like(qName!, pairName);

      if (baseIsSol && (baseHit || pairHit)) {
        chosenAddr = canonAddr(base!.address);
        chosenSymbol = baseSym || baseName || base?.symbol || "";
      } else if (quoteIsSol && (quoteHit || pairHit)) {
        chosenAddr = canonAddr(quote!.address);
        chosenSymbol = quoteSym || quoteName || quote?.symbol || "";
      } else continue;
    }

    if (!chosenAddr) continue;

    const volume24h = pickVolume(attrs.volume_usd as any);
    const reserveUsd = toNum((attrs as any)?.reserve_in_usd);
    const trAddr = trendingAddrs.has(chosenAddr) ? 1 : 0;
    const trSym = trendingSymbols.has(String(chosenSymbol || "").toLowerCase())
      ? 0.5
      : 0;
    const trendingBoost = trAddr + trSym;

    cands.push({
      addr: chosenAddr,
      symbol: chosenSymbol,
      dexName,
      dexScore: dexPriority(dexName),
      volume24h,
      reserveUsd,
      marketCap:
        pickPoolMcap(attrs) ||
        pickTokenMcap(
          (chosenSymbol && base?.symbol === chosenSymbol
            ? base?.attrs
            : quote?.attrs) as TokenAttrs | undefined,
        ),
      quoteSymbol,
      trendingBoost,
    });
  }

  return cands.sort(compareCandidates);
}

export function buildCandidatesFromTokenPoolsResponse(
  j: any,
  addr: string,
  trendingAddrs: Set<string>,
  trendingSymbols: Set<string>,
): Candidate[] {
  const data = (Array.isArray(j?.data) ? j.data : []) as any[];
  const included = (Array.isArray(j?.included) ? j.included : []) as any[];
  const tokens = parseIncludedTokens(included);
  const dexes = parseIncludedDexes(included);
  const dexNameById = new Map(dexes.map((d) => [d.id, d.name]));

  const cands: Candidate[] = [];
  for (const row of data) {
    const attrs: PoolAttrs = (row?.attributes as PoolAttrs) || {};
    const baseId = String(row?.relationships?.base_token?.data?.id || "");
    const quoteId = String(row?.relationships?.quote_token?.data?.id || "");
    const dexRelId = String(row?.relationships?.dex?.data?.id || "");

    const base = tokens.find((t) => t.id === baseId);
    const quote = tokens.find((t) => t.id === quoteId);
    const dexName =
      dexNameById.get(dexRelId) ||
      String((attrs as any).dex_name ?? attrs.name ?? "");

    if (!isAllowedDex(dexName)) continue;

    const baseIsSol = isSolAddr(base?.address || "");
    const quoteIsSol = isSolAddr(quote?.address || "");
    if (!baseIsSol && !quoteIsSol) continue;

    const quoteSymbol = String(quote?.symbol || "").toUpperCase();
    if (!["SOL", "WSOL", "USDC"].includes(quoteSymbol)) continue;

    let chosenAddr: string | null = null;
    let chosenSymbol = "";
    if (baseIsSol && canonAddr(base!.address) === canonAddr(addr)) {
      chosenAddr = canonAddr(addr);
      chosenSymbol = base?.symbol || "";
    } else if (quoteIsSol && canonAddr(quote!.address) === canonAddr(addr)) {
      chosenAddr = canonAddr(addr);
      chosenSymbol = quote?.symbol || "";
    } else continue;

    const volume24h = pickVolume(attrs.volume_usd as any);
    const reserveUsd = toNum((attrs as any)?.reserve_in_usd);
    const trAddr = trendingAddrs.has(chosenAddr) ? 1 : 0;
    const trSym = trendingSymbols.has(String(chosenSymbol || "").toLowerCase())
      ? 0.5
      : 0;
    const trendingBoost = trAddr + trSym;

    cands.push({
      addr: chosenAddr,
      symbol: chosenSymbol,
      dexName,
      dexScore: dexPriority(dexName),
      volume24h,
      reserveUsd,
      marketCap:
        pickPoolMcap(attrs) ||
        pickTokenMcap(
          (chosenSymbol && base?.symbol === chosenSymbol
            ? base?.attrs
            : quote?.attrs) as TokenAttrs | undefined,
        ),
      quoteSymbol,
      trendingBoost,
    });
  }

  return cands.sort(compareCandidates);
}

export async function searchPoolsAsCandidates(
  query: string,
  mode: "ticker" | "addr" | "name",
  trendingAddrs: Set<string>,
  trendingSymbols: Set<string>,
): Promise<Candidate[]> {
  const j = await searchPools(query).catch(() => null);
  if (!j) return [];
  return buildCandidatesFromPoolsResponse(
    j,
    query,
    mode,
    trendingAddrs,
    trendingSymbols,
  );
}

export async function tokenFallbackAsCandidates(
  queries: string[],
  trendingAddrs: Set<string>,
  trendingSymbols: Set<string>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seenAddr = new Set<string>();

  for (const q of queries) {
    const tj = await searchTokens(q).catch(() => null);
    const tokData = (Array.isArray(tj?.data) ? tj.data : []) as any[];
    for (const row of tokData) {
      const addr = canonAddr(String(row?.attributes?.address || ""));
      const symbol = String(row?.attributes?.symbol || "");
      if (!addr || !isSolAddr(addr) || seenAddr.has(addr)) continue;
      seenAddr.add(addr);

      const pj = await fetchPoolsForToken(addr).catch(() => null);
      if (!pj) continue;
      const cands = buildCandidatesFromTokenPoolsResponse(
        pj,
        addr,
        trendingAddrs,
        trendingSymbols,
      );

      const qTicker = stripDollar(q);
      out.push(
        ...cands.filter((c) => {
          const sym = stripDollar(String(c.symbol || ""));
          const tok = stripDollar(symbol);
          return sym === qTicker || sym === tok;
        }),
      );
    }
  }

  return out.sort(compareCandidates);
}

export function pickBestForTicker(cands: Candidate[]): Candidate | undefined {
  if (!cands.length) return undefined;

  // DEX priority first
  let best = cands;
  const maxDex = Math.max(...best.map((c) => c.dexScore));
  best = best.filter((c) => c.dexScore === maxDex);

  // Quote preference
  const qp = (s?: string) =>
    String(s || "").toUpperCase() === "SOL" ||
    String(s || "").toUpperCase() === "WSOL"
      ? 2
      : String(s || "").toUpperCase() === "USDC"
        ? 1
        : 0;
  const maxQP = Math.max(...best.map((c) => qp(c.quoteSymbol)));
  best = best.filter((c) => qp(c.quoteSymbol) === maxQP);

  // Volume > Liquidity > Mcap
  best.sort(
    (a, b) =>
      b.volume24h - a.volume24h ||
      b.reserveUsd - a.reserveUsd ||
      b.marketCap - a.marketCap,
  );
  return best[0];
}

// Export guards so the facade can reuse them for final threshold check
export { MIN_LIQUIDITY_USD, MIN_VOLUME24H_USD };
