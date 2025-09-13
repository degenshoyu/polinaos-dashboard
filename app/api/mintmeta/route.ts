// app/api/mintmeta/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * This API fetches on-chain mint metadata for a given SPL token mint:
 * - SPL Mint core fields (mintAuthority, freezeAuthority, decimals, supply, isInitialized)
 *   via getParsedAccountInfo (no extra dependency required).
 * - Metaplex Token Metadata (updateAuthority, creators) via reading the Metadata PDA and
 *   parsing only the minimal subset of the Borsh layout we need.
 * - (Optional) mintedAt: inferred from the earliest signature's block time of the mint address.
 *
 * ENV:
 * - HELIUS_RPC_URL or SOLANA_RPC_URL (fallback to public mainnet RPC)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQ_SCHEMA = z.object({
  mint: z.string().min(32, "mint is required"),
  withMintedAt: z.boolean().optional().default(false),
  mintedAtStrategy: z.enum(["cheap", "deep"]).optional().default("cheap"),
  mintedAtMaxSignatures: z
    .number()
    .int()
    .min(100)
    .max(5000)
    .optional()
    .default(1000),
  // IANA timezone for human-readable date formatting (e.g., "Asia/Bangkok", "UTC")
  mintedAtTz: z.string().optional().default("UTC"),
});

