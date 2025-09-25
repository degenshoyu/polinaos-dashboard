// lib/kols/detectEngine.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { extractMentions, type Mention } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";
import { canonAddr } from "@/lib/chains/address";

/** ---------------- CA reconstruction (conservative) ---------------- */
const SOL_CA_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** Majors we never want as signals */
const BLOCK_TICKERS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "USDT",
  "USDC",
  "TRON",
  "ASTER",
  "AVNT",
  "GIGGLE",
  "STBL",
]);

/** Strip trailing noise like "<name> coin"/"<name> token" */
const stripCoinSuffix = (raw: string) =>
  String(raw || "")
    .replace(/\s+(coin|token)\b/gi, "")
    .trim();

/** Normalize a bare ticker text (no $) into uppercased ticker */
const normTicker = (s: string) =>
  String(s || "")
    .replace(/^\$+/, "")
    .trim()
    .toUpperCase();

/** Rebuild CA from pump.fun links where CA may be split across segments */
function collectFromPumpFun(text: string): string[] {
  const out: string[] = [];
  const RE = /pump\.fun\/coin\/([^\s]{1,90})/gi;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const tail = m[1] || "";
    const rest = text.slice(RE.lastIndex, RE.lastIndex + 160);
    const more = (rest.match(/[1-9A-HJ-NP-Za-km-z]{2,}/g) || []).join("");
    const candidate = (tail + more).replace(/[^1-9A-HJ-NP-Za-km-z]+/g, "");
    const clipped = candidate.slice(0, 64);
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

/** Rejoin space-split base58 pairs like "abc…xyz" -> "abcxyz" when valid */
function collectJoinedPairs(text: string): string[] {
  const out: string[] = [];
  const SPLIT2 =
    /\b([1-9A-HJ-NP-Za-km-z]{8,20})\s+([1-9A-HJ-NP-Za-km-z]{16,44})\b/g;
  let m: RegExpExecArray | null;
  while ((m = SPLIT2.exec(text)) !== null) {
    const joined = (m[1] + m[2]).trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(joined)) out.push(joined);
  }
  return out;
}

/** Keep only maximal (non-substring) candidates to reduce false positives */
function filterCAKeepMaximal(cas: string[]): Set<string> {
  const uniq = Array.from(new Set(cas));
  const keep = new Set<string>();
  for (const a of uniq) {
    let isSub = false;
    for (const b of uniq) {
      if (a === b) continue;
      if (b.includes(a)) {
        isSub = true;
        break;
      }
    }
    if (!isSub) keep.add(a);
  }
  return keep;
}

export function reconstructCAsFromTweet(text: string): Set<string> {
  const plain = (text || "").match(SOL_CA_RE) ?? [];
  const fromPump = collectFromPumpFun(text || "");
  const joined = collectJoinedPairs(text || "");
  return filterCAKeepMaximal([...plain, ...fromPump, ...joined]);
}

/** ---------------- Trigger helpers ---------------- */
function triggerInputFor(m: Mention) {
  if (m.source === "phrase") {
    // Pause "xxx coin" pattern: normalize to core phrase, no "coin/token" tail
    const base = m.tokenDisplay || m.tokenKey || "";
    return stripCoinSuffix(base);
  }
  if (m.source === "ca") return m.tokenKey || "";
  if (m.tokenDisplay?.startsWith("$")) return m.tokenDisplay;
  return `$${String(m.tokenKey || "").toUpperCase()}`;
}

export function makeDeterministicTriggerKey(m: Mention): string {
  if (m.source === "ca") {
    const addr = canonAddr(String(m.tokenKey || ""));
    return addr ? `ca:${addr}` : "ca:unknown";
  }
  if (m.source === "ticker") {
    return `tk:${String(m.tokenKey || "").toLowerCase()}`;
  }
  if (m.source === "phrase") {
    // Use normalized phrase core for stable key
    const core = stripCoinSuffix(m.tokenDisplay || m.tokenKey || "");
    return `ph:${core.toLowerCase()}`;
  }
  return `uk:${String(m.tokenKey || "").toLowerCase()}`;
}

/** ---------------- Types ---------------- */
export type MinimalTweet = { tweetId: string; textContent: string | null };
export type CandidateRow = {
  tweetId: string;
  tokenKey: string; // CA or raw ticker/phrase (no network resolution here)
  tokenDisplay: string | null; // pretty text for UI/logging
  confidence: number; // 0..100 from extractor
  source: Mention["source"]; // "ca" | "ticker" | "phrase"
  triggerKey: string; // deterministic, used as PK along with tweetId
  triggerText: string | null; // normalized text used for trigger
};

