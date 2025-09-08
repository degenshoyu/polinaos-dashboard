// lib/markets/geckoterminal.ts
// Solana-only token resolution helpers via GeckoTerminal.
// Inputs:
//   1) $tickers   → resolveTickersToContracts
//   2) base58 CAs → resolveContractsToMeta
//   3) Names      → resolveNamesToContracts (phrase name, e.g., "unstable")
// Ranking (after Solana filtering):
//   Trending boost (address/symbol) >
//   DEX priority (PumpSwap > Raydium > Meteora > others) >
//   Quote preference (SOL > USDC > others) >
//   24h volume >
//   Liquidity (reserve USD) >
//   Market cap

import { canonAddr, isSolAddr } from "@/lib/chains/address";
import { fetchGTJson } from "@/lib/markets/gtFetch";

const GT_BASE =
  process.env.GECKOTERMINAL_BASE ?? "https://api.geckoterminal.com/api/v2";
const NETWORK = "solana";

// Optional: allow a UI/cron to inject trending *symbols* (lowercase), on top of
// the address-based trending fetched from GT.
let trendingSolanaSymbols = new Set<string>();
export function setTrendingSymbols(list: string[]) {
  trendingSolanaSymbols = new Set(list.map((s) => s.toLowerCase()));
}

// ----------------------- Small helpers -----------------------
type VolUSD = { m5?: number; h1?: number; h6?: number; h24?: number };
type PoolAttrs = {
  reserve_in_usd?: number;
  volume_usd?: VolUSD;
  name?: string;
};
type TokenAttrs = { market_cap_usd?: number | null; fdv_usd?: number | null };

type Candidate = {
  addr: string; // Solana base58 (canonical)
  symbol: string; // token symbol
  dexName: string; // e.g. Raydium
  dexScore: number; // 0..3 (PumpSwap 3, Raydium 2, Meteora 1)
  volume24h: number; // USD
  reserveUsd: number; // USD
  marketCap: number; // USD
  quoteSymbol?: string; // quote token symbol (SOL/USDC/...)
  trendingBoost: number; // aggregated trending weight
};

type GTToken = {
  id: string;
  symbol: string;
  name: string;
  address: string;
  attrs: TokenAttrs;
};
type GTDex = { id: string; name: string };

function dexPriority(name?: string) {
  const s = String(name || "").toLowerCase();
  if (s.includes("pump")) return 3; // PumpSwap
  if (s.includes("raydium")) return 2; // Raydium
  if (s.includes("meteora")) return 1; // Meteora
  return 0;
}
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
function quotePreferenceScore(sym?: string): number {
  // Prefer SOL > USDC > others (soft preference via score)
  const s = (sym || "").toUpperCase();
  if (s === "SOL" || s === "WSOL") return 2;
  if (s === "USDC") return 1;
  return 0;
}

// Composite comparator (bigger is better)
function compareCandidates(a: Candidate, b: Candidate): number {
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

// Strict picker for $ticker: DEX > quote(SOL/WSOL > USDC) > 24h vol > liquidity > mcap
function pickBestForTicker(
  cands: Candidate | Candidate[],
): Candidate | undefined {
  const arr = Array.isArray(cands)
    ? cands
    : ([cands].filter(Boolean) as Candidate[]);
  if (!arr.length) return undefined;
  // 1) DEX priority
  let best = arr;
  const maxDex = Math.max(...best.map((c) => c.dexScore));
  best = best.filter((c) => c.dexScore === maxDex);
  // 2) Quote preference
  const qp = (s?: string) =>
    s?.toUpperCase() === "SOL" || s?.toUpperCase() === "WSOL"
      ? 2
      : s?.toUpperCase() === "USDC"
        ? 1
        : 0;
  const maxQP = Math.max(...best.map((c) => qp(c.quoteSymbol)));
  best = best.filter((c) => qp(c.quoteSymbol) === maxQP);
  // 3) 24h volume
  best.sort(
    (a, b) =>
      b.volume24h - a.volume24h ||
      b.reserveUsd - a.reserveUsd ||
      b.marketCap - a.marketCap,
  );
  return best[0];
}

// ----------------------- Trending (addresses) -----------------------
async function fetchSolanaTrendingAddrs(): Promise<Set<string>> {
  // Try a couple of endpoints defensively; collect token addresses from "included"
  const out = new Set<string>();
  const endpoints = [
    `${GT_BASE}/networks/${NETWORK}/trending_pools?include=base_token,quote_token`,
    `${GT_BASE}/trending_pools?network=${NETWORK}&include=base_token,quote_token`,
  ];

  const collect = (j: any) => {
    const included = Array.isArray(j?.included) ? j.included : [];
    for (const x of included) {
      const ty = String(x?.type || "");
      if (!ty.includes("token")) continue;
      const addr = canonAddr(String(x?.attributes?.address || ""));
      if (addr && isSolAddr(addr)) out.add(addr);
    }
  };

  for (const url of endpoints) {
    try {
      const j = await fetchGTJson(url).catch(() => null);
      if (j) collect(j);
      if (out.size > 0) break;
    } catch {
      // keep trying
    }
  }

  return out;
}

// ----------------------- Fuzzy helpers (for names) -----------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function dice(a: string, b: string) {
  const A = norm(a),
    B = norm(b);
  if (!A || !B) return 0;
  const bg = (t: string) =>
    new Set(
      Array.from({ length: Math.max(0, t.length - 1) }, (_, i) =>
        t.slice(i, i + 2),
      ),
    );
  const A2 = bg(A),
    B2 = bg(B);
  let inter = 0;
  for (const x of A2) if (B2.has(x)) inter++;
  return (2 * inter) / (A2.size + B2.size || 1); // 0..1
}

