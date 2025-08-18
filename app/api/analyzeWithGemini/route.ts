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
const MAX_TWEETS_PER_BATCH = parseIntSafe(process.env.AI_BATCH_SIZE, 60);
const MAX_WORDS_PER_BATCH = parseIntSafe(process.env.AI_BATCH_WORDS, 320);
const MAX_WORDS_FINAL = parseIntSafe(process.env.AI_FINAL_WORDS, 450);
const LLM_TIMEOUT_MS = parseDuration(process.env.AI_LLM_TIMEOUT_MS, 300_000);

/** ===================== Zod ===================== **/
const Body = z.object({
  tweets: z.array(z.object({ textContent: z.string().min(1) })).min(1),
  jobId: z.string().optional(),
  searchId: z.string().uuid().optional(),
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

/** ===================== Route ===================== **/
export async function POST(req: Request) {
  try {
    const { tweets, jobId, searchId, projectName } = Body.parse(
      await req.json(),
    );

    const clean = cleanupTweets(tweets);

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
          promptVersion: "v2-map-reduce-2.5-5min-2025-08-18",
          batches: batchSummaries.map((text, i) => ({ index: i + 1, text })),
          final: { text: finalMarkdown },
        },
        summaryText: finalMarkdown,
      });
    }

    return NextResponse.json({ text: finalMarkdown });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "AI error" },
      { status: 400 },
    );
  }
}
