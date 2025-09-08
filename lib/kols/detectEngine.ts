// lib/kols/detectEngine.ts
import { extractMentions, type Mention } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";
import { canonAddr, isSolAddr } from "@/lib/chains/address";
import {
  resolveTickersToContracts,
  resolveContractsToMeta,
  resolveNamesToContracts,
} from "@/lib/markets/geckoterminal";

/** --------- CA reconstruct (conservative) --------- */
const SOL_CA_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

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

/** --------- trigger helpers --------- */
function triggerInputFor(m: Mention) {
  if (m.source === "phrase") return m.tokenDisplay || m.tokenKey || "";
  if (m.source === "ca") return m.tokenKey || "";
  if (m.tokenDisplay?.startsWith("$")) return m.tokenDisplay;
  return `$${String(m.tokenKey || "").toUpperCase()}`;
}

export function makeDeterministicTriggerKey(m: Mention): string {
  if (m.source === "ca") {
    const addr = canonAddr(String(m.tokenKey || ""));
    return addr ? `ca:${addr}` : "ca:unknown";
  }
  if (m.source === "ticker")
    return `tk:${String(m.tokenKey || "").toLowerCase()}`;
  if (m.source === "phrase")
    return `ph:${String(m.tokenKey || "").toLowerCase()}`;
  return `uk:${String(m.tokenKey || "").toLowerCase()}`;
}

