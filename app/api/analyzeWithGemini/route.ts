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
import {
  computeEmotionalLandscape,
  type TweetForEmotion,
} from "@/lib/analysis/emotionalLandscape";
import { buildEmotionsInsightPrompt } from "@/lib/prompts/emotionsInsightPrompt";

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
  ctx?: { stage: "batch" | "synthesis"; batchIndex?: number; retry?: boolean },
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY / GOOGLE_API_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  try {
    const result: any = await withTimeout(
      model.generateContent(prompt),
      LLM_TIMEOUT_MS,
    );
    const resp = result?.response;
    const text =
      (typeof resp?.text === "function" ? resp.text() : resp?.text) ||
      (resp?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text)
        .filter(Boolean)
        .join("\n") ??
        "");
    if (text && String(text).trim()) return String(text);

    const debug = {
      stage: ctx?.stage,
      batchIndex: ctx?.batchIndex,
      model: modelName,
      candidates: resp?.candidates?.length ?? 0,
      promptFeedback: resp?.promptFeedback ?? null,
      safetyRatings: resp?.candidates?.[0]?.safetyRatings ?? null,
    };
    throw new Error("Empty response from Gemini: " + JSON.stringify(debug));
  } catch (err: any) {
    if (!ctx?.retry) {
      const FALLBACK_MODEL =
        process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-1.5-flash";
      const shortPrompt = prompt.slice(0, 12_000);
      console.warn("[GeminiRetry]", {
        stage: ctx?.stage,
        batchIndex: ctx?.batchIndex,
        use: FALLBACK_MODEL,
        short: prompt.length > 12000,
      });
      return callGemini(shortPrompt, FALLBACK_MODEL, { ...ctx, retry: true });
    }
    console.error("[GeminiFail]", ctx, err?.message || err);
    throw err;
  }
}

/** ===================== Metrics (deterministic) ===================== **/
function safeNum(n: any): number | undefined {
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

// ---------- Prompt hygiene & caps ----------
function stripUrls(s: string) {
  return s.replace(/https?:\/\/\S+/gi, "");
}
function stripAtMentions(s: string) {
  return s.replace(/(^|\s)@\w+/g, " ");
}
function collapseSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function capText(s: string, max = 320) {
  const t = collapseSpaces(stripAtMentions(stripUrls(s)));
  return t.length <= max ? t : t.slice(0, max) + "…";
}
function promptLen(s: string) {
  return s.length;
} // 粗略用字符数
const BATCH_MAX = parseIntSafe(process.env.AI_BATCH_PROMPT_MAX_CHARS, 12000);
const SYNTH_MAX = parseIntSafe(process.env.AI_SYNTH_PROMPT_MAX_CHARS, 8000);
const TWEET_CAP0 = parseIntSafe(process.env.AI_TWEET_CHAR_CAP, 320);

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

    const full: TweetForEmotion[] = (Array.isArray(tweetsRaw) ? tweetsRaw : [])
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
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      // 逐级收缩：320 → 160 → 100 字；仍超则丢尾
      const tryCaps = [TWEET_CAP0, 160, 100];
      let prompt: string | null = null;
      for (const cap of tryCaps) {
        const compact = batch.map((t) => ({
          textContent: capText(t.textContent, cap),
        }));
        const p = buildAnalyzePrompt(compact, {
          projectName,
          maxWords: MAX_WORDS_PER_BATCH,
        });
        if (promptLen(p) <= BATCH_MAX) {
          prompt = p;
          break;
        }
      }
      if (!prompt) {
        let cap = 100;
        let cur = batch.map((t) => ({
          textContent: capText(t.textContent, cap),
        }));
        while (cur.length > 0) {
          const p = buildAnalyzePrompt(cur, {
            projectName,
            maxWords: MAX_WORDS_PER_BATCH,
          });
          if (promptLen(p) <= BATCH_MAX) {
            prompt = p;
            break;
          }
          cur = cur.slice(0, cur.length - 3); // 每次去掉 3 条，加快收敛
        }
      }
      if (!prompt) {
        console.warn("[BatchDrop] prompt too long after trimming", {
          i,
          size: batches[i].length,
        });
        continue;
      }
      try {
        const summary = await callGemini(prompt, MODEL_NAME, {
          stage: "batch",
          batchIndex: i,
        });
        batchSummaries.push(summary);
      } catch (e: any) {
        console.warn("[BatchSkip]", i, e?.message || e);
      }
    }
    if (batchSummaries.length === 0) {
      return NextResponse.json(
        { error: "All batches failed (Gemini empty responses or oversized)." },
        { status: 400 },
      );
    }

    let synthesisPrompt = buildSynthesisPrompt(batchSummaries, {
      projectName,
      maxWords: MAX_WORDS_FINAL,
    });

    if (promptLen(synthesisPrompt) > SYNTH_MAX) {
      const trimmed = batchSummaries.map((s) =>
        s.length > 500 ? s.slice(0, 500) + "…" : s,
      );
      synthesisPrompt = buildSynthesisPrompt(trimmed, {
        projectName,
        maxWords: Math.min(MAX_WORDS_FINAL, 380),
      });
      if (promptLen(synthesisPrompt) > SYNTH_MAX) {
        let arr = [...trimmed];
        while (
          arr.length > 3 &&
          promptLen(buildSynthesisPrompt(arr, { projectName, maxWords: 360 })) >
            SYNTH_MAX
        ) {
          arr = arr.slice(1);
        }
        synthesisPrompt = buildSynthesisPrompt(arr, {
          projectName,
          maxWords: Math.min(MAX_WORDS_FINAL, 360),
        });
      }
    }
    const finalMarkdown = await callGemini(synthesisPrompt, MODEL_NAME, {
      stage: "synthesis",
    });

    const emotions = computeEmotionalLandscape(full);

    let emotionsInsight: string | null = null;
    try {
      const emoPrompt = buildEmotionsInsightPrompt(emotions, {
        projectName,
        maxWords: 160,
      });
      emotionsInsight = await callGemini(emoPrompt);
      // emotionsInsight = await callGemini(emoPrompt, MODEL_NAME, { stage: "emotions" });
    } catch {
      emotionsInsight = null;
    }

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
          emotions,
          emotionsInsight,
        },
        summaryText: finalMarkdown,
      });
    }

    return NextResponse.json({
      text: finalMarkdown,
      emotions,
      emotionsInsight,
    });
  } catch (e: any) {
    const payload = process.env.DEBUG_GEMINI
      ? { error: e?.message || "AI error", stack: e?.stack }
      : { error: e?.message || "AI error" };
    return NextResponse.json({ status: 400 });
  }
}
