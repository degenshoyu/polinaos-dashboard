// components/filters/spamDetection.ts
// All comments are in English per your convention.

export type TweetLike = {
  textContent?: string;
  tweeter?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  isVerified?: boolean;
  statusLink?: string;
  datetime?: string;
};

export type SpamRules = {
  /** Core ticker without leading '$', lowercased. e.g. "sol" */
  coreTicker?: string | null;
  /** Target (allowed) contract address; Base58 (Solana/pump.fun style). */
  contractAddress?: string | null;
  /** Max count of OTHER tickers allowed in a single tweet. Default: 2 */
  maxOtherTickers?: number;
};

/** Strict Base58 (32–60 chars), commonly enough for Solana/pump.fun CAs */
export const BASE58_STRICT = /^[1-9A-HJ-NP-Za-km-z]{32,60}$/;
/** Global finder (use with .match) */
export const BASE58_GLOBAL = /[1-9A-HJ-NP-Za-km-z]{32,60}/g;

/** Extract $tickers (lowercased, without the leading $) from a text. */
export function extractTickers(text: string): string[] {
  const found = text.match(/\$[A-Za-z0-9_]{2,20}/g) || [];
  return found.map((s) => s.slice(1).toLowerCase());
}

/** Check if text contains any Base58 address other than `allowed`. */
export function hasOtherContracts(
  text: string,
  allowed?: string | null,
): boolean {
  const found = text.match(BASE58_GLOBAL) || [];
  if (!found.length) return false;
  if (!allowed || !BASE58_STRICT.test(allowed)) {
    // If no valid allowed CA is provided, treat ANY address as "other".
    return true;
  }
  // If any CA is different from allowed → it's "other".
  return new Set(found.filter((addr) => addr !== allowed)).size > 0;
}

/** Count how many OTHER $tickers appear (i.e., not the core). */
export function countOtherTickers(text: string, core?: string | null): number {
  const coreTk = (core || "").toLowerCase().trim();
  const tickers = extractTickers(text);
  return tickers.filter((sym) => sym !== coreTk && sym.length > 0).length;
}

/** Filter out "spammy" tweets based on rules. */
export function filterSpamTweets<T extends TweetLike>(
  tweets: T[],
  rules: SpamRules,
): T[] {
  const {
    coreTicker = null,
    contractAddress = null,
    maxOtherTickers = 2,
  } = rules;

  return tweets.filter((t) => {
    const text = t.textContent || "";

    // Rule 1: ban tweets containing any non-target contract address
    if (hasOtherContracts(text, contractAddress)) return false;

    // Rule 2: ban tweets that contain more than `maxOtherTickers` other $tickers
    const others = countOtherTickers(text, coreTicker);
    if (others > maxOtherTickers) return false;

    return true;
  });
}

/** Resolve core ticker (without $) from job keywords; fallback "$ASSET". */
export function resolveCoreFromJob(keyword: unknown): string | null {
  const list = Array.isArray(keyword)
    ? (keyword as string[]).filter((s) => typeof s === "string")
    : [];
  const first = list.find((k) => /^\$[A-Za-z0-9_]{2,20}$/.test(k));
  return first ? first.slice(1).toLowerCase() : null;
}

/** Resolve target CA from keywords + raw tweets. */
export function resolveCAFromJob<T extends TweetLike>(
  keyword: unknown,
  tweets: T[],
): string | null {
  // Priority: exact match in keywords → first Base58 in texts
  const list = Array.isArray(keyword)
    ? (keyword as string[]).filter((s) => typeof s === "string")
    : [];
  const kwHit = list.find((s) => BASE58_STRICT.test(s));
  if (kwHit) return kwHit;

  for (const t of tweets) {
    const text = t.textContent || "";
    const found = text.match(BASE58_GLOBAL);
    if (found && found.length) {
      const first = found.find((x) => BASE58_STRICT.test(x));
      if (first) return first;
    }
  }
  return null;
}
