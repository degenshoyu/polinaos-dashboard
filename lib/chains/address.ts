// lib/chains/address.ts
// Helpers to detect & canonicalize addresses across chains.

export const isEvmAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
export const isSolAddr = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/** Lowercase only for EVM; keep Solana base58 as-is */
export const canonAddr = (s: string) => (isEvmAddr(s) ? s.toLowerCase() : s);
