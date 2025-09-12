// lib/tokens/resolve.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db/client";
import { coinCaTicker } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { resolveTickersToContracts } from "@/lib/markets/geckoterminal";

const BLOCK_TICKERS = new Set(["BTC", "ETH", "SOL", "USDT", "USDC"]);

const STRICT_RESOLVE = process.env.RESOLVE_STRICT !== "0"; // default strict on

type Meta = {
  tokenKey: string;
  tokenDisplay: string;
  boostedConf: number;
  symbol?: string;
  tokenName?: string;
};
function validateMeta(
  kind: "ca" | "ticker" | "name",
  m: Meta,
): { ok: true } | { ok: false; reason: string } {
  // symbol → token_ticker ; tokenName → token_name
  const ticker = (m.symbol || m.tokenDisplay?.replace(/^\$+/, "") || "").trim();
  const name = (m.tokenName || "").trim();
  if (!ticker) return { ok: false, reason: "missing_symbol" };
  if (!name) return { ok: false, reason: "missing_token_name" };
  // reject placeholders
  if (/^_+unknown_+$/i.test(ticker))
    return { ok: false, reason: "unknown_symbol" };
  return { ok: true };
}

export type Candidate = {
  contractAddress: string;
  tokenTicker?: string;
  tokenName?: string;
  primaryPoolAddress?: string | null;
  score?: number;
  meta?: Record<string, any>;
};

const isSolAddr = (s: string) =>
  /^[1-9A-HJ-NP-Za-km-z]{25,48}$/.test(String(s || ""));

const normTicker = (raw: string) =>
  String(raw || "")
    .replace(/^\$+/, "")
    .trim()
    .toUpperCase();

/**
 * Resolve a Solana contract address to basic token metadata (symbol/name/primaryPoolAddress).
 * 1) Try local DB (coin_ca_ticker).
 * 2) If missing, *optionally* try markets resolver (if available) and upsert back to DB.
 * Returns null when nothing reliable is found.
 */
export async function resolveCAtoMeta(addr: string): Promise<{
  symbol: string;
  tokenName: string;
  primaryPoolAddress?: string | null;
} | null> {
  const contractAddress = String(addr || "").trim();
  if (!isSolAddr(contractAddress)) return null;

  // 1) DB first
  const fromDb = await db
    .select()
    .from(coinCaTicker)
    .where(eq(coinCaTicker.contractAddress, contractAddress))
    .limit(1);
  if (
    fromDb.length &&
    fromDb[0]!.tokenTicker &&
    fromDb[0]!.tokenName &&
    fromDb[0]!.tokenTicker !== "__UNKNOWN__"
  ) {
    return {
      symbol: fromDb[0]!.tokenTicker!,
      tokenName: fromDb[0]!.tokenName!,
      primaryPoolAddress: fromDb[0]!.primaryPoolAddress ?? null,
    };
  }

  // 2) Markets fallback (best-effort). We use dynamic import so this file
  //    doesn't hard-require a specific export at build time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import("@/lib/markets/geckoterminal");
    const fn: any =
      (mod as any).resolveContractsToMetadata ||
      (mod as any).getAddressMetadata ||
      null;
    if (typeof fn === "function") {
      const map: Map<
        string,
        {
          symbol?: string;
          tokenName?: string;
          tokenDisplay?: string;
          primaryPoolAddress?: string | null;
          boostedConf?: number;
        }
      > = await fn([contractAddress]);
      const m =
        map.get(contractAddress) || map.get(contractAddress.toLowerCase());
      if (m) {
        const symbol = normTicker(m.symbol || m.tokenDisplay || "");
        const tokenName = String(m.tokenName || "").trim();
        const primaryPoolAddress = m.primaryPoolAddress ?? null;
        if (symbol && tokenName) {
          await upsertCoinCaTicker({
            tokenTicker: symbol,
            contractAddress,
            tokenName,
            primaryPoolAddress,
            tokenMetadata: {
              source: "geckoterminal:addr",
              boostedConf: m.boostedConf,
            },
          });
          return { symbol, tokenName, primaryPoolAddress };
        }
      }
    }
  } catch {
    // ignore: markets fallback is optional
  }

  // 3) Strict mode: do not fabricate placeholders
  return null;
}

// Remove trailing "coin"/"token" noise for natural phrases, keep inner spaces.
const stripCoinSuffix = (raw: string) =>
  String(raw || "")
    .replace(/\s+(coin|token)\b/i, "")
    .trim();

/**
 * Upsert into coin_ca_ticker with strong validation.
 * - tokenTicker & tokenName must be non-empty (no "__UNKNOWN__").
 * - contractAddress must look like a Solana mint.
 * - Will NOT write anything in strict mode if validation fails.
 */