// ----------------------- Core search: /search/pools -----------------------
async function searchPoolsAsCandidates(
  query: string,
  mode: "ticker" | "addr" | "name",
  trendingAddrs: Set<string>,
): Promise<Candidate[]> {
  try {
    const url =
      `${GT_BASE}/search/pools?query=${encodeURIComponent(query)}` +
      `&filter[network]=${NETWORK}&include=base_token,quote_token,dex&per_page=50`;
    const j: any = await fetchGTJson(url).catch(() => null);
    if (!j) return [];
    const data = (Array.isArray(j?.data) ? j.data : []) as any[];
    const included = (Array.isArray(j?.included) ? j.included : []) as any[];

    const tokens: GTToken[] = included
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
    const qName = mode === "name" ? query.toLowerCase() : null;

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

      const baseIsSol = isSolAddr(base?.address || "");
      const quoteIsSol = isSolAddr(quote?.address || "");
      if (!baseIsSol && !quoteIsSol) continue; // ensure Solana side exists

      const quoteSymbol = String(quote?.symbol || "").toUpperCase();
      // Hard filter: only accept SOL/WSOL/USDC quote pools
      if (!["SOL", "WSOL", "USDC"].includes(quoteSymbol)) continue;

      // Pick side & match logic
      let chosenAddr: string | null = null;
      let chosenSymbol = "";

      if (mode === "addr") {
        const qAddr = canonAddr(query);
        if (baseIsSol && canonAddr(base!.address) === qAddr) {
          chosenAddr = qAddr;
          chosenSymbol = base?.symbol || "";
        } else if (quoteIsSol && canonAddr(quote!.address) === qAddr) {
          chosenAddr = qAddr;
          chosenSymbol = quote?.symbol || "";
        } else {
          continue;
        }
      } else if (mode === "ticker") {
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
        } else {
          continue;
        }
      }

      if (!chosenAddr) continue;

      const volume24h = pickVolume(attrs.volume_usd as VolUSD | undefined);
      const reserveUsd = Number(attrs.reserve_in_usd ?? 0);

      // Trending: address hit (+1). Symbol trending set (optional) gives +0.5.
      const trAddr = trendingAddrs.has(chosenAddr) ? 1 : 0;
      const trSym = trendingSolanaSymbols.has(
        (chosenSymbol || "").toLowerCase(),
      )
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
        marketCap: pickMcap(
          (chosenSymbol && base?.symbol === chosenSymbol
            ? base?.attrs
            : quote?.attrs) as TokenAttrs | undefined,
        ),
        quoteSymbol,
        trendingBoost,
      });
    }

    return cands.sort(compareCandidates);
  } catch {
    return [];
  }
}

// ----------------------- Public APIs -----------------------

/** Resolve `$tickers` → Map<ticker(lower), { tokenKey: CA, tokenDisplay: "$TICKER", boostedConf }> */
export async function resolveTickersToContracts(tickers: string[]) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  if (!tickers?.length) return out;

  const trendingAddrs = await fetchSolanaTrendingAddrs();

  for (const raw of tickers) {
    const ticker = raw.replace(/^\$+/, "").toLowerCase();
    const symbolDisplay = `$${ticker.toUpperCase()}`;

    const cands = await searchPoolsAsCandidates(
      ticker,
      "ticker",
      trendingAddrs,
    );
    const best = pickBestForTicker(cands);

    if (best) {
      out.set(ticker, {
        tokenKey: best.addr,
        tokenDisplay: symbolDisplay,
        // High confidence on exact-symbol match; +1 dex, +1 trending if present
        boostedConf:
          98 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
      });
    } else {
      // unresolved: keep conservative confidence
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

  const trendingAddrs = await fetchSolanaTrendingAddrs();
  const uniq = Array.from(
    new Set(addrs.map((a) => canonAddr(String(a || ""))).filter(isSolAddr)),
  );

  for (const addr of uniq) {
    const cands = await searchPoolsAsCandidates(addr, "addr", trendingAddrs);
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
          99 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
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

  const trendingAddrs = await fetchSolanaTrendingAddrs();

  for (const raw of names) {
    const q = String(raw || "").trim();
    const qLower = q.toLowerCase();
    if (!qLower) continue;

    const cands1 = await searchPoolsAsCandidates(qLower, "name", trendingAddrs);
    const best =
      cands1[0] ??
      (
        await searchPoolsAsCandidates(`${qLower} coin`, "name", trendingAddrs)
      )[0];
    console.debug("[names] q=%s best=%s", qLower, best?.symbol ?? null);

    if (best) {
      const sym = String(best.symbol || "").trim();
      out.set(qLower, {
        tokenKey: best.addr,
        tokenDisplay: sym
          ? `$${sym.toUpperCase()}`
          : `$${best.addr.slice(0, 4)}…${best.addr.slice(-4)}`,
        // Name-based: start a bit lower than ticker, still boosted by dex/trending
        boostedConf:
          95 + (best.dexScore > 0 ? 1 : 0) + (best.trendingBoost > 0 ? 1 : 0),
      });
    } else {
      // unresolved; keep original phrase & low confidence so later passes can improve it
      out.set(qLower, { tokenKey: qLower, tokenDisplay: q, boostedConf: 70 });
    }
  }
  return out;
}
