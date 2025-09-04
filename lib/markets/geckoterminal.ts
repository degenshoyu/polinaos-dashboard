// lib/markets/geckoterminal.ts
// Query GeckoTerminal pools on multiple networks and pick best candidate
// by: DEX priority (PumpSwap > Raydium > Meteora > others) > 24h volume > liquidity > market cap

import { canonAddr, isEvmAddr, isSolAddr } from "@/lib/chains/address";

const GT_BASE =
  process.env.GECKOTERMINAL_BASE ?? "https://api.geckoterminal.com/api/v2";

// Non-CA detection prefers Solana first
const NETWORKS_PREFERRED = [
  "solana",
  "base",
  "eth",
  "bsc",
  "polygon",
  "arbitrum",
  "optimism",
  "avalanche",
  "fantom",
] as const;

// DEX priority: PumpSwap > Raydium > Meteora > others
const dexPriority = (name?: string) => {
  const s = String(name || "").toLowerCase();
  if (s.includes("pump")) return 3; // PumpSwap / pump.fun routers etc.
  if (s.includes("raydium")) return 2; // Raydium
  if (s.includes("meteora")) return 1; // Meteora
  return 0;
};

type VolUSD = { m5?: number; h1?: number; h6?: number; h24?: number };
type PoolAttrs = {
  reserve_in_usd?: number;
  volume_usd?: VolUSD;
  name?: string;
};
type TokenAttrs = {
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
};

type Candidate = {
  network: string;
  addr: string;
  symbol: string;
  dexName: string;
  dexScore: number;
  volume24h: number;
  reserveUsd: number;
  marketCap: number;
};

type GTToken = {
  id: string;
  symbol: string;
  address: string;
  attrs: TokenAttrs;
};

type GTDex = {
  id: string;
  name: string;
};

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

/** Sort: DEX priority > 24h volume > liquidity > market cap */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.dexScore !== a.dexScore) return b.dexScore - a.dexScore;
  if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
  if (b.reserveUsd !== a.reserveUsd) return b.reserveUsd - a.reserveUsd;
  if (b.marketCap !== a.marketCap) return b.marketCap - a.marketCap;
  return 0;
}

export type ResolveOpts = {
  forceNetwork?: "solana" | "evm";
  preferSolana?: boolean;
};

/**
 * Resolve `$tickers` → best tokenKey per ticker.
 * - forceNetwork: "solana" | "evm"
 * - preferSolana: default true for non-CA detection
 */
export async function resolveTickersToContracts(
  tickers: string[],
  opts?: ResolveOpts,
) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();

  const networks = (() => {
    if (opts?.forceNetwork === "solana") return ["solana"] as const;
    if (opts?.forceNetwork === "evm") {
      return [
        "base",
        "eth",
        "bsc",
        "polygon",
        "arbitrum",
        "optimism",
        "avalanche",
        "fantom",
      ] as const;
    }
    return NETWORKS_PREFERRED;
  })();

  for (const raw of tickers) {
    const ticker = raw.replace(/^\$+/, "").toLowerCase();
    const symbol = `$${ticker.toUpperCase()}`;

    const perNet = await Promise.all(
      networks.map(async (net) => {
        try {
          const url = `${GT_BASE}/search/pools?query=${encodeURIComponent(
            ticker,
          )}&network=${encodeURIComponent(net)}&include=base_token,quote_token,dex`;
          const res = await fetch(url, {
            headers: { accept: "application/json" },
            cache: "no-store",
          });
          if (!res.ok) return [] as Candidate[];

          const j: any = await res.json();
          const data = (Array.isArray(j?.data) ? j.data : []) as any[];
          const included = (
            Array.isArray(j?.included) ? j.included : []
          ) as any[];

          // tokens
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

          // dex (id -> name)
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
          for (const p of data) {
            const attrs = (p?.attributes ?? {}) as PoolAttrs;
            const rels = p?.relationships ?? {};

            const baseId: string = String(rels?.base_token?.data?.id ?? "");
            const quoteId: string = String(rels?.quote_token?.data?.id ?? "");
            const dexRelId: string = String(rels?.dex?.data?.id ?? "");

            const base = tokens.find((t: GTToken) => t.id === baseId);
            const quote = tokens.find((t: GTToken) => t.id === quoteId);

            const dexName =
              dexNameById.get(dexRelId) ||
              String((attrs as any).dex_name ?? attrs.name ?? "");

            const volume24h = pickVolume(
              attrs.volume_usd as VolUSD | undefined,
            );
            const reserveUsd = Number(attrs.reserve_in_usd ?? 0);

            // prefer exact symbol match on either side
            const side = [base, quote].find(
              (t: GTToken | undefined) =>
                String(t?.symbol || "").toLowerCase() === ticker,
            );

            if (
              side?.address &&
              (isEvmAddr(side.address) || isSolAddr(side.address))
            ) {
              cands.push({
                network: net,
                addr: canonAddr(side.address),
                symbol,
                dexName,
                dexScore: dexPriority(dexName),
                volume24h,
                reserveUsd,
                marketCap: pickMcap(side.attrs),
              });
            }
          }
          return cands;
        } catch {
          return [] as Candidate[];
        }
      }),
    );

    const all = perNet.flat();
    const solBest = all
      .filter((c) => c.network === "solana")
      .sort(compareCandidates)[0];
    const best = solBest || all.sort(compareCandidates)[0];

    if (best) {
      out.set(ticker, {
        tokenKey: best.addr,
        tokenDisplay: symbol,
        boostedConf:
          (best.network === "solana" ? 98 : 96) + (best.dexScore > 0 ? 1 : 0),
      });
    } else {
      out.set(ticker, {
        tokenKey: ticker,
        tokenDisplay: symbol,
        boostedConf: 95,
      });
    }
  }

  return out;
}

