// app/api/analyzeWithGemini/route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { searches, aiUnderstandings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  buildAnalyzePrompt,
  buildSynthesisPrompt,
  type TweetLite,
} from "@/lib/prompts/analyzeWithGeminiPrompt";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const maxDuration = 300;

/** ===================== Safe env parsing helpers ===================== **/
function parseDuration(input: string | undefined, fallbackMs: number): number {
  if (!input) return fallbackMs;
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+)\s*(ms|s|m)$/); // 300s / 5m / 500ms
  if (!m) return fallbackMs;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return fallbackMs;
  switch (m[2]) {
    case "ms":
      return v;
    case "s":
      return v * 1000;
    case "m":
      return v * 60_000;
    default:
      return fallbackMs;
  }
}
function parseIntSafe(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const n = Number(input);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ===================== Config ===================== **/
const MODEL_NAME = process.env.GEMINI_MODEL_NAME?.trim() || "gemini-2.5-flash";
const MAX_TWEETS_PER_BATCH = parseIntSafe(process.env.AI_BATCH_SIZE, 30);
const MAX_WORDS_PER_BATCH = parseIntSafe(process.env.AI_BATCH_WORDS, 320);
const MAX_WORDS_FINAL = parseIntSafe(process.env.AI_FINAL_WORDS, 450);
const LLM_TIMEOUT_MS = parseDuration(process.env.AI_LLM_TIMEOUT_MS, 300_000);

/** ===================== Zod ===================== **/
const Body = z.object({
  job: z.any().optional(),
  tweets: z.array(z.any()).min(1),
  jobId: z.string().nullable().optional(),
  searchId: z.string().uuid().nullable().optional(),
  projectName: z.string().optional(),
});

/** ===================== Helpers ===================== **/
type TweetForAI = {
  textContent: string;
  tweetId?: string;
  tweeter?: string;
  datetime?: string; // ISO
  isVerified?: boolean;
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  statusLink?: string;
};

function cleanupTweets(tweets: TweetLite[]): TweetLite[] {
  const seen = new Set<string>();
  const out: TweetLite[] = [];
  for (const t of tweets) {
    const text = (t.textContent || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ textContent: text });
  }
  return out;
}

