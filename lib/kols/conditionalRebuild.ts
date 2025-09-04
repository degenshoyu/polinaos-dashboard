// lib/kols/conditionalRebuild.ts
import { inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { extractMentions } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";

type DB = typeof defaultDb;

export type MinimalTweet = {
  tweetId: string;
  text: string;
};

export type ConditionalRebuildOptions = {
  /** Skip rebuild if existing max(confidence) > threshold (0~100). Default: 98 */
  threshold?: number;
  /** Batch size for deletes/inserts to avoid huge SQL parameter lists. Default: 800 */
  chunkSize?: number;
  /**
   * Ensure these $tickers (without $) exist as mentions for tweets that contain them in text.
   * If text contains `$foo` but DB lacks `token_display ILIKE 'foo'`, force rebuild that tweet.
   */
  requiredTickers?: string[];
};

/** --- Address & key helpers --- */
function isEvm(addr: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
function isSol(addr: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}
function canonAddr(addr: string) {
  return isEvm(addr) ? addr.toLowerCase() : addr; // Solana kept as-is
}
function makeTokenKey(
  tokenDisplay: string | null,
  contractAddr: string | null,
) {
  if (contractAddr) return canonAddr(contractAddr);
  if (tokenDisplay) return tokenDisplay.replace(/^\$+/, "").toLowerCase();
  return null;
}
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** --- Confidence fallback: prefer m.confidence; otherwise simple heuristic --- */
function resolveConfidence(m: any): number {
  const c = Number((m && m.confidence) ?? NaN);
  if (Number.isFinite(c)) return Math.max(0, Math.min(100, c));

  const kind = String((m && m.kind) || "").toLowerCase();
  const v = String(
    (m && (m.ticker || m.value || m.symbol || m.contract || m.address || "")) ||
      "",
  );
  // Heuristics: contract-like → 100; $ticker-like → 99; others → 90
  if (kind === "contract" || isSol(v)) return 100;
  if (/^\$[A-Za-z0-9_]{2,20}$/.test(v)) return 99;
  return 90;
}

/** Deduplicate by tweetId; keep the longest text for the same id. */
function dedupeTweets(items: MinimalTweet[]): MinimalTweet[] {
  const map = new Map<string, string>();
  for (const it of items) {
    const id = (it?.tweetId || "").trim();
    const tx = (it?.text || "").trim();
    if (!id || !tx) continue;
    if (!map.has(id) || map.get(id)!.length < tx.length) map.set(id, tx);
  }
  return Array.from(map, ([tweetId, text]) => ({ tweetId, text }));
}

/** Simple batch helper */
function batch<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Safe wrapper over extractMentions() to never throw and normalize shapes. */
function safeExtractMentions(text: string): any[] {
  try {
    const out = extractMentions?.(text);
    if (Array.isArray(out)) return out;
    if (out && Array.isArray((out as any).mentions))
      return (out as any).mentions;
    return [];
  } catch {
    return [];
  }
}

/**
 * Build a string trigger key from buildTriggerKeyWithText() across variants:
 * - Some implementations expect input: { source, value }
 * - Some return string; others return { key }
 */
function safeTriggerKey(text: string): string | null {
  try {
    const res = (buildTriggerKeyWithText as any)?.({
      source: "text", // if you have an enum Source.Text, use that instead
      value: text,
    } as any);

    if (typeof res === "string") return res;
    if (res && typeof res === "object" && "key" in (res as any)) {
      const k = (res as any).key;
      if (typeof k === "string" && k.length > 0) return k;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Conditionally rebuild mentions for a list of tweets with SOL-first policy:
 * - Skip a tweet if current max(confidence) > threshold
 * - BUT if the text contains any required $ticker and DB lacks that ticker mention → force rebuild
 * - When rebuilding:
 *   - If mention is from ticker or phrase (not an explicit pasted contract), drop EVM 0x contracts
 *   - Only accept EVM contracts when the mention kind is 'contract' (explicit CA in text)
 *   - Always write tokenKey (CA canonical or lowercased ticker) for stable dedupe/join
 */
export async function conditionalRebuildMentionsForTweets(
  db: DB,
  tweets: MinimalTweet[],
  opts?: ConditionalRebuildOptions,
) {
  const threshold = Math.max(0, Math.min(100, opts?.threshold ?? 98));
  const chunk = Math.max(1, opts?.chunkSize ?? 800);

  // 1) Dedup by tweetId
  const uniq = dedupeTweets(tweets);
  if (!uniq.length) return { checked: 0, skipped: 0, rebuilt: 0, inserted: 0 };

  // 2) Current max(confidence) per tweetId
  const idBatches = batch(
    uniq.map((t) => t.tweetId),
    chunk,
  );
  const existMax = new Map<string, number>();
  for (const ids of idBatches) {
    const rows = await (db as any)
      .select({
        tweetId: (tweetTokenMentions as any).tweetId,
        maxConf: sql<number>`MAX(${(tweetTokenMentions as any).confidence})`,
      })
      .from(tweetTokenMentions as any)
      .where(inArray((tweetTokenMentions as any).tweetId, ids))
      .groupBy((tweetTokenMentions as any).tweetId);

    for (const r of rows) {
      const id = String(r.tweetId);
      const maxConf = Number(r.maxConf ?? 0);
      existMax.set(id, isFinite(maxConf) ? maxConf : 0);
    }
  }

  // 3) Base rebuild set by threshold
  const baseNeedsRebuild = new Set(
    uniq
      .filter((t) => {
        const maxConf = existMax.get(t.tweetId);
        if (maxConf == null) return true; // no records
        if (maxConf > threshold) return false; // already high-confidence
        return true; // low-confidence
      })
      .map((t) => t.tweetId),
  );

  // 4) Required tickers (e.g. ensure $buddy is present)
  const required = (opts?.requiredTickers ?? [])
    .map((s) => s.trim().replace(/^\$+/, "").toLowerCase())
    .filter(Boolean);

  if (required.length) {
    const textSaysHas = new Map<string, Set<string>>(); // tweetId -> set(required tickers found)
    for (const t of uniq) {
      const found = new Set<string>();
      for (const tk of required) {
        const re = new RegExp(`\\$${escapeRegex(tk)}\\b`, "i");
        if (re.test(t.text)) found.add(tk);
      }
      if (found.size) textSaysHas.set(t.tweetId, found);
    }

    const candidateIds = Array.from(textSaysHas.keys());
    if (candidateIds.length) {
      const rows = await (db as any)
        .select({
          tweetId: (tweetTokenMentions as any).tweetId,
          tokenDisplay: (tweetTokenMentions as any).tokenDisplay,
        })
        .from(tweetTokenMentions as any)
        .where(inArray((tweetTokenMentions as any).tweetId, candidateIds));

      const hasTicker = new Map<string, Set<string>>(); // tweetId -> { tickerLower }
      for (const r of rows) {
        const id = String(r.tweetId);
        const td = String(r.tokenDisplay ?? "")
          .replace(/^\$+/, "")
          .toLowerCase();
        if (!td) continue;
        if (!hasTicker.has(id)) hasTicker.set(id, new Set());
        hasTicker.get(id)!.add(td);
      }

      for (const id of candidateIds) {
        const expected = textSaysHas.get(id)!;
        const existing = hasTicker.get(id) ?? new Set<string>();
        for (const tk of expected) {
          if (!existing.has(tk)) {
            baseNeedsRebuild.add(id); // force rebuild if missing required ticker
            break;
          }
        }
      }
    }
  }

  // 5) Materialize rebuild list
  const needsRebuildList = uniq.filter((t) => baseNeedsRebuild.has(t.tweetId));
  if (!needsRebuildList.length) {
    return {
      checked: uniq.length,
      skipped: uniq.length,
      rebuilt: 0,
      inserted: 0,
    };
  }

  // 6) Delete old mentions
  for (const ids of batch(
    needsRebuildList.map((t) => t.tweetId),
    chunk,
  )) {
    await (db as any)
      .delete(tweetTokenMentions)
      .where(inArray((tweetTokenMentions as any).tweetId, ids));
  }

  // 7) Re-extract with SOL-first policy & write tokenKey
  let inserted = 0;
  const values: Array<typeof tweetTokenMentions.$inferInsert> = [];

  for (const t of needsRebuildList) {
    const triggerKey = safeTriggerKey(t.text);
    const mentions = safeExtractMentions(t.text);

    for (const m of mentions) {
      const kind = String((m as any).kind || "").toLowerCase(); // 'ticker' | 'contract' | 'phrase' | ...
      const tokenDisplay =
        (m as any).ticker?.toString?.() ||
        (m as any).value?.toString?.() ||
        (m as any).symbol?.toString?.() ||
        "";

      const hasTicker =
        !!tokenDisplay &&
        /^\$?[A-Za-z0-9_]{2,20}$/.test(tokenDisplay.replace(/^\$+/, ""));
      const displayNorm = hasTicker
        ? `$${tokenDisplay.replace(/^\$+/, "").toUpperCase()}`
        : null;

      const contractRaw =
        (m as any).contract?.toString?.() ||
        (m as any).address?.toString?.() ||
        (m as any).ca?.toString?.() ||
        "";

      // --- SOL-first filter:
      // - If the mention is NOT an explicit contract paste, drop EVM 0x addresses (we only keep SOL)
      // - Accept EVM 0x ONLY when kind === 'contract' (explicit CA in text)
      if (contractRaw && isEvm(contractRaw) && kind !== "contract") {
        // skip wrong-chain CA inferred from ticker/phrase
        continue;
      }

      // After filtering, if nothing left to store, skip
      if (!displayNorm && !contractRaw) continue;

      const tokenKey = makeTokenKey(displayNorm, contractRaw || null);
      const confidence = resolveConfidence(m);

      values.push({
        tweetId: t.tweetId,
        tokenKey, // <-- IMPORTANT: always write token_key
        tokenDisplay: displayNorm, // nullable
        contractAddress: contractRaw ? canonAddr(contractRaw) : null,
        source: "text" as any, // replace with mentionSource.text if you have enum
        triggerKey, // nullable
        confidence,
      } as any);
    }
  }

  for (const rows of batch(values, chunk)) {
    if (!rows.length) continue;
    await (db as any).insert(tweetTokenMentions).values(rows);
    inserted += rows.length;
  }

  return {
    checked: uniq.length,
    skipped: uniq.length - needsRebuildList.length,
    rebuilt: needsRebuildList.length,
    inserted,
  };
}

/** Fetch tweets' text by ids if you only have tweetIds at the call site. */
export async function fetchTweetsByIds(
  db: DB,
  tweetIds: string[],
): Promise<MinimalTweet[]> {
  if (!tweetIds?.length) return [];
  const rows = (await (db as any)
    .select()
    .from(kolTweets)
    .where(inArray((kolTweets as any).tweetId, tweetIds))) as any[];

  const out: MinimalTweet[] = [];
  for (const r of rows) {
    const txt =
      r?.textContent ??
      r?.text ??
      r?.full_text ??
      r?.fullText ??
      r?.content ??
      r?.body ??
      r?.rawText ??
      "";
    const id = r?.tweetId ?? r?.tweet_id ?? r?.id ?? "";
    if (id && txt) out.push({ tweetId: String(id), text: String(txt) });
  }
  return out;
}
