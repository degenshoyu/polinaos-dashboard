// lib/tokens/extract.ts
export type MentionSource = "ca" | "ticker" | "hashtag" | "upper" | "phrase";
export type Mention = {
  tokenKey: string;
  tokenDisplay: string;
  source: MentionSource;
  confidence: number; // 0..100
};

const EVM_CA = /\b0x[a-fA-F0-9]{40}\b/g;
const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

const DOLLAR_TICKER = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/g;
const HASH_TICKER = /#[A-Z0-9]{2,10}\b/g;
const UPPER_TOKEN = /\b[A-Z]{2,6}\b/g;

const SHILL_HINTS = /\b(buy|ape|shill|moon|pump|launch|alpha)\b/i;

const PHRASE_MAP: Record<
  string,
  { key: string; display: string; conf?: number }
> = {
  "unstable coin": { key: "usduc", display: "$USDUC", conf: 95 },
};

function uniq<T>(arr: T[], key: (x: T) => string) {
  const m = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) {
      m.add(k);
      out.push(x);
    }
  }
  return out;
}
const normTicker = (s: string) => s.replace(/^[#$]+/, "").toLowerCase();

export function extractMentions(text: string): Mention[] {
  const m: Mention[] = [];
  if (!text) return m;

  const evm = text.match(EVM_CA) ?? [];
  for (const a of evm)
    m.push({
      tokenKey: a.toLowerCase(),
      tokenDisplay: a,
      source: "ca",
      confidence: 100,
    });

  const sol = text.match(SOL_CA) ?? [];
  for (const a of sol) {
    const conf = a.length >= 36 ? 75 : 60;
    m.push({ tokenKey: a, tokenDisplay: a, source: "ca", confidence: conf });
  }

  // $ticker
  const dollars = text.match(DOLLAR_TICKER) ?? [];
  for (const t of dollars)
    m.push({
      tokenKey: normTicker(t),
      tokenDisplay: t,
      source: "ticker",
      confidence: 95,
    });

  // #TICKER
  const tags = text.match(HASH_TICKER) ?? [];
  for (const t of tags)
    m.push({
      tokenKey: normTicker(t),
      tokenDisplay: t.replace(/^#/, "$"),
      source: "hashtag",
      confidence: 85,
    });

  const lower = text.toLowerCase();
  for (const k of Object.keys(PHRASE_MAP)) {
    if (lower.includes(k)) {
      const { key, display, conf = 90 } = PHRASE_MAP[k];
      m.push({
        tokenKey: key,
        tokenDisplay: display,
        source: "phrase",
        confidence: conf,
      });
    }
  }

  if (SHILL_HINTS.test(text) && false) {
    const uppers = text.match(UPPER_TOKEN) ?? [];
    for (const u of uppers) {
      if (u.length < 2 || u.length > 6) continue;
      if (["USD", "BTC", "ETH"].includes(u)) continue;
      m.push({
        tokenKey: u.toLowerCase(),
        tokenDisplay: `$${u}`,
        source: "upper",
        confidence: 60,
      });
    }
  }

  const grouped = new Map<string, Mention[]>();
  for (const x of m)
    grouped.set(x.tokenKey, [...(grouped.get(x.tokenKey) ?? []), x]);
  const deduped: Mention[] = [];
  for (const [key, arr] of grouped) {
    arr.sort(
      (a, b) =>
        (a.source === "ca" ? -1 : 0) - (b.source === "ca" ? -1 : 0) ||
        b.confidence - a.confidence,
    );
    deduped.push(arr[0]);
  }
  return deduped;
}