function extractTextFromTweet(anyTweet: any): string {
  const s =
    (typeof anyTweet?.textContent === "string" && anyTweet.textContent) ||
    (typeof anyTweet?.text === "string" && anyTweet.text) ||
    (typeof anyTweet?.full_text === "string" && anyTweet.full_text) ||
    (typeof anyTweet?.content === "string" && anyTweet.content) ||
    "";
  return s || "";
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  msg = "LLM request timeout",
): Promise<T> {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 300_000;
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(msg)), safeMs),
    ),
  ]) as Promise<T>;
}
async function callGemini(
  prompt: string,
  modelName = MODEL_NAME,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY / GOOGLE_API_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await withTimeout(
    model.generateContent(prompt),
    LLM_TIMEOUT_MS,
  );
  const text = result.response?.text?.() ?? result.response?.text();
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

/** ===================== Metrics (deterministic) ===================== **/
function safeNum(n: any): number | undefined {
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}
function ymd(d?: string) {
  if (!d) return undefined;
  const t = new Date(d);
  if (isNaN(+t)) return undefined;
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}
function topN<T>(arr: T[], key: (t: T) => number, n: number) {
  return [...arr].sort((a, b) => key(b) - key(a)).slice(0, n);
}
const TOKEN_RX = /\$[a-z0-9_]+/gi;
const HASH_RX = /#[a-z0-9_]+/gi;

function deriveMetrics(rows: TweetForAI[]) {
  const total = rows.length;
  const byUser = new Map<
    string,
    {
      user: string;
      count: number;
      likes: number;
      retweets: number;
      replies: number;
      views: number;
    }
  >();
  let sumLikes = 0,
    sumRT = 0,
    sumRep = 0,
    sumViews = 0,
    verified = 0;
  const byDay = new Map<
    string,
    {
      date: string;
      count: number;
      likes: number;
      retweets: number;
      replies: number;
      views: number;
    }
  >();
  const tokenFreq = new Map<string, number>();
  const hashFreq = new Map<string, number>();

  let firstAt: Date | null = null,
    lastAt: Date | null = null;

  for (const t of rows) {
    const u = (t.tweeter || "").toLowerCase();
    const likes = safeNum(t.likes) || 0;
    const rts = safeNum(t.retweets) || 0;
    const reps = safeNum(t.replies) || 0;
    const views = safeNum(t.views) || 0;

    sumLikes += likes;
    sumRT += rts;
    sumRep += reps;
    sumViews += views;
    if (t.isVerified) verified++;

    if (u) {
      const cur = byUser.get(u) || {
        user: u,
        count: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
      };
      cur.count += 1;
      cur.likes += likes;
      cur.retweets += rts;
      cur.replies += reps;
      cur.views += views;
      byUser.set(u, cur);
    }

    const day = ymd(t.datetime) || "unknown";
    const curDay = byDay.get(day) || {
      date: day,
      count: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
    };
    curDay.count += 1;
    curDay.likes += likes;
    curDay.retweets += rts;
    curDay.replies += reps;
    curDay.views += views;
    byDay.set(day, curDay);

    // tokens / hashtags from text
    const txt = t.textContent || "";
    for (const m of txt.match(TOKEN_RX) || [])
      tokenFreq.set(m.toUpperCase(), (tokenFreq.get(m.toUpperCase()) || 0) + 1);
    for (const m of txt.match(HASH_RX) || [])
      hashFreq.set(m.toLowerCase(), (hashFreq.get(m.toLowerCase()) || 0) + 1);

    // recency
    if (t.datetime) {
      const dt = new Date(t.datetime);
      if (!isNaN(+dt)) {
        if (!firstAt || dt < firstAt) firstAt = dt;
        if (!lastAt || dt > lastAt) lastAt = dt;
      }
    }
  }

  const uniqueTweeters = byUser.size;
  const engagementAvg =
    total > 0
      ? {
          likes: +(sumLikes / total).toFixed(2),
          retweets: +(sumRT / total).toFixed(2),
          replies: +(sumRep / total).toFixed(2),
          views: +(sumViews / total).toFixed(2),
        }
      : { likes: 0, retweets: 0, replies: 0, views: 0 };

  const usersArr = [...byUser.values()];
  const topTweetersByCount = topN(usersArr, (u) => u.count, 10);
  const topTweetersByEng = topN(
    usersArr,
    (u) => u.likes + u.retweets * 2 + u.replies,
    10,
  );

  const topTweetsByEngagement = topN(
    rows,
    (t) =>
      (safeNum(t.likes) || 0) +
      (safeNum(t.retweets) || 0) * 2 +
      (safeNum(t.replies) || 0),
    15,
  ).map((t) => ({
    tweetId: t.tweetId,
    tweeter: t.tweeter,
    datetime: t.datetime,
    likes: safeNum(t.likes) || 0,
    retweets: safeNum(t.retweets) || 0,
    replies: safeNum(t.replies) || 0,
    views: safeNum(t.views) || 0,
    statusLink: t.statusLink,
    textPreview: (t.textContent || "").slice(0, 160),
  }));

  const daySeries = [...byDay.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const tokens = topN(
    [...tokenFreq.entries()].map(([k, v]) => ({ token: k, count: v })),
    (x) => x.count,
    20,
  );
  const hashtags = topN(
    [...hashFreq.entries()].map(([k, v]) => ({ hashtag: k, count: v })),
    (x) => x.count,
    20,
  );

  const windowDays =
    firstAt && lastAt
      ? Math.max(1, Math.round((+lastAt - +firstAt) / 86400000) + 1)
      : null;

  return {
    totals: {
      tweets: total,
      uniqueTweeters,
      verifiedTweets: verified,
      verifiedShare: total ? +((verified / total) * 100).toFixed(2) : 0,
      window:
        firstAt && lastAt
          ? {
              start: firstAt.toISOString(),
              end: lastAt.toISOString(),
              days: windowDays,
            }
          : null,
    },
    engagement: {
      sum: {
        likes: sumLikes,
        retweets: sumRT,
        replies: sumRep,
        views: sumViews,
      },
      avg: engagementAvg,
    },
    topTweetersByCount,
    topTweetersByEngagement: topTweetersByEng,
    topTweetsByEngagement,
    timeSeriesDaily: daySeries,
    tokens,
    hashtags,
  };
}

function buildMetricsInsightPrompt(
  projectName: string | undefined,
  metricsJson: unknown,
  sampleTweets: TweetForAI[],
) {
  const header = `You are a crypto/Twitter growth analyst. I will give you (1) aggregated numeric metrics and (2) a tiny sample of tweets (metadata + text preview).`;
  const task = `Your job: write a **short, actionable Markdown** insight (<= 180 words) with:
- 3–5 bullets interpreting the metrics (momentum, concentration风险, verified占比、互动质量等)
- 2 concrete growth ideas based on data (e.g., activate specific tweeters/time windows/hashtags)
Rules: do **not** redo any arithmetic; reason only from the metrics JSON. Use concise English.`;
  const ctx = {
    projectName: projectName || null,
    metrics: metricsJson,
    sample: sampleTweets.slice(0, 8),
  };
  return `${header}\n\n${task}\n\nDATA (JSON):\n${JSON.stringify(ctx, null, 2)}\n\nReturn Markdown only.`;
}

/** ===================== Route ===================== **/
export async function POST(req: Request) {
  try {
    const parsed = Body.parse(await req.json());
    const tweetsRaw = parsed.tweets;
    const jobId = parsed.jobId ?? undefined;
    const searchId = parsed.searchId ?? undefined;
    const projectName =
      parsed.projectName ??
      (Array.isArray(parsed?.job?.keyword)
        ? String(parsed.job.keyword[0] || "")
        : undefined);

    const full: TweetForAI[] = (Array.isArray(tweetsRaw) ? tweetsRaw : [])
      .map((t: any) => ({
        textContent: extractTextFromTweet(t),
        tweetId: t?.tweetId || t?.id_str || t?.id,
        tweeter: t?.tweeter || t?.user?.screen_name || t?.user?.name,
        datetime: t?.datetime || t?.created_at,
        isVerified: Boolean(t?.isVerified || t?.user?.verified),
        views: safeNum(t?.views),
        likes: safeNum(t?.likes || t?.favorite_count),
        replies: safeNum(t?.replies),
        retweets: safeNum(t?.retweets || t?.retweet_count),
        statusLink: t?.statusLink,
      }))
      .filter(
        (t) =>
          typeof t.textContent === "string" && t.textContent.trim().length > 0,
      );

    const lite = full.map(({ textContent }) => ({ textContent }));
    const clean = cleanupTweets(lite);
    if (clean.length === 0) {
      return NextResponse.json(
        { error: "No valid tweets to analyze after normalization." },
        { status: 400 },
      );
    }

    const batches = chunkArray(clean, MAX_TWEETS_PER_BATCH);

    const batchSummaries: string[] = [];
    for (const batch of batches) {
      const prompt = buildAnalyzePrompt(batch, {
        projectName,
        maxWords: MAX_WORDS_PER_BATCH,
      });
      const summary = await callGemini(prompt);
      batchSummaries.push(summary);
    }

    const synthesisPrompt = buildSynthesisPrompt(batchSummaries, {
      projectName,
      maxWords: MAX_WORDS_FINAL,
    });
    const finalMarkdown = await callGemini(synthesisPrompt);

    const metrics = deriveMetrics(full);
    const metricsInsight = await callGemini(
      buildMetricsInsightPrompt(projectName, metrics, full),
    ).catch(() => "");

    let resolvedSearchId: string | undefined = searchId;

    if (!resolvedSearchId && jobId) {
      const row = await db.query.searches.findFirst({
        where: eq(searches.jobId, jobId),
        columns: { id: true },
      });
      resolvedSearchId = row?.id;
    }

    if (!resolvedSearchId) {
      const session = await getServerSession(authOptions);
      const userId: string | null = (session?.user as any)?.id ?? null;
      const cookieStore = await cookies();
      const anonSessionId: string | null =
        cookieStore.get("anon_session_id")?.value ?? null;

      if (userId) {
        const rows = await db
          .select({ id: searches.id })
          .from(searches)
          .where(eq(searches.userId, userId))
          .orderBy(desc(searches.createdAt))
          .limit(1);
        resolvedSearchId = rows[0]?.id;
      } else if (anonSessionId) {
        const rows = await db
          .select({ id: searches.id })
          .from(searches)
          .where(eq(searches.anonSessionId, anonSessionId))
          .orderBy(desc(searches.createdAt))
          .limit(1);
        resolvedSearchId = rows[0]?.id;
      }
    }

    if (resolvedSearchId) {
      await db.insert(aiUnderstandings).values({
        searchId: resolvedSearchId,
        model: MODEL_NAME,
        resultJson: {
          promptVersion: "v2-map-reduce-2.5-5min-2025-08-18+fulljson",
          job: parsed.job ?? null,
          batches: batchSummaries.map((text, i) => ({
            index: i + 1,
            size: batches[i]?.length ?? 0,
            text,
          })),
          final: { text: finalMarkdown },
          metrics,
          metricsInsight: metricsInsight || null,
        },
        summaryText: finalMarkdown,
      });
    }

    return NextResponse.json({ text: finalMarkdown, metrics, metricsInsight });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "AI error" },
      { status: 400 },
    );
  }
}
