// lib/tokens/extract.ts

/**
 * Mention extraction (Solana-only)
 *
 * Detected from tweet text:
 *  1) Contract address (CA): Solana Base58 (length 32–44). Confidence = 100.
 *     - We intentionally ignore EVM (0x...) here.
 *     - Robust to line breaks/whitespace splits and pump.fun URLs.
 *  2) $TICKER: dollar-prefixed alphanumeric (2–10 chars, first is a letter). Confidence = 95.
 *     - We intentionally ignore hashtag tokens like #TICKER.
 *  3) Phrase "<name> coin": extract the SINGLE token immediately before "coin". Confidence = 80.
 *     - Filter stopwords like "the/a/that/this/my/your/his/her/its/their" etc.
 *
 * Deduplication:
 *  - Group by tokenKey (normalized).
 *  - Prefer CA over non-CA; for same kind, prefer higher confidence.
 *
 * Output fields:
 *  - tokenKey:
 *      • CA → the address as-is (Solana Base58)
 *      • $ticker → lowercase without "$" (e.g., "$BONK" → "bonk")
 *      • phrase  → lowercase single token before "coin" (e.g., "unstable")
 *  - tokenDisplay: original display text ($TICKER / CA / phrase token with original casing)
 *  - source: "ca" | "ticker" | "phrase" (union keeps "hashtag" | "upper" for compatibility,
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

/** Solana Base58: 32–44 chars, no ambiguous chars (0,O,I,l). */
const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** $TICKER: starts with $, 2–10 total chars (letters/digits), first must be a letter. */
const DOLLAR_TICKER = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/g;

/**
 * "<name> coin" (SINGLE token immediately before "coin")
 * - token characters allowed: letters/digits/underscore/hyphen/dot
 * - case-insensitive match, we still keep original slice for display text
 * - examples:
 *    • "buy unstable coin"   -> "unstable"
 *    • "my-token coin"       -> "my-token"
 *    • "pepe2.0 coin"        -> "pepe2.0"
 * - rejected stopwords: "the/a/that/this/my/your/his/her/its/their/..." (see STOPWORDS)
 */
const NAME_BEFORE_COIN = /\b([A-Za-z][A-Za-z0-9._-]{2,32})\s+coin\b/gi;

/** Extended stopwords based on observed data. Keep lowercase. */
const STOPWORDS = new Set([
  "the",
  "a",
  "that",
  "this",
  "my",
  "your",
  "his",
  "her",
  "its",
  "their",
  "every",
  "insane",
  "crazy",
  "real",
  "mega",
  "marketcap",
  "streamer",
]);

/** Normalize $ticker → bare lowercase key (e.g., "$BONK" → "bonk"). */
const normTickerKey = (s: string) => s.replace(/^\$+/, "").toLowerCase();

/** Normalize phrase token → lowercase (single token already enforced by regex). */
const normPhraseKey = (s: string) => s.trim().toLowerCase();

/** Group-by helper used for deduplication. */
function groupBy<T>(arr: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

/** Join two Base58 chunks and validate Solana length; return null if invalid. */
function tryJoinBase58(a: string, b: string): string | null {
  const joined = (a + b).trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(joined)) return joined;
  return null;
}

/**
 * Extract CA candidates from pump.fun URLs, tolerant to line breaks after "/coin/".
 * Example broken text:
 *   https://pump.fun/coin/8mznFjdcG
 *   HhfvxkP1JVC7Ttn2gQJzNWmU8Zuw8cipump
 * Will re-assemble to a valid Base58 of length 32–44 if possible.
 */
function collectFromPumpFun(text: string): string[] {
  const out: string[] = [];
  // match "pump.fun/coin/<tail>" capturing up to ~90 chars (can contain breaks)
  const RE = /pump\.fun\/coin\/([^\s]{1,90})/gi;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    let tail = m[1] || "";
    // look ahead a bit and join any subsequent base58 fragments
    const rest = text.slice(RE.lastIndex, RE.lastIndex + 160);
    const more = (rest.match(/[1-9A-HJ-NP-Za-km-z]{2,}/g) || []).join("");
    const candidate = (tail + more).replace(/[^1-9A-HJ-NP-Za-km-z]+/g, "");
    const clipped = candidate.slice(0, 64); // safety upper bound
    // choose the longest valid prefix within [32, 44]
    for (let L = Math.min(44, clipped.length); L >= 32; L--) {
      const head = clipped.slice(0, L);
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(head)) {
        out.push(head);
        break;
      }
    }
  }
  return out;
}

/**
 * Extract CA by joining two Base58 chunks split by whitespace/newline.
 * Example: "8mznFjdcG\nHhfvxkP1JVC7Ttn2gQJzNWmU8Zuw8cipump"
 */
function collectJoinedPairs(text: string): string[] {
  const out: string[] = [];
  const SPLIT2 =
    /\b([1-9A-HJ-NP-Za-km-z]{8,20})\s+([1-9A-HJ-NP-Za-km-z]{16,44})\b/g;
  let m: RegExpExecArray | null;
  while ((m = SPLIT2.exec(text)) !== null) {
    const a = m[1];
    const b = m[2];
    const j = tryJoinBase58(a, b);
    if (j) out.push(j);
  }
  return out;
}

/** Remove zero-width characters that sometimes appear in scraped texts. */
function stripZeroWidth(s: string) {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, "");
}

export function extractMentions(text: string): Mention[] {
  const out: Mention[] = [];
  if (!text) return out;

  // Pre-clean: remove zero-width characters to avoid regex misalignment.
  const scanText = stripZeroWidth(text);

  /** ---------------------- 1) Contract addresses (CA) ---------------------- */
  // 1.a Fix-ups: pump.fun URL reassembly + whitespace-joined Base58
  const pumpCAs = collectFromPumpFun(scanText);
  const joinedCAs = collectJoinedPairs(scanText);
  // 1.b Plain scan for contiguous Base58 CAs
  const plainCAs = scanText.match(SOL_CA) ?? [];
  // Merge & dedupe
  const allCAs = Array.from(
    new Set<string>([...pumpCAs, ...joinedCAs, ...plainCAs]),
  );
  for (const a of allCAs) {
    out.push({
      tokenKey: a, // keep Base58 as-is for Solana
      tokenDisplay: a, // raw address; later pipeline can map to $SYMBOL
      source: "ca",
      confidence: 100, // Solana CA = 100
    });
  }

  /** ---------------------- 2) $ticker ---------------------- */
  const dollars = scanText.match(DOLLAR_TICKER) ?? [];
  for (const t of dollars) {
    out.push({
      tokenKey: normTickerKey(t), // e.g., "bonk"
      tokenDisplay: t, // original "$BONK"
      source: "ticker",
      confidence: 95,
    });
  }

  /** ---------------------- 3) "<name> coin" (single token) ---------------------- */
  let m: RegExpExecArray | null;
  while ((m = NAME_BEFORE_COIN.exec(scanText)) !== null) {
    // m[1] is the token just before "coin"
    let raw = (m[1] || "").trim();
    // Drop leading '#' or '$' (avoid misclassifying hashtags/tickers as a phrase name)
    raw = raw.replace(/^[#$]+/, "");

    const key = normPhraseKey(raw);
    if (!key) continue;
    if (STOPWORDS.has(key)) continue; // reject common adjectives/pronouns/articles

    out.push({
      tokenKey: key, // e.g., "unstable"
      tokenDisplay: raw, // keep original casing; DO NOT prefix "$"
      source: "phrase",
      confidence: 80,
    });
  }

  /** ---------------------- Deduplication ---------------------- */
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
