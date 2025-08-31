// components/CommitmentIndex.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/** ========== Types from jobProxy ========== */
type JobTweet = {
  tweetId?: string;
  tweeter?: string;
  textContent?: string;
  datetime?: string;
  statusLink?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  isVerified?: boolean;
};

type JobPayload = {
  job_id: string;
  status: string;
  tweets?: JobTweet[];
};

type Weights = {
  lengthWeight: number;       // 权重：长度
  originalityWeight: number;  // 权重：原创度
  lengthCap: number;          // 长度计分的上限词数
  rtPenalty: number;          // RT 惩罚
  linkHeavyPenalty: number;   // 链接重、文字少 惩罚
  analysisBoost: number;      // 分析型词汇加分
};

const DEFAULT_WEIGHTS: Weights = {
  lengthWeight: 0.6,
  originalityWeight: 0.4,
  lengthCap: 60,
  rtPenalty: 0.25,
  linkHeavyPenalty: 0.2,
  analysisBoost: 0.15,
};

const card =
  "p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5";
const panel = "rounded-2xl border border-white/10 bg-white/5";

/** ========== Main ========== */
export default function CommitmentIndex({
  deepLinkUrl,
  ticker,
  contractAddress,
  className = "",
}: {
  deepLinkUrl?: string;
  ticker?: string | null;
  contractAddress?: string | null;
  className?: string;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [rows, setRows] = useState<JobTweet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // weights with persistence
  const [weights, setWeights] = useState<Weights>(() => {
    try {
      const raw = localStorage.getItem("commitmentWeights");
      if (raw) return { ...DEFAULT_WEIGHTS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_WEIGHTS;
  });
  useEffect(() => {
    try {
      localStorage.setItem("commitmentWeights", JSON.stringify(weights));
    } catch {}
  }, [weights]);

  // Resolve jobId from deeplink or current URL
  useEffect(() => {
    const fromProp = deepLinkUrl ? new URL(deepLinkUrl).searchParams.get("job") : null;
    if (fromProp) setJobId(fromProp);
    else if (typeof window !== "undefined") {
      const p = new URL(window.location.href).searchParams.get("job");
      if (p) setJobId(p);
    }
  }, [deepLinkUrl]);

  // Fetch tweets (extracted so we can Refresh)
  const fetchTweets = async () => {
    if (!jobId) return;
    try {
      setRefreshing(true);
      setError(null);
      const r = await fetch(`/api/jobProxy?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const j = (await r.json()) as JobPayload;
      if (!r.ok) throw new Error((j as any)?.error || r.statusText);
      const list = Array.isArray(j.tweets) ? j.tweets : [];

      const norm = list
        .map((t) => {
          // —— 多字段兜底，和 deeplink 规范保持一致 —— //
          const text =
            (typeof t.textContent === "string" && t.textContent) ||
            (typeof (t as any).text === "string" && (t as any).text) ||
            (typeof (t as any).full_text === "string" && (t as any).full_text) ||
            (typeof (t as any).content === "string" && (t as any).content) ||
            "";
          const tweeter =
            t.tweeter ||
            (t as any).user?.screen_name ||
            (t as any).user?.name ||
            undefined;
          const statusLink =
            t.statusLink ||
            (typeof (t as any).id_str === "string" && tweeter
              ? `https://x.com/${tweeter}/status/${(t as any).id_str}`
              : undefined);

          return {
            ...t,
            textContent: text.replace(/\s+/g, " ").trim(),
            tweeter,
            statusLink,
          };
        })
        .filter((t) => typeof t.textContent === "string" && t.textContent.trim().length > 0);

      setRows(norm);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch job tweets");
    } finally {
      setRefreshing(false);
    }
  };

  // initial fetch
  useEffect(() => { if (jobId) fetchTweets(); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** ======= Filters ======= */
  const myTicker = ticker ? (ticker.startsWith("$") ? ticker : `$${ticker}`) : null;

  const tweetsFiltered = useMemo(() => {
    if (!rows) return null;
    return rows.filter((t) => {
      const text = (t.textContent || "").trim();
      if (isLinkOnly(text)) return false;

      const tickers = extractTickers(text);
      if (tickers.length && myTicker) {
        const allSame = tickers.every((x) => x.toLowerCase() === myTicker.toLowerCase());
        if (!allSame) return false;
      }

      const addrs = extractSolanaAddresses(text);
      if (contractAddress && addrs.length) {
        const onlySelf = addrs.every((x) => eqAddr(x, contractAddress));
        if (!onlySelf) return false;
      }

      if (pumpJargon(text)) return false;
      return true;
    });
  }, [rows, myTicker, contractAddress]);

  /** ======= Scoring (with detailed breakdown) ======= */
  type Breakdown = {
    words: number;
    lengthScore01: number;
    originality01: number;
    flags: { rt: boolean; linkHeavy: boolean; analysis: boolean };
    penaltiesApplied: string[];
    boostsApplied: string[];
    final01: number;
    final100: number;
  };

  // —— 先对整批推文做 3-gram 唯一度（模板重复会被扣分） —— //
  const uniqByTweetId = useMemo(() => {
    if (!tweetsFiltered) return new Map<string, number>();
    const allNgrams: Record<string, number> = {};
    const perTweet: { id: string; grams: string[] }[] = [];
    for (const t of tweetsFiltered) {
      const id = String(t.tweetId || t.statusLink || Math.random());
      const ws = tokenizeWords(t.textContent || "");
      const gs = ngrams(ws, 3);
      perTweet.push({ id, grams: gs });
      for (const g of gs) allNgrams[g] = (allNgrams[g] || 0) + 1;
    }
    const m = new Map<string, number>();
    for (const { id, grams } of perTweet) {
      if (grams.length === 0) { m.set(id, 0.5); continue; }
      const rarity = grams.reduce((s, g) => s + 1 / (allNgrams[g] || 1), 0) / grams.length; // 稀有度均值
      const score01 = Math.max(0, Math.min(1, rarity)); // 0~1
      m.set(id, score01);
    }
    return m;
  }, [tweetsFiltered]);

  function scoreTweet(t: JobTweet): Breakdown {
    const text = (t.textContent || "").trim();
    const ws = tokenizeWords(text);
    const words = ws.length;

    const lengthScore01 = clamp(words / Math.max(1, weights.lengthCap), 0, 1);

    // —— 原创度：从 0.5 起步，按项加减，最后 clamp 到 0~1 —— //
    let orig = 0.5;
    const penaltiesApplied: string[] = [];
    const boostsApplied: string[] = [];

    // 结构性特征
    const isRT = /^rt\s+@/i.test(text);
    if (isRT) { orig -= weights.rtPenalty; penaltiesApplied.push(`RT −${weights.rtPenalty}`); }

    const urlCount = countUrls(text);
    const linkHeavy = urlCount >= 2 && words < 18;
    if (linkHeavy) { orig -= weights.linkHeavyPenalty; penaltiesApplied.push(`Link-heavy −${weights.linkHeavyPenalty}`); }

    const ht = countHashtags(text);
    if (ht >= 4) { orig -= 0.12; penaltiesApplied.push("hashtags≥4 −0.12"); }
    const at = countMentions(text);
    if (at >= 3) { orig -= 0.10; penaltiesApplied.push("mentions≥3 −0.10"); }
    const emo = countEmojis(text);
    if (emo >= 5) { orig -= 0.08; penaltiesApplied.push("emojis≥5 −0.08"); }

    // 文本特征
    if (words < 14) { orig -= 0.12; penaltiesApplied.push("very short −0.12"); }
    const ttr = typeTokenRatio(ws);
    if (ttr > 0.7) { orig += 0.10; boostsApplied.push("vocab diversity +0.10"); }
    else if (ttr < 0.35) { orig -= 0.10; penaltiesApplied.push("low diversity −0.10"); }

    // 语料内唯一性（n-gram 稀有度）
    const uniq = uniqByTweetId.get(String(t.tweetId || t.statusLink || "")) ?? 0.5;
    const uniqDelta = (uniq - 0.5) * 0.24; // −0.12~+0.12
    orig += uniqDelta;
    (uniqDelta >= 0 ? boostsApplied : penaltiesApplied).push(`ngram uniqueness ${uniqDelta>=0?"+":""}${uniqDelta.toFixed(2)}`);

    // 分析性线索
    const isAnalysis = /\b(analysis|deep dive|thread|why|because|my view|in summary|breakdown|research)\b/i.test(text);
    if (isAnalysis) { orig += weights.analysisBoost; boostsApplied.push(`Analysis +${weights.analysisBoost}`); }

    const originality01 = clamp(orig, 0, 1);

    const final01 =
      weights.lengthWeight * lengthScore01 +
      weights.originalityWeight * originality01;

    return {
      words,
      lengthScore01,
      originality01,
      flags: { rt: isRT, linkHeavy, analysis: isAnalysis },
      penaltiesApplied,
      boostsApplied,
      final01: clamp(final01, 0, 1),
      final100: Math.round(clamp(final01, 0, 1) * 100),
    };
  }

  type AuthorView = {
    author: string;
    tweets: { t: JobTweet; b: Breakdown }[];
    avg: number;
    count: number;
    top: { t: JobTweet; b: Breakdown }[];
  };

  const authors = useMemo<AuthorView[] | null>(() => {
    if (!tweetsFiltered) return null;
    const bucket = new Map<string, { t: JobTweet; b: Breakdown }[]>();
    for (const t of tweetsFiltered) {
      const a = String(t.tweeter || "unknown").trim();
      if (!a) continue;
      const b = scoreTweet(t);
      const arr = bucket.get(a) || [];
      arr.push({ t, b });
      bucket.set(a, arr);
    }
    const views: AuthorView[] = Array.from(bucket.entries()).map(([author, list]) => {
      const avg = list.reduce((s, x) => s + x.b.final100, 0) / Math.max(1, list.length);
      const top = [...list].sort((A, B) => {
        const diff = B.b.final100 - A.b.final100; // 先按分
        if (diff !== 0) return diff;
        return (B.t.views || 0) - (A.t.views || 0); // 再按曝光
      }).slice(0, 3);
      return { author, tweets: list, avg, count: list.length, top };
    });
    return views.sort((a, b) => b.avg - a.avg || b.count - a.count).slice(0, 20);
  }, [tweetsFiltered, uniqByTweetId, weights]); // include deps

  /** ======= UI ======= */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  const myTickerLabel = ticker ? (ticker.startsWith("$") ? ticker : `$${ticker}`) : "n/a";
  const contractLabel = contractAddress ? shorten(contractAddress) : "n/a";

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      <div className={card}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Commitment Index (beta)
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTweets}
              disabled={!jobId || refreshing}
              className="px-2 py-1 text-xs rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Body states */}
        {!jobId && <p className="text-sm text-gray-500">Waiting for AI analysis… it appears here once tweets are collected.</p>}
        {error && <p className="text-sm text-rose-300">Error: {error}</p>}
        {jobId && rows && authors && authors.length === 0 && (
          <p className="text-sm text-gray-400">No qualified authors after filters.</p>
        )}
        {jobId && !rows && !error && <p className="text-sm text-gray-400">Loading tweets…</p>}

        {/* Authors list with expandable top tweets & breakdown */}
        {authors && authors.length > 0 && (
          <div className={`${panel} p-3`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Top committed authors</h3>
              <span className="text-[11px] text-white/50">
                score = length×{weights.lengthWeight.toFixed(2)} + originality×{(1 - weights.lengthWeight).toFixed(2)}
              </span>
            </div>

            <ul className="divide-y divide-white/10">
              {authors.map((a, i) => {
                const k = a.author;
                const isOpen = !!open[k];
                return (
                  <li key={k} className="py-2">
                    {/* Row */}
                    <button
                      className="w-full text-left flex items-center justify-between gap-3"
                      onClick={() => toggle(k)}
                      aria-expanded={isOpen}
                      title={`Open ${k}'s details`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-white/60 text-xs w-6 shrink-0 text-right">{i + 1}.</span>
                        <a
                          className="text-sm underline text-emerald-300 hover:text-emerald-200 truncate"
                          href={`https://x.com/${k}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`@${k}`}
                        >
                          @{k}
                        </a>
                        <span className="text-[11px] text-white/60 shrink-0">tweets: {a.count}</span>
                      </div>
                      <span className="inline-flex items-center gap-2">
                        <ScorePill n={Math.round(a.avg)} />
                        <Caret open={isOpen} />
                      </span>
                    </button>

                    {/* Details: top tweets with full breakdown */}
                    {isOpen && (
                      <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3">
                        {a.top.map(({ t, b }, idx) => (
                          <div key={t.tweetId || idx} className="p-2 rounded-md bg-black/20 border border-white/10 mb-2 last:mb-0">
                            {/* header line: link & metrics */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <a
                                  className="text-sm underline text-emerald-300 hover:text-emerald-200 truncate"
                                  href={t.statusLink}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View tweet ↗
                                </a>
                                <span className="text-[11px] text-white/60 shrink-0">
                                  L/R/Rp/V: {t.likes ?? 0}/{t.retweets ?? 0}/{t.replies ?? 0}/{t.views ?? 0}
                                </span>
                              </div>
                              <ScorePill n={b.final100} />
                            </div>

                            {/* text */}
                            <div className="text-sm text-white/80 mt-1 line-clamp-3">{t.textContent}</div>

                            {/* breakdown */}
                            <div className="mt-2 text-[12px] text-white/70">
                              <div className="flex items-center gap-2">
                                <span className="shrink-0">Length</span>
                                <Meter value={Math.round(b.lengthScore01 * 100)} />
                                <span className="font-mono text-white/80">{b.words}w → {(b.lengthScore01 * 100).toFixed(0)}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="shrink-0">Originality</span>
                                <Meter value={Math.round(b.originality01 * 100)} />
                                <span className="font-mono text-white/80">{(b.originality01 * 100).toFixed(0)}</span>
                              </div>

                              <div className="mt-1 text-white/70">
                                {b.penaltiesApplied.length === 0 && b.boostsApplied.length === 0 ? (
                                  <span className="text-white/50">no penalties/boosts</span>
                                ) : (
                                  <>
                                    {b.penaltiesApplied.length > 0 && (
                                      <span className="mr-2">penalties: <em className="text-rose-300">{b.penaltiesApplied.join(", ")}</em></span>
                                    )}
                                    {b.boostsApplied.length > 0 && (
                                      <span>boosts: <em className="text-emerald-300">{b.boostsApplied.join(", ")}</em></span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** ========== Small UI bits ========== */
function WeightsPopover({ weights, setWeights }: { weights: Weights; setWeights: React.Dispatch<React.SetStateAction<Weights>> }) {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 text-xs">
        Weights
      </summary>
      <div className="absolute right-0 mt-2 w-80 rounded-xl border border-white/10 bg-[#0e1413] shadow-xl p-3 z-20">
        <WeightSlider label="Length weight" min={0} max={1} step={0.05} value={weights.lengthWeight}
          onChange={(v) => setWeights((w) => ({ ...w, lengthWeight: v, originalityWeight: clamp(1 - v, 0, 1) }))} />
        <div className="text-[11px] text-white/50 mb-2">Originality weight = {(1 - weights.lengthWeight).toFixed(2)}</div>
        <WeightSlider label="Length cap (words)" min={20} max={120} step={5} value={weights.lengthCap}
          onChange={(v) => setWeights((w) => ({ ...w, lengthCap: Math.round(v) }))} />
        <WeightSlider label="RT penalty" min={0} max={0.6} step={0.05} value={weights.rtPenalty}
          onChange={(v) => setWeights((w) => ({ ...w, rtPenalty: v }))} />
        <WeightSlider label="Link-heavy penalty" min={0} max={0.6} step={0.05} value={weights.linkHeavyPenalty}
          onChange={(v) => setWeights((w) => ({ ...w, linkHeavyPenalty: v }))} />
        <WeightSlider label="Analysis boost" min={0} max={0.6} step={0.05} value={weights.analysisBoost}
          onChange={(v) => setWeights((w) => ({ ...w, analysisBoost: v }))} />
        <div className="mt-2 flex gap-2">
          <button onClick={() => setWeights(DEFAULT_WEIGHTS)} className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-xs">
            Reset
          </button>
          <button onClick={() => { try { localStorage.removeItem("commitmentWeights"); } catch {} }}
            className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-xs">
            Clear local
          </button>
        </div>
      </div>
    </details>
  );
}

function WeightSlider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block mb-2">
      <div className="text-xs text-white/70 mb-1">
        {label}: <span className="text-white/90 font-mono">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

function ScorePill({ n }: { n: number }) {
  return (
    <span className="text-sm font-mono px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-emerald-200">
      {n}
    </span>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span className={`text-white/70 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
  );
}

function Meter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-40 bg-white/10 rounded">
      <div className="h-2 bg-gradient-to-r from-emerald-500/80 to-emerald-300/80 rounded" style={{ width: `${v}%` }} />
    </div>
  );
}

/** ========== Helpers ========== */
function normalizeText(t?: JobTweet): string {
  const raw =
    (t?.textContent && typeof t.textContent === "string" && t.textContent) ||
    "";
  return raw.replace(/\s+/g, " ").trim();
}
function isLinkOnly(text: string): boolean {
  const without = text.replace(/https?:\/\/\S+/gi, "").trim();
  return without.length < 8;
}
function extractTickers(text: string): string[] {
  const arr = text.match(/\$[A-Za-z0-9_]{2,20}/g) || [];
  const set = new Set(arr.map((x) => x.toLowerCase()));
  return Array.from(set);
}
function extractSolanaAddresses(text: string): string[] {
  const re = /\b[1-9A-HJ-NP-Za-km-z]{32,}\b/g;
  const arr = text.match(re) || [];
  return Array.from(new Set(arr));
}
function eqAddr(a: string, b: string): boolean {
  return a.trim() === b.trim();
}
function pumpJargon(text: string): boolean {
  if (/\b\d{1,3}x\b/i.test(text)) return true;
  if (/\b(10x|20x|50x|100x)\b/i.test(text)) return true;
  if (/\b(join|my|private)\s+(channel|group)\b/i.test(text)) return true;
  return false;
}
function tokenizeWords(text: string): string[] {
  const t = text.replace(/https?:\/\/\S+/gi, " ");
  return t.split(/\s+/).filter(Boolean);
}
function countUrls(text: string) { return (text.match(/https?:\/\/\S+/gi) || []).length; }
function countHashtags(text: string) { return (text.match(/(^|\s)#[\p{L}\p{N}_]+/giu) || []).length; }
function countMentions(text: string) { return (text.match(/(^|\s)@[\w_]+/g) || []).length; }
// 简化版 emoji 匹配
function countEmojis(text: string) { return (text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []).length; }
function typeTokenRatio(words: string[]) {
  if (words.length === 0) return 0;
  const set = new Set(words.map((w) => w.toLowerCase()));
  return set.size / words.length; // 0~1
}
function ngrams(words: string[], n = 3): string[] {
  if (words.length < n) return [];
  const res: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    res.push(words.slice(i, i + n).map((w) => w.toLowerCase()).join(" "));
  }
  return res;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function shorten(addr: string, head = 6, tail = 6) {
  if (!addr) return "";
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
