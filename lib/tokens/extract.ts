// lib/tokens/extract.ts

/**
 * Mention extraction (Solana-only)
 *
 * What we detect from a tweet text:
 *  1) Contract address (CA): Solana Base58 (length 32–44). Confidence = 100.
 *     - We intentionally ignore EVM (0x...) here.
 *  2) $TICKER: dollar-prefixed alphanumeric (2–10 chars). Confidence = 95.
 *     - We intentionally ignore hashtag tokens like #TICKER.
 *  3) Phrase "<name> coin": the 1–2 words immediately before "coin" are treated as the token NAME.
 *     - Confidence = 70 by default. Later pipeline will resolve NAME → ticker/contract via GT.
 *
 * Deduplication rules:
 *  - Group by tokenKey (normalized).
 *  - Prefer CA over non-CA; for same kind, prefer higher confidence.
 *
 * Output fields:
 *  - tokenKey: normalized key (for CA it's the address as-is; for $ticker it's lowercase w/o "$";
 *              for phrase it's the lowercase name with single spaces)
 *  - tokenDisplay: original display text (e.g. "$BONK", the CA itself, or the original name)
 *  - source: "ca" | "ticker" | "phrase" (we keep "hashtag" | "upper" in the union for compatibility,
 *            but we do NOT emit them here)
 *  - confidence: integer in [0, 100]
 */

export type MentionSource = "ca" | "ticker" | "hashtag" | "upper" | "phrase";

export type Mention = {
  tokenKey: string;
  tokenDisplay: string;
  source: MentionSource;
  confidence: number; // 0..100
};

/** Solana Base58 address: 32–44 chars, no 0/O/I/l and excluding ambiguous chars */
const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** $TICKER: starts with $, 2–10 total characters (letters/digits), first must be a letter */
const DOLLAR_TICKER = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/g;

/**
 * "<name> coin" phrases:
 *  - allow 1~2 words as the name (letters/digits/hyphen), separated by a single space.
 *  - we match case-insensitively, but keep original casing for display.
 *  - examples: "unstable coin", "my-token coin"
 */
const NAME_COIN =
  /\b([a-z][a-z0-9-]{2,20}(?:\s+[a-z][a-z0-9-]{2,20})?)\s+coin\b/gi;

/** Normalize $ticker → bare lowercase key (e.g., "$BONK" → "bonk") */
const normTickerKey = (s: string) => s.replace(/^\$+/, "").toLowerCase();

/** Normalize phrase-name key: lowercase and collapse spaces (display keeps original slice) */
const normPhraseKey = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 64);

/** Group-by helper used for deduplication */
function groupBy<T>(arr: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function extractMentions(text: string): Mention[] {
  const out: Mention[] = [];
  if (!text) return out;

  // 1) Solana CA (confidence = 100)
  const sol = text.match(SOL_CA) ?? [];
  for (const a of sol) {
    out.push({
      tokenKey: a, // keep Base58 as-is for Solana
      tokenDisplay: a, // display the raw address; later pipeline may map to $SYMBOL
      source: "ca",
      confidence: 100, // per request: boost Solana CA to 100
    });
  }

  // 2) $ticker (confidence = 95). We do NOT emit hashtag tokens here.
  const dollars = text.match(DOLLAR_TICKER) ?? [];
  for (const t of dollars) {
    out.push({
      tokenKey: normTickerKey(t), // "bonk"
      tokenDisplay: t, // "$BONK" (original)
      source: "ticker",
      confidence: 95,
    });
  }

  // 3) "<name> coin" phrases (confidence = 70)
  //    We run the regex on a lowercase copy to match case-insensitively,
  //    but we slice the original text for display fidelity.
  const lower = text.toLowerCase();
  let match: RegExpExecArray | null;
  while ((match = NAME_COIN.exec(lower))) {
    // Slice the original text at the same span to preserve original casing
    const fullSpan = text.slice(match.index, match.index + match[0].length);
    // Remove trailing "coin" from the span to get the display name
    const displayName = fullSpan.replace(/\s+coin\b/i, "").trim();
    const key = normPhraseKey(displayName);
    if (!key) continue;

    out.push({
      tokenKey: key, // e.g., "unstable" or "my-token"
      tokenDisplay: displayName, // original display (e.g., "unstable" / "my-token")
      source: "phrase",
      confidence: 70,
    });
  }

  // Deduplicate by tokenKey: prefer CA > higher confidence
  const grouped = groupBy(out, (x) => x.tokenKey);
  const deduped: Mention[] = [];
  for (const [, arr] of grouped) {
    arr.sort((a, b) => {
      const aIsCA = a.source === "ca" ? 1 : 0;
      const bIsCA = b.source === "ca" ? 1 : 0;
      if (aIsCA !== bIsCA) return bIsCA - aIsCA; // CA first
      return b.confidence - a.confidence; // then by confidence
    });
    deduped.push(arr[0]);
  }

  return deduped;
}
