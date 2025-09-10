// lib/pricing/resolvePool.ts
// Resolve top pools for a Solana mint via DexScreener, sorted by liquidity.usd.

type DexPair = {
  pairAddress?: string;
  dexId?: string;
  liquidity?: { usd?: number };
};

const TRUSTED_DEX = new Set(["raydium", "pumpswap", "meteora"]);

async function fetchJson(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Return up to `limit` pool addresses (pure address, no 'solana_' prefix),
 * sorted by liquidity.usd desc, only from trusted DEX.
 */
export async function resolvePoolsForMint(
  mint: string,
  limit = 3,
): Promise<{ poolAddress: string; dexId: string; liquidityUsd: number }[]> {
  const url = `https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`;
  const raw = await fetchJson(url);
  const pairs: DexPair[] = Array.isArray(raw) ? raw : (raw?.pairs ?? []);
  const trusted = pairs.filter(
    (p) => p?.pairAddress && TRUSTED_DEX.has(String(p.dexId).toLowerCase()),
  );

  trusted.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));

  return trusted.slice(0, limit).map((p) => ({
    poolAddress: String(p.pairAddress),
    dexId: String(p.dexId).toLowerCase(),
    liquidityUsd: Number(p?.liquidity?.usd ?? 0),
  }));
}