async function upsertCoinCaTicker(args: {
  tokenTicker: string;
  contractAddress: string;
  tokenName: string;
  tokenMetadata?: Record<string, any> | null;
  primaryPoolAddress?: string | null;
}) {
  const tokenTicker = normTicker(args.tokenTicker);
  const tokenName = String(args.tokenName || "").trim();
  const contractAddress = String(args.contractAddress || "").trim();
  const tokenMetadata = args.tokenMetadata ?? null;
  const primaryPoolAddress = args.primaryPoolAddress ?? null;

  const badTicker = !tokenTicker || /^_+unknown_+$/i.test(tokenTicker);
  const badName = !tokenName;
  const badAddr = !isSolAddr(contractAddress);
  if (badTicker || badName || badAddr) {
    const reason = [
      badTicker ? "invalid_ticker" : null,
      badName ? "missing_token_name" : null,
      badAddr ? "invalid_address" : null,
    ]
      .filter(Boolean)
      .join(",");
    const evt = {
      level: "warn",
      scope: "upsert",
      reason,
      tokenTicker,
      tokenName,
      contractAddress,
    };
    // eslint-disable-next-line no-console
    console.warn("[RESOLVE]", evt);
    if (STRICT_RESOLVE) return; // hard reject in strict mode
  }

  await db
    .insert(coinCaTicker)
    .values({
      tokenTicker,
      contractAddress,
      tokenName,
      tokenMetadata,
      primaryPoolAddress,
    } as any)
    .onConflictDoUpdate({
      target: [coinCaTicker.tokenTicker, coinCaTicker.contractAddress],
      set: {
        tokenName: sql`coalesce(excluded.token_name, ${coinCaTicker.tokenName})`,
        primaryPoolAddress: sql`coalesce(excluded.primary_pool_address, ${coinCaTicker.primaryPoolAddress})`,
        tokenMetadata: sql`excluded.token_metadata`,
        updatedAt: sql`now()`,
      },
    })
    .catch(() => void 0);
}

export async function resolveTickerToCA(
  rawTicker: string,
): Promise<Candidate | null> {
  const ticker = normTicker(rawTicker);
  if (!ticker || BLOCK_TICKERS.has(ticker)) return null;

  const hit = await db
    .select()
    .from(coinCaTicker)
    .where(eq(coinCaTicker.tokenTicker, ticker))
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);

  if (hit.length) {
    const r = hit[0]!;
    if (isSolAddr(r.contractAddress)) {
      return {
        contractAddress: r.contractAddress,
        tokenTicker: r.tokenTicker || ticker,
        tokenName: r.tokenName || undefined,
        primaryPoolAddress: r.primaryPoolAddress || null,
        meta: { source: "db" },
        score: 1000,
      };
    }
  }

  const map = await resolveTickersToContracts([ticker]);
  const m = map.get(ticker.toLowerCase());
  if (!m || !isSolAddr(m.tokenKey)) return null;

  // Require symbol & tokenName for a valid resolved CA
  const symbol = normTicker(m.symbol || m.tokenDisplay || ticker);
  const tokenName = String(m.tokenName || "").trim();
  const check = validateMeta("ticker", {
    tokenKey: m.tokenKey,
    tokenDisplay: m.tokenDisplay,
    boostedConf: m.boostedConf,
    symbol,
    tokenName,
  });
  if (check.ok) {
    await upsertCoinCaTicker({
      tokenTicker: symbol,
      contractAddress: m.tokenKey,
      tokenName,
      tokenMetadata: { source: "geckoterminal", boostedConf: m.boostedConf },
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn("[RESOLVE]", {
      level: "warn",
      kind: "ticker",
      reason: check.reason,
      ticker,
      addr: m.tokenKey,
    });
    if (STRICT_RESOLVE) return null;
  }

  return {
    contractAddress: m.tokenKey,
    tokenTicker: symbol,
    tokenName: tokenName || undefined,
    meta: { source: "geckoterminal", boostedConf: m.boostedConf },
    score: m.boostedConf,
  };
}

export async function resolvePhraseToCA(
  rawPhrase: string,
): Promise<Candidate | null> {
  // DB-only, name-first strategy. We explicitly DO NOT treat the phrase as a ticker.
  // This avoids mapping generic text like "old coin" -> $OLD.
  const original = String(rawPhrase || "").trim();
  if (!original) return null;
  const core = stripCoinSuffix(original);
  // Guardrail: ignore tiny single-word phrases (e.g. "old", "moon").
  const isMultiWord = /\s/.test(core);
  if (!isMultiWord && core.length < 4) return null;
  const maybeTicker = normTicker(core);
  if (maybeTicker && BLOCK_TICKERS.has(maybeTicker)) return null;

  // 1) token_name == core (case-insensitive exact)
  const exactByName = await db
    .select()
    .from(coinCaTicker)
    .where(sql`${coinCaTicker.tokenName} ILIKE ${core}`)
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);
  if (exactByName.length && isSolAddr(exactByName[0]!.contractAddress)) {
    const r = exactByName[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker || undefined,
      tokenName: r.tokenName || undefined,
      primaryPoolAddress: r.primaryPoolAddress || null,
      meta: { source: "db-name" },
      score: 1000,
    };
  }

  // 2) token_name ILIKE %core% (fallback)
  const likeRows = await db
    .select()
    .from(coinCaTicker)
    .where(sql`${coinCaTicker.tokenName} ILIKE ${"%" + core + "%"}`)
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);
  if (likeRows.length && isSolAddr(likeRows[0]!.contractAddress)) {
    const r = likeRows[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker || undefined,
      tokenName: r.tokenName || undefined,
      primaryPoolAddress: r.primaryPoolAddress || null,
      meta: { source: "db-name-like" },
      score: 700,
    };
  }

  // Not found in KB → stop here (no market fallback)
  return null;
}