const METADATA_PROGRAM_ID = new PublicKey(
  // Metaplex Token Metadata Program (mainnet)
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// Pick RPC from env, fallback to public
function getRpcUrl(): string {
  return (
    process.env.HELIUS_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

/** ------------------------- Helpers: safe parsing ------------------------- **/

function readU8(buf: Buffer, offset: number) {
  return { value: buf.readUInt8(offset), next: offset + 1 };
}
function readU16LE(buf: Buffer, offset: number) {
  return { value: buf.readUInt16LE(offset), next: offset + 2 };
}
function readU32LE(buf: Buffer, offset: number) {
  return { value: buf.readUInt32LE(offset), next: offset + 4 };
}
function readPubkey(buf: Buffer, offset: number) {
  const slice = buf.subarray(offset, offset + 32);
  return { value: new PublicKey(slice).toBase58(), next: offset + 32 };
}
function readStringBorsh(buf: Buffer, offset: number) {
  // Borsh string: u32 (LE) length + UTF-8 bytes
  const { value: len, next: afterLen } = readU32LE(buf, offset);
  const bytes = buf.subarray(afterLen, afterLen + len);
  return { value: bytes.toString("utf8"), next: afterLen + len };
}

/**
 * Parse the minimal subset of Metaplex Metadata account we need:
 * layout (v1):
 *   u8 key
 *   Pubkey updateAuthority
 *   Pubkey mint
 *   Data data {
 *     string name
 *     string symbol
 *     string uri
 *     u16 sellerFeeBasisPoints
 *     bool hasCreators
 *     if hasCreators:
 *       u32 creatorsLen
 *       creators[creatorsLen] {
 *         Pubkey address
 *         bool verified
 *         u8 share
 *       }
 *   }
 *   bool primarySaleHappened
 *   bool isMutable
 *   ... (we ignore the rest)
 */
function parseMetaplexMetadata(buf: Buffer): {
  updateAuthority: string;
  creators?: Array<{ address: string; verified: boolean; share: number }>;
} {
  let o = 0;

  // key (u8) - ignore concrete value
  ({ next: o } = readU8(buf, o));

  // updateAuthority
  const ua = readPubkey(buf, o);
  const updateAuthority = ua.value;
  o = ua.next;

  // mint (skip)
  ({ next: o } = readPubkey(buf, o));

  // Data: name, symbol, uri, sellerFeeBP, creators?
  // name
  const name = readStringBorsh(buf, o);
  o = name.next;
  // symbol
  const symbol = readStringBorsh(buf, o);
  o = symbol.next;
  // uri
  const uri = readStringBorsh(buf, o);
  o = uri.next;

  // sellerFeeBasisPoints (u16) - skip
  ({ next: o } = readU16LE(buf, o));

  // hasCreators (u8 as bool)
  const hasCreators = readU8(buf, o);
  o = hasCreators.next;

  let creators:
    | Array<{ address: string; verified: boolean; share: number }>
    | undefined;

  if (hasCreators.value === 1) {
    const len = readU32LE(buf, o);
    o = len.next;
    creators = [];
    for (let i = 0; i < len.value; i++) {
      const addr = readPubkey(buf, o);
      o = addr.next;
      const ver = readU8(buf, o);
      o = ver.next;
      const share = readU8(buf, o);
      o = share.next;
      creators.push({
        address: addr.value,
        verified: ver.value === 1,
        share: share.value,
      });
    }
  }

  // We intentionally ignore the remaining flags/optionals to keep parsing minimal.
  return { updateAuthority, creators };
}

/** ------------------------- Core fetchers ------------------------- **/

async function fetchMintCore(connection: Connection, mintPk: PublicKey) {
  const acc = await connection.getParsedAccountInfo(mintPk, "confirmed");
  const parsed = (acc.value?.data as any)?.parsed;
  if (!parsed || parsed?.type !== "mint") {
    throw new Error("Not an SPL Mint account or unable to parse.");
  }
  const info = parsed.info;
  // jsonParsed wraps authorities with Option-like shape: { option: "some", value: "..."} | { option: "none" }
  const mintAuthority =
    info.mintAuthority?.value ??
    (info.mintAuthority?.option === "none" ? null : null);
  const freezeAuthority =
    info.freezeAuthority?.value ??
    (info.freezeAuthority?.option === "none" ? null : null);

  return {
    decimals: Number(info.decimals ?? 0),
    supply: String(info.supply ?? "0"),
    isInitialized: Boolean(info.isInitialized ?? false),
    mintAuthority: mintAuthority ?? null,
    freezeAuthority: freezeAuthority ?? null,
  };
}

async function fetchTokenMetadata(connection: Connection, mintPk: PublicKey) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPk.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info?.data) {
    return {
      metadataPda: null,
      updateAuthority: null,
      creators: [],
      hasCreators: false,
    };
  }
  try {
    const { updateAuthority, creators } = parseMetaplexMetadata(
      Buffer.from(info.data),
    );
    const list = Array.isArray(creators) ? creators : [];
    return {
      metadataPda: pda.toBase58(),
      updateAuthority,
      creators: list,
      hasCreators: list.length > 0,
    };
  } catch {
    // If parsing fails (e.g., different metadata version), just return PDA without details.
    return {
      metadataPda: pda.toBase58(),
      updateAuthority: null,
      creators: [],
      hasCreators: false,
    };
  }
}

async function inferMintedAt(
  connection: Connection,
  mintPk: PublicKey,
  maxSignatures: number,
): Promise<number | null> {
  // We scan signatures in batches until we reach the oldest one or the user-defined cap.
  let before: string | undefined = undefined;
  let scanned = 0;
  let earliest: { slot: number } | null = null;

  while (scanned < maxSignatures) {
    const remaining = Math.min(1000, maxSignatures - scanned);
    const batch = await connection.getSignaturesForAddress(mintPk, {
      before,
      limit: remaining,
    });
    if (batch.length === 0) break;

    scanned += batch.length;
    before = batch[batch.length - 1].signature; // paginate older
    // Keep the oldest seen so far (last item in the batch is the oldest in that batch)
    earliest = batch[batch.length - 1];

    if (batch.length < remaining) break; // no more pages
  }

  if (!earliest) return null;
  try {
    const t = await connection.getBlockTime(earliest.slot);
    return t ?? null;
  } catch {
    return null;
  }
}

/**
 * Cheap mintedAt inference:
 * Use the Metadata PDA instead of the mint address. In practice, the metadata account
 * has very few signatures (often only the creation). With `limit=1000` we usually get
 * the *entire* history in a single call, so we can take the last element as the earliest.
 * This avoids deep pagination and reduces RPC cost drastically.
 */
async function cheapMintedAtFromMetadata(
  connection: Connection,
  mintPk: PublicKey,
): Promise<number | null> {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPk.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );
  // Single request, newest-first; if total < 1000, this array contains the entire history.
  const sigs = await connection.getSignaturesForAddress(pda, { limit: 1000 });
  if (sigs.length === 0) return null;
  const earliest = sigs[sigs.length - 1]; // last element = oldest among the returned batch
  try {
    const t = await connection.getBlockTime(earliest.slot);
    return t ?? null;
  } catch {
    return null;
  }
}