/** Resolve contract addresses -> { tokenKey, tokenDisplay, boostedConf } */
export async function resolveContractsToMeta(
  addrs: string[],
  opts?: ResolveOpts,
) {
  const out = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();

  const uniq = Array.from(
    new Set(addrs.map((a) => canonAddr(String(a || ""))).filter(Boolean)),
  );

  // Helper: pick candidate for a single (addr, network)
  async function searchOne(addr: string, net: string): Promise<Candidate[]> {
    try {
      const url = `${GT_BASE}/search/pools?query=${encodeURIComponent(
        addr,
      )}&network=${encodeURIComponent(net)}&include=base_token,quote_token,dex`;
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
            address: canonAddr(String(x?.attributes?.address ?? "")),
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

        const volume24h = pickVolume(attrs.volume_usd as VolUSD | undefined);
        const reserveUsd = Number(attrs.reserve_in_usd ?? 0);

        // match target addr on either side
        const side = [base, quote].find((t) => t?.address === addr);
        if (side?.address) {
          cands.push({
            network: net,
            addr: side.address,
            symbol: side.symbol, // may be empty, we'll guard later
            dexName,
            dexScore: dexPriority(dexName),
            volume24h,
            reserveUsd,
            marketCap: pickMcap(side.attrs),
          });
        }
      }
      return cands;
    } catch {
      return [];
    }
  }

  // Resolve each address across networks (Solana-only vs EVM list)
  for (const addr of uniq) {
    const nets: readonly string[] =
      opts?.forceNetwork === "solana" || isSolAddr(addr)
        ? (["solana"] as const)
        : opts?.forceNetwork === "evm"
          ? ([
              "base",
              "eth",
              "bsc",
              "polygon",
              "arbitrum",
              "optimism",
              "avalanche",
              "fantom",
            ] as const)
          : NETWORKS_PREFERRED;

    const perNet = await Promise.all(nets.map((n) => searchOne(addr, n)));
    const all = perNet.flat();

    const solBest = all
      .filter((c) => c.network === "solana")
      .sort(compareCandidates)[0];
    const best = solBest || all.sort(compareCandidates)[0];

    if (best) {
      const sym = String(best.symbol || "").trim();
      // Fallback: if GT returns empty symbol, synthesize "$ADDR" short tag
      const tokenDisplay =
        sym.length > 0
          ? `$${sym.toUpperCase()}`
          : `$${addr.slice(0, 4)}…${addr.slice(-4)}`;
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay,
        boostedConf:
          (best.network === "solana" ? 99 : 97) + (best.dexScore > 0 ? 1 : 0),
      });
    } else {
      // Hard fallback: still return synthesized tag; caller can log/warn.
      out.set(addr, {
        tokenKey: addr,
        tokenDisplay: `$${addr.slice(0, 4)}…${addr.slice(-4)}`,
        boostedConf: 90,
      });
    }
  }

  return out;
}
