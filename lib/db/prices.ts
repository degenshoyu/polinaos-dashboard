// lib/db/prices.ts
import { db } from "@/lib/db/client";
import { coinPrice, priceSource } from "@/lib/db/schema";
import { and, desc, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { z } from "zod";

/** Single price point to upsert/insert */
export const PriceUpsertSchema = z.object({
  contractAddress: z.string().min(5), // base58 or evm addr(lowercase)
  tokenTicker: z.string().optional(), // optional hint
  priceUsd: z.union([z.string(), z.number()]),
  priceAt: z.coerce.date().optional(), // default: now()
  source: z
    .enum(["geckoterminal", "defillama", "manual", "client_push"])
    .default("geckoterminal"),
  poolAddress: z.string().optional(),
  confidence: z.union([z.string(), z.number()]).optional(),
});
export type PriceUpsert = z.infer<typeof PriceUpsertSchema>;

/** Insert one snapshot (idempotent by (CA, source, priceAt)).
 *  If you created a UNIQUE index for (contractAddress, source, priceAt),
 *  prefer DoNothing to avoid conflicts.
 */
export async function insertPriceSnapshot(p: PriceUpsert) {
  const data = PriceUpsertSchema.parse(p);

  await db
    .insert(coinPrice)
    .values({
      contractAddress: data.contractAddress,
      poolAddress: data.poolAddress ?? null,
      source: data.source, // <-- now includes "client_push"
      priceUsd: String(data.priceUsd),
      priceAt: data.priceAt ?? new Date(),
      confidence: data.confidence != null ? String(data.confidence) : null,
    })
    .onConflictDoNothing({
      target: [coinPrice.contractAddress, coinPrice.source, coinPrice.priceAt],
    });
}

/** Bulk insert (best-effort) */
export async function insertPriceSnapshots(list: PriceUpsert[]) {
  for (const p of list) {
    await insertPriceSnapshot(p);
  }
}

/** Get the latest price for a set of contracts (per source optional) */
export async function getLatestPrices(params: {
  contractAddresses: string[];
  source?: (typeof priceSource.enumValues)[number]; // optional filter by source
}) {
  const { contractAddresses, source } = params;
  if (!contractAddresses.length) return [];

  // optional source filter
  const srcFilter = source ? sql`AND ${coinPrice.source} = ${source}` : sql``;

  // Use DISTINCT ON to pick the newest row per contract_address
  // NOTE: db.execute(...) returns a QueryResult with a `rows` array
  const res = await db.execute(sql`
    SELECT DISTINCT ON (${coinPrice.contractAddress})
      ${coinPrice.id}          AS id,
      ${coinPrice.contractAddress} AS contract_address,
      ${coinPrice.poolAddress}     AS pool_address,
      ${coinPrice.source}          AS source,
      ${coinPrice.priceUsd}        AS price_usd,
      ${coinPrice.priceAt}         AS price_at
    FROM ${coinPrice}
    WHERE ${inArray(coinPrice.contractAddress, contractAddresses)}
    ${srcFilter}
    ORDER BY ${coinPrice.contractAddress}, ${coinPrice.priceAt} DESC
  `);

  // Properly return the rows
  const rows = (res as unknown as { rows: any[] }).rows;

  return rows as Array<{
    id: string;
    contract_address: string;
    pool_address: string | null;
    source: (typeof priceSource.enumValues)[number];
    price_usd: string;
    price_at: string;
  }>;
}

/** Get historical window for a CA (for Earliest/Latest/Lowest/Highest) */
export async function getWindowPrices(params: {
  contractAddress: string;
  since?: Date;
  until?: Date;
  source?: (typeof priceSource.enumValues)[number];
}) {
  const { contractAddress, since, until, source } = params;

  const where = and(
    eq(coinPrice.contractAddress, contractAddress),
    since ? gte(coinPrice.priceAt, since) : undefined,
    until ? lte(coinPrice.priceAt, until) : undefined,
    source ? eq(coinPrice.source, source) : undefined,
  );

  const items = await db
    .select({
      priceUsd: coinPrice.priceUsd,
      priceAt: coinPrice.priceAt,
      source: coinPrice.source,
      poolAddress: coinPrice.poolAddress,
    })
    .from(coinPrice)
    .where(where)
    .orderBy(desc(coinPrice.priceAt)); // newest first

  return items;
}