/** ------------------------- Route handlers ------------------------- **/

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const {
      mint,
      withMintedAt,
      mintedAtStrategy,
      mintedAtMaxSignatures,
      mintedAtTz,
    } = REQ_SCHEMA.parse(json);

    const connection = new Connection(getRpcUrl(), "confirmed");
    const mintPk = new PublicKey(mint);

    const core = await fetchMintCore(connection, mintPk);
    const meta = await fetchTokenMetadata(connection, mintPk);

    let mintedAt: number | null | undefined;
    if (withMintedAt) {
      if (mintedAtStrategy === "cheap") {
        mintedAt = await cheapMintedAtFromMetadata(connection, mintPk);
        // Optional: if you want a safety fallback only when metadata is extremely “hot”:
        // if (mintedAt === null) mintedAt = await inferMintedAt(connection, mintPk, mintedAtMaxSignatures);
      } else {
        mintedAt = await inferMintedAt(
          connection,
          mintPk,
          mintedAtMaxSignatures,
        );
      }
    }

    // Human-readable formatting (kept optional & side-effect free).
    // We always return the unix seconds (mintedAt), plus:
    // - mintedAtISO: ISO string in UTC
    // - mintedAtLocal: formatted string in the requested IANA timezone
    const mintedAtISO =
      typeof mintedAt === "number"
        ? new Date(mintedAt * 1000).toISOString()
        : null;
    let mintedAtLocal: string | null = null;
    if (typeof mintedAt === "number" && mintedAt !== null) {
      try {
        mintedAtLocal = new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "medium",
          timeZone: mintedAtTz || "Asia/Bangkok",
        }).format(new Date(mintedAt * 1000));
      } catch {
        // Fallback to ISO if Intl/timezone is not available on the runtime
        mintedAtLocal = mintedAtISO;
      }
    }

    return NextResponse.json(
      {
        source: "solana",
        mint,
        decimals: core.decimals,
        supply: core.supply,
        isInitialized: core.isInitialized,
        mintAuthority: core.mintAuthority,
        freezeAuthority: core.freezeAuthority,
        hasMintAuthority: Boolean(core.mintAuthority), // true if authority present, else false
        hasFreezeAuthority: Boolean(core.freezeAuthority),
        updateAuthority: meta.updateAuthority,
        creators: meta.creators, // always an array now
        hasCreators: meta.hasCreators ?? meta.creators?.length > 0,
        metadataPda: meta.metadataPda,
        mintedAt: mintedAt ?? null,
        mintedAtISO, // ISO string in UTC, e.g. "2025-03-06T16:55:02.000Z"
        mintedAtLocal, // formatted in mintedAtTz, e.g. "06 Mar 2025, 11:55:02"
        mintedAtTz,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: true,
        message: err?.message || "Unknown error",
      },
      { status: 400 },
    );
  }
}

// Optional GET for quick manual tests: /api/mintmeta?mint=...&withMintedAt=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");
  const withMintedAt = searchParams.get("withMintedAt") === "1";
  const max = Number(searchParams.get("mintedAtMaxSignatures") ?? "1000");
  const strategy = (searchParams.get("mintedAtStrategy") ?? "cheap") as
    | "cheap"
    | "deep";
  const tz = searchParams.get("mintedAtTz") ?? "UTC";

  if (!mint) {
    return NextResponse.json(
      { error: true, message: "Query param `mint` is required." },
      { status: 400 },
    );
  }
  // Reuse POST logic by constructing a Request-like object
  return POST(
    new Request("http://local", {
      method: "POST",
      body: JSON.stringify({
        mint,
        withMintedAt,
        mintedAtStrategy: strategy,
        mintedAtMaxSignatures: Math.max(100, Math.min(5000, max)),
        mintedAtTz: tz,
      }),
      headers: { "content-type": "application/json" },
    }),
  );
}
