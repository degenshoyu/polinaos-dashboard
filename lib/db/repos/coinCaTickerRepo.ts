// lib/db/repos/coinCaTickerRepo.ts
// Thin repository for coin_ca_ticker provenance upsert.
// Keeps SQL/Drizzle logic out of the route for readability.

import { db } from "@/lib/db/client";
import { coinCaTicker } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type BasicIdentity = {
  symbol: string;
  tokenName: string;
  primaryPoolAddress: string | null;
};

export type MintProvenance = {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  hasMintAuth: boolean;
  hasFreezeAuth: boolean;
  mintedAt: Date | null;
  creatorAddress: string | null;
  updateAuthority: string | null;
};

export async function upsertCoinCaProvenance(
  contractAddress: string,
  identity: BasicIdentity | null, // if null, we only try update; no insert
  p: MintProvenance,
): Promise<"updated" | "inserted" | "skipped"> {
  const existing = await db
    .select({ id: coinCaTicker.id })
    .from(coinCaTicker)
    .where(eq(coinCaTicker.contractAddress, contractAddress))
    .limit(1);

  if (existing.length) {
    await db
      .update(coinCaTicker)
      .set({
        mintAuthority: p.mintAuthority,
        updateAuthority: p.updateAuthority,
        freezeAuthority: p.freezeAuthority,
        hasMintAuth: p.hasMintAuth,
        hasFreezeAuth: p.hasFreezeAuth,
        mintAt: p.mintedAt,
        creatorAddress: p.creatorAddress,
        updatedAt: new Date(),
      } as any)
      .where(eq(coinCaTicker.contractAddress, contractAddress));
    return "updated";
  }

  // No row exists: only insert if we have basic identity (symbol/name)
  if (!identity) return "skipped";

  await db.insert(coinCaTicker).values({
    tokenTicker: identity.symbol,
    tokenName: identity.tokenName,
    contractAddress,
    primaryPoolAddress: identity.primaryPoolAddress,
    mintAuthority: p.mintAuthority,
    updateAuthority: p.updateAuthority,
    freezeAuthority: p.freezeAuthority,
    hasMintAuth: p.hasMintAuth,
    hasFreezeAuth: p.hasFreezeAuth,
    mintAt: p.mintedAt,
    creatorAddress: p.creatorAddress,
  } as any);

  return "inserted";
}