/** --------- types --------- */
export type MinimalTweet = { tweetId: string; textContent: string | null };
export type CandidateRow = {
  tweetId: string;
  tokenKey: string;
  tokenDisplay: string | null;
  confidence: number; // 0..100
  source: Mention["source"];
  triggerKey: string;
  triggerText: string | null;
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

/** --------- core engine: tweets -> rows (no DB here) --------- */
export async function processTweetsToRows(
  tweets: MinimalTweet[],
  log: (e: any) => void = () => {},
): Promise<DetectResult> {
  // aggregate
  const all: {
    tweetId: string;
    m: Mention;
    triggerKey: string;
    triggerText: string;
  }[] = [];
  const uniqueTickers = new Set<string>();
  const phraseNames = new Set<string>();
  const caSet = new Set<string>();

  // 1) extract & reconstruct per tweet
  for (const t of tweets) {
    const txt = t.textContent ?? "";
    const rebuiltCAs = reconstructCAsFromTweet(txt);
    let ext = extractMentions(txt);
    if (rebuiltCAs.size) {
      // replace CA with reconstructed CA (longest)
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
        const name = (m.tokenDisplay || m.tokenKey || "").trim();
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

  // 2) resolve tickers/names/ca
  let byTicker = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  let byName = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  const byContract = new Map<
    string,
    { tokenDisplay: string; boostedConf: number }
  >();

  try {
    const normalizedTickers = [...uniqueTickers]
      .map((t) => t.replace(/^\$+/, "").toLowerCase())
      .filter(Boolean);

    log({
      event: "resolve_tickers_begin",
      collected: uniqueTickers.size,
      normalized: normalizedTickers.length,
    });
    {
      const raw = await resolveTickersToContracts(normalizedTickers);
      const norm = new Map<
        string,
        typeof raw extends Map<infer K, infer V> ? V : never
      >();
      for (const [k, v] of (raw as Map<string, any>).entries()) {
        const key = String(k).replace(/^\$+/, "").toLowerCase();
        norm.set(key, v);
      }
      byTicker = norm as any;
    }
    log({ event: "resolve_tickers_done" });
  } catch (e) {
    log({ event: "resolve_tickers_failed", error: String(e) });
  }
  try {
    const nameInputs = [...phraseNames]
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    log({ event: "resolve_names_begin", count: nameInputs.length });
    {
      const raw = await resolveNamesToContracts(nameInputs);
      const norm = new Map<
        string,
        typeof raw extends Map<infer K, infer V> ? V : never
      >();
      for (const [k, v] of (raw as Map<string, any>).entries()) {
        norm.set(String(k).trim().toLowerCase(), v);
      }
      byName = norm as any;
    }
    log({ event: "resolve_names_done" });
  } catch (e) {
    log({ event: "resolve_names_failed", error: String(e) });
  }

  for (const [, r] of byTicker.entries()) {
    const addr = canonAddr(String(r.tokenKey || ""));
    if (addr)
      byContract.set(addr, {
        tokenDisplay: r.tokenDisplay,
        boostedConf: r.boostedConf,
      });
  }

  const missingCA = Array.from(caSet).filter((a) => !byContract.has(a));
  if (missingCA.length) {
    log({ event: "resolve_ca_begin", count: missingCA.length });
    try {
      const caMeta = await resolveContractsToMeta(missingCA);
      for (const [addr, meta] of caMeta.entries()) {
        byContract.set(addr, {
          tokenDisplay: meta.tokenDisplay,
          boostedConf: meta.boostedConf,
        });
      }
      log({ event: "resolve_ca_done", hit: Array.from(caMeta.keys()).length });
    } catch (e) {
      log({ event: "resolve_ca_failed", error: String(e) });
    }
  }

  // -------- Build per-tweet "consensus" set (CA + resolved names) --------
  const tweetConsensus = new Map<string, Set<string>>();
  const addConsensus = (tid: string, addr?: string) => {
    const a = canonAddr(String(addr || ""));
    if (!a) return;
    let s = tweetConsensus.get(tid);
    if (!s) {
      s = new Set<string>();
      tweetConsensus.set(tid, s);
    }
    s.add(a);
  };
  for (const { tweetId, m } of all) {
    if (m.source === "ca") {
      addConsensus(tweetId, m.tokenKey);
    } else if (m.source === "phrase") {
      const q = (m.tokenDisplay || m.tokenKey || "").trim().toLowerCase();
      const r = byName.get(q) ?? byName.get(`${q} coin`);
      if (r && isSolAddr(r.tokenKey)) addConsensus(tweetId, r.tokenKey);
    }
  }

  // 3) build rows (dedupe by tweetId+triggerKey)
  const rows: CandidateRow[] = [];
  const seen = new Set<string>();

  for (const { tweetId, m, triggerKey, triggerText } of all) {
    let tokenKey = m.tokenKey;
    let tokenDisplay = m.tokenDisplay;
    let confidence = m.confidence;

    if (m.source === "ca") {
      const addr = canonAddr(String(m.tokenKey || ""));
      if (!addr) continue;
      tokenKey = addr;
      const meta = addr ? byContract.get(addr) : undefined;
      if (meta?.tokenDisplay) {
        tokenDisplay = meta.tokenDisplay;
        confidence = Math.max(confidence, meta.boostedConf ?? 0);
      } else {
        const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
        tokenDisplay = short;
      }
    } else if (m.source === "ticker") {
      const disp = m.tokenDisplay?.startsWith("$")
        ? m.tokenDisplay
        : `$${String(m.tokenKey || "").toUpperCase()}`;
      const r = byTicker.get(disp.replace(/^\$+/, "").toLowerCase());
      if (!r) continue; // unresolved ticker -> skip
      const ca = canonAddr(String(r.tokenKey || ""));
      if (!ca) {
        // ticker resolved to non-CA (fallback tokenKey), skip writing
        log({
          event: "suppress_ticker_non_ca",
          tweetId,
          ticker: disp,
          got: r.tokenKey,
        });
        continue;
      }
      // Weak ticker (no DEX/trending boost; boostedConf ≤ 98) needs consensus in *this tweet*
      const isWeak = (r.boostedConf || 0) <= 98;
      if (isWeak) {
        const cons = tweetConsensus.get(tweetId);
        if (!cons || !cons.has(ca)) {
          log({
            event: "suppress_weak_ticker",
            tweetId,
            ticker: disp,
            resolved: ca,
            reason: "no consensus (CA/name) in tweet",
          });
          continue;
        }
      }
      tokenKey = ca;
      tokenDisplay = r.tokenDisplay;
      confidence = Math.max(confidence, r.boostedConf);
    } else if (m.source === "phrase") {
      const q = (m.tokenDisplay || m.tokenKey || "").trim().toLowerCase();
      const r = byName.get(q) ?? byName.get(`${q} coin`);
      if (!r) continue;
      const ca = canonAddr(String(r.tokenKey || ""));
      if (!ca) continue;
      tokenKey = r.tokenKey;
      tokenDisplay = r.tokenDisplay;
      confidence = Math.max(confidence, r.boostedConf);
    }

    const key = `${tweetId}___${triggerKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // final guard: must have a valid Solana address
    const finalAddr = canonAddr(String(tokenKey || ""));
    if (!finalAddr) continue;
    rows.push({
      tweetId,
      tokenKey: finalAddr,
      tokenDisplay: tokenDisplay ?? (m.tokenDisplay || m.tokenKey),
      confidence: Math.min(100, Math.max(0, Math.round(confidence))),
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
