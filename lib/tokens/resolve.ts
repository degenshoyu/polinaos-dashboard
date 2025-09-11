// lib/tokens/resolve.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@/lib/db/client";
import { coinCaTicker } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  resolveTickersToContracts,
  resolveNamesToContracts,
} from "@/lib/markets/geckoterminal";

const BLOCK_TICKERS = new Set(["BTC", "ETH", "SOL", "USDT", "USDC"]);

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

async function upsertLowConfidenceRow(args: {
  tokenTicker: string;
  contractAddress: string;
  tokenName?: string | null;
  tokenMetadata?: Record<string, any> | null;
  primaryPoolAddress?: string | null;
}) {
  const {
    tokenTicker,
    contractAddress,
    tokenName,
    tokenMetadata,
    primaryPoolAddress,
  } = args;

  await db
    .insert(coinCaTicker)
    .values({
      tokenTicker,
      contractAddress,
      tokenName: tokenName ?? null,
      tokenMetadata: tokenMetadata ?? null,
      primaryPoolAddress: primaryPoolAddress ?? null,
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

  await upsertLowConfidenceRow({
    tokenTicker: ticker,
    contractAddress: m.tokenKey,
    tokenMetadata: { source: "geckoterminal", boostedConf: m.boostedConf },
  });

  return {
    contractAddress: m.tokenKey,
    tokenTicker: ticker,
    meta: { source: "geckoterminal", boostedConf: m.boostedConf },
    score: m.boostedConf,
  };
}

export async function resolvePhraseToCA(
  rawPhrase: string,
): Promise<Candidate | null> {
  const name = String(rawPhrase || "").trim();
  if (!name) return null;

  const exact = await db
    .select()
    .from(coinCaTicker)
    .where(eq(coinCaTicker.tokenName, name))
    .orderBy(desc(coinCaTicker.priority), desc(coinCaTicker.updatedAt))
    .limit(1);

  if (exact.length && isSolAddr(exact[0]!.contractAddress)) {
    const r = exact[0]!;
    return {
      contractAddress: r.contractAddress,
      tokenTicker: r.tokenTicker || undefined,
      tokenName: r.tokenName || undefined,
      primaryPoolAddress: r.primaryPoolAddress || null,
      meta: { source: "db-name" },
      score: 1000,
    };
  }

  const likeRows = await db
    .select()
    .from(coinCaTicker)
    .where(sql`${coinCaTicker.tokenName} ILIKE ${"%" + name + "%"}`)
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

  const map = await resolveNamesToContracts([name]);
  const m = map.get(name.toLowerCase());
  if (!m || !isSolAddr(m.tokenKey)) return null;

  await upsertLowConfidenceRow({
    tokenTicker: "__UNKNOWN__",
    contractAddress: m.tokenKey,
    tokenName: name,
    tokenMetadata: { source: "geckoterminal:name", boostedConf: m.boostedConf },
  });

  return {
    contractAddress: m.tokenKey,
    tokenName: name,
    meta: { source: "geckoterminal:name", boostedConf: m.boostedConf },
    score: m.boostedConf,
  };
}
