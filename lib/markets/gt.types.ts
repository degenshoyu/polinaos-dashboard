// lib/markets/gt.types.ts
// Core types & constants shared across GT modules

export const NETWORK = "solana";

export type VolUSD = {
  m5?: number | string;
  h1?: number | string;
  h6?: number | string;
  h24?: number | string;
};

export type PoolAttrs = {
  reserve_in_usd?: number | string;
  volume_usd?: VolUSD;
  name?: string;
  market_cap_usd?: number | string | null;
  fdv_usd?: number | string | null;
};

export type TokenAttrs = {
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
};

export type Candidate = {
  addr: string; // Solana mint
  symbol: string; // token symbol (may include leading "$")
  tokenName?: string; // token display name (from GT token.name)
  dexName: string; // e.g., "PumpSwap"
  dexScore: number; // priority score (3/2/1)
  volume24h: number; // USD
  reserveUsd: number; // USD
  marketCap: number; // USD
  quoteSymbol?: string; // SOL/WSOL/USDC
  trendingBoost: number; // 0..(addr+symbol bonus)
};

export type GTToken = {
  id: string;
  symbol: string;
  name: string;
  address: string;
  attrs: TokenAttrs;
};

export type GTDex = { id: string; name: string };

export type TickerCandidateVerbose = Candidate & {
  score: number;
  addrFreq?: number;
};
