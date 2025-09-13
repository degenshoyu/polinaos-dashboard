// lib/mintmeta/fetch.ts
// Fetches on-chain mint metadata via our local /api/mintmeta endpoint.
// English comments for clarity.

export type MintMeta = {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  hasMintAuthority?: boolean;
  hasFreezeAuthority?: boolean;
  updateAuthority: string | null;
  creators?: Array<{ address: string; verified: boolean; share: number }>;
  mintedAt?: number | null;
  mintedAtISO?: string | null;
  mintedAtLocal?: string | null;
  mintedAtTz?: string;
  metadataPda?: string | null;
};

export async function fetchMintMeta(
  origin: string,
  mint: string,
  opts?: { tz?: string; strategy?: "cheap" | "deep"; max?: number },
): Promise<MintMeta> {
  const tz = opts?.tz ?? "UTC";
  const strategy = opts?.strategy ?? "cheap";
  const max = Math.max(100, Math.min(5000, opts?.max ?? 1000));
  const url =
    `${origin.replace(/\/$/, "")}/api/mintmeta` +
    `?mint=${encodeURIComponent(mint)}` +
    `&withMintedAt=1` +
    `&mintedAtTz=${encodeURIComponent(tz)}` +
    `&mintedAtStrategy=${strategy}` +
    `&mintedAtMaxSignatures=${max}`;

  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) throw new Error(`mintmeta failed: ${res.status}`);
  return (await res.json()) as MintMeta;
}