export type DetectStats = {
  scannedTweets: number;
  mentionsDetected: number;
  counts: { tickers: number; names: number; cas: number };
};

export type DetectResult = {
  rows: CandidateRow[];
  stats: DetectStats;
};

/** ---------------- Core engine: tweets -> candidate rows (NO DB, NO network) ---------------- */
export async function processTweetsToRows(
  tweets: MinimalTweet[],
  log: (e: any) => void = () => {},
): Promise<DetectResult> {
  const all: {
    tweetId: string;
    m: Mention;
    triggerKey: string;
    triggerText: string;
  }[] = [];
  const uniqueTickers = new Set<string>();
  const phraseNames = new Set<string>();
  const caSet = new Set<string>();

  // 1) Extract & reconstruct per tweet
  for (const t of tweets) {
    const txt = t.textContent ?? "";
    const rebuiltCAs = reconstructCAsFromTweet(txt);
    let ext = extractMentions(txt);

    // Prefer reconstructed CAs (longest), replace any raw CA mentions
    if (rebuiltCAs.size) {
      ext = ext.filter((x) => x.source !== "ca");
      for (const addr of rebuiltCAs) {
        ext.push({
          tokenKey: addr,
          tokenDisplay: addr,
          source: "ca",
          confidence: 100,
        } as Mention);
      }
    }

    for (const m of ext) {
      const input = triggerInputFor(m);
      // Early noise filtering:
      // - drop empty/too-short phrases after normalization
      if (m.source === "phrase") {
        const core = input.trim();
        const isMultiWord = /\s/.test(core);
        if (!core) continue;
        if (!isMultiWord && core.length < 4) continue;
      }
      // - drop majors tickers early (saves work downstream)
      if (m.source === "ticker") {
        const tk = normTicker(m.tokenKey || m.tokenDisplay || "");
        if (tk && BLOCK_TICKERS.has(tk)) continue;
      }
      let triggerKey = "";
      let triggerText = "";

      if (m.source === "ca") {
        const addr = String(m.tokenKey || "");
        triggerKey = makeDeterministicTriggerKey(m); // "ca:<base58>"
        triggerText = addr || input;
      } else {
        const built = buildTriggerKeyWithText({
          source: m.source as any,
          value: input,
        });
        triggerKey = (built as any)?.key || makeDeterministicTriggerKey(m);
        triggerText = (built as any)?.text || input;
      }

      all.push({ tweetId: t.tweetId, m, triggerKey, triggerText });

      if (m.source === "ca") {
        const addr = canonAddr(String(m.tokenKey || ""));
        if (addr) caSet.add(addr);
      } else if (m.source === "ticker") {
        const tk = m.tokenDisplay?.startsWith("$")
          ? m.tokenDisplay
          : `$${String(m.tokenKey || "").toUpperCase()}`;
        uniqueTickers.add(tk);
      } else if (m.source === "phrase") {
        const name = stripCoinSuffix(m.tokenDisplay || m.tokenKey || "").trim();
        if (name) phraseNames.add(name);
      }
    }
  }

  log({
    event: "extracted",
    tickers: uniqueTickers.size,
    names: phraseNames.size,
    cas: caSet.size,
  });

  // 2) Build rows (NO resolution; keep raw keys for ticker/phrase)
  const rows: CandidateRow[] = [];
  const seen = new Set<string>();

  for (const { tweetId, m, triggerKey, triggerText } of all) {
    // For CA, canon; for ticker/phrase, keep raw key (route will resolve)
    const tokenKey =
      m.source === "ca"
        ? canonAddr(String(m.tokenKey || "")) || ""
        : String(m.tokenKey || "");
    const tokenDisplay =
      m.source === "phrase"
        ? stripCoinSuffix(m.tokenDisplay || m.tokenKey || "") || null
        : (m.tokenDisplay ??
          (m.source === "ticker"
            ? m.tokenKey
              ? `$${String(m.tokenKey).toUpperCase()}`
              : null
            : (m.tokenKey ?? null)));

    const key = `${tweetId}___${triggerKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      tweetId,
      tokenKey,
      tokenDisplay,
      confidence: Math.min(100, Math.max(0, Math.round(m.confidence))),
      source: m.source,
      triggerKey,
      triggerText,
    });
  }

  return {
    rows,
    stats: {
      scannedTweets: tweets.length,
      mentionsDetected: rows.length,
      counts: {
        tickers: uniqueTickers.size,
        names: phraseNames.size,
        cas: caSet.size,
      },
    },
  };
}
