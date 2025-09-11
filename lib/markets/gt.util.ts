// lib/markets/gt.util.ts
// Normalizers, numeric helpers, ranking utilities, aliases & similarity

export const GT_BASE =
  process.env.GECKOTERMINAL_BASE ?? "https://api.geckoterminal.com/api/v2";

export function toNum(x: any): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const stripDollar = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/^\$+/, "");

export function pickVolume(v?: { [k: string]: any }): number {
  if (!v) return 0;
  return toNum(v.h24) || toNum(v.h6) || toNum(v.h1) || toNum(v.m5) || 0;
}

export function pickTokenMcap(t?: {
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
}): number {
  if (!t) return 0;
  if (typeof t.market_cap_usd === "number") return t.market_cap_usd;
  if (typeof t.fdv_usd === "number") return t.fdv_usd;
  return 0;
}

export function pickPoolMcap(attrs?: { [k: string]: any }): number {
  if (!attrs) return 0;
  return toNum(attrs.market_cap_usd) || toNum(attrs.fdv_usd) || 0;
}

// DEX priority and allowlist
export function dexPriority(name?: string) {
  const s = String(name || "").toLowerCase();
  if (s.includes("pump")) return 3; // PumpSwap highest (no penalty)
  if (s.includes("raydium")) return 2;
  if (s.includes("meteora")) return 1;
  return 0;
}
export function isAllowedDex(name?: string) {
  return dexPriority(name) > 0;
}

// Quote preference: SOL/WSOL > USDC > others
export function quotePreferenceScore(sym?: string): number {
  const s = (sym || "").toUpperCase();
  if (s === "SOL" || s === "WSOL") return 2;
  if (s === "USDC") return 1;
  return 0;
}

// Lightweight bigram Dice coefficient for fuzzy name mode
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function dice(a: string, b: string) {
  const A = norm(a),
    B = norm(b);
  if (!A || !B) return 0;
  const grams = (t: string) =>
    new Set(
      Array.from({ length: Math.max(0, t.length - 1) }, (_, i) =>
        t.slice(i, i + 2),
      ),
    );
  const A2 = grams(A),
    B2 = grams(B);
  let inter = 0;
  for (const x of A2) if (B2.has(x)) inter++;
  return (2 * inter) / (A2.size + B2.size || 1);
}

// Tunables (zombie guards)
export const MIN_LIQUIDITY_USD = Number(process.env.GT_MIN_LIQ_USD ?? 5_000);
export const MIN_VOLUME24H_USD = Number(process.env.GT_MIN_VOL24H_USD ?? 1_000);

// Aliases for tricky tickers
export const TICKER_ALIASES: Record<string, string[]> = {
  wif: ["dogwifhat"],
};

// Debug helper
export const dbg = (...args: any[]) => {
  if (process.env.DEBUG_GT === "1") console.error("[GT]", ...args);
};
