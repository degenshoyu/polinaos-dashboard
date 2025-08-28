// app/api/analyzeWithGemini/stream/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { searches, aiUnderstandings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildAnalyzePrompt,
  buildSynthesisPrompt,
  type TweetLite,
} from "@/lib/prompts/analyzeWithGeminiPrompt";
import {
  computeEmotionalLandscape,
  type TweetForEmotion,
} from "@/lib/analysis/emotionalLandscape";
import { buildEmotionsInsightPrompt } from "@/lib/prompts/emotionsInsightPrompt";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_NAME = process.env.GEMINI_MODEL_NAME?.trim() || "gemini-2.5-flash";
const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-1.5-flash";

const AI_BATCH_SIZE = Number(process.env.AI_BATCH_SIZE ?? 30);
const AI_BATCH_WORDS = Number(process.env.AI_BATCH_WORDS ?? 320);
const AI_FINAL_WORDS = Number(process.env.AI_FINAL_WORDS ?? 450);
const BATCH_MAX = Number(process.env.AI_BATCH_PROMPT_MAX_CHARS ?? 12000);
const SYNTH_MAX = Number(process.env.AI_SYNTH_PROMPT_MAX_CHARS ?? 8000);
const TWEET_CAP0 = Number(process.env.AI_TWEET_CHAR_CAP ?? 320);
const LLM_TIMEOUT_MS = Number(process.env.AI_LLM_TIMEOUT_MS ?? 300000);

const Body = z
  .object({
    job: z.any().optional(),
    tweets: z.array(z.any()).min(1).optional(),
    jobId: z.string().nullable().optional(),
    searchId: z.string().uuid().nullable().optional(),
    projectName: z.string().optional(),
  })
  .refine(
    (v) =>
      (Array.isArray(v.tweets) && v.tweets.length > 0) ||
      (typeof v.jobId === "string" && v.jobId?.trim()) ||
      (typeof v.searchId === "string" && v.searchId?.trim()),
    { message: "Provide `tweets` or `jobId` or `searchId`" },
  );

function extractTextFromTweet(anyTweet: any): string {
  return (
    (typeof anyTweet?.textContent === "string" && anyTweet.textContent) ||
    (typeof anyTweet?.text === "string" && anyTweet.text) ||
    (typeof anyTweet?.full_text === "string" && anyTweet.full_text) ||
    (typeof anyTweet?.content === "string" && anyTweet.content) ||
    ""
  );
}
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
}

async function callGemini(
  prompt: string,
  model: string,
  ctx?: { stage?: string; batch?: number },
) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY/GOOGLE_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model });
  const p = m.generateContent(prompt);
  const res = (await Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("LLM timeout")), LLM_TIMEOUT_MS),
    ),
  ])) as any;
  const text =
    typeof res?.response?.text === "function"
      ? res.response.text()
      : res?.response?.text;
  if (text && String(text).trim()) return String(text);
  // fallback once
  if (!ctx || (ctx && (ctx as any).retried !== true)) {
    return callGemini(prompt.slice(0, 12000), FALLBACK_MODEL, {
      ...ctx,
      retried: true,
    });
  }
  throw new Error("Empty LLM response");
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${ev}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const end = () => controller.close();
      try {
        const parsed = Body.parse(await req.json());
        send("init", {
          model: MODEL_NAME,
          caps: { AI_BATCH_SIZE, AI_BATCH_WORDS, AI_FINAL_WORDS },
        });

        let tweetsRaw: any[] = Array.isArray(parsed.tweets)
          ? parsed.tweets
          : [];
        if (tweetsRaw.length === 0) {
          const hdrProto = req.headers.get("x-forwarded-proto") || "http";
          const hdrHost = req.headers.get("host");
          const baseUrl =
            process.env.APP_BASE_URL ||
            (hdrHost ? `${hdrProto}://${hdrHost}` : "");

          async function tryJson(path: string) {
            try {
              const r = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
              if (!r.ok) return null;
              return await r.json().catch(() => null);
            } catch {
              return null;
            }
          }

          let jobId = (parsed.jobId || "")?.trim() || "";
          if (!jobId && parsed.searchId) {
            const a = await tryJson(
              `/api/searches?id=${encodeURIComponent(parsed.searchId)}`,
            );
            const b = jobId
              ? null
              : await tryJson(
                  `/api/searches/${encodeURIComponent(parsed.searchId)}`,
                );
            const pick = a || b || {};
            jobId =
              pick?.jobId ||
              pick?.job_id ||
              pick?.search?.jobId ||
              pick?.search?.job_id ||
              "";
            jobId = typeof jobId === "string" ? jobId.trim() : "";
          }

          if (jobId) {
            const jp = await tryJson(
              `/api/jobProxy?job_id=${encodeURIComponent(jobId)}`,
            );
            const arr = Array.isArray(jp?.tweets) ? jp.tweets : [];
            tweetsRaw = arr;
          }
        }
        send("input", { raw: tweetsRaw.length });

        // normalize & filter
        const full: TweetForEmotion[] = (
          Array.isArray(tweetsRaw) ? tweetsRaw : []
        )
          .map((t: any) => ({
            textContent: extractTextFromTweet(t),
            tweetId: t?.tweetId || t?.id_str || t?.id,
            tweeter: t?.tweeter || t?.user?.screen_name || t?.user?.name,
            datetime: t?.datetime || t?.created_at,
            isVerified: Boolean(t?.isVerified || t?.user?.verified),
            views: Number.isFinite(Number(t?.views))
              ? Number(t?.views)
              : undefined,
            likes: Number.isFinite(Number(t?.likes ?? t?.favorite_count))
              ? Number(t?.likes ?? t?.favorite_count)
              : undefined,
            replies: Number.isFinite(Number(t?.replies))
              ? Number(t?.replies)
              : undefined,
            retweets: Number.isFinite(Number(t?.retweets ?? t?.retweet_count))
              ? Number(t?.retweets ?? t?.retweet_count)
              : undefined,
            statusLink: t?.statusLink,
          }))
          .filter(
            (t) =>
              typeof t.textContent === "string" &&
              t.textContent.trim().length > 0,
          );
        send("normalized", { full: full.length });

        const lite = full.map(({ textContent }) => ({ textContent }));
        const clean = cleanupTweets(lite);
        if (!clean.length) {
          send("error", { message: "No valid tweets after normalization" });
          return end();
        }
        send("cleaned", {
          unique: clean.length,
          dropped: lite.length - clean.length,
        });

        const batches = chunkArray(clean, AI_BATCH_SIZE);
        send("chunked", {
          batchCount: batches.length,
          sizes: batches.map((b) => b.length),
        });

        const projectName =
          parsed.projectName ??
          (Array.isArray(parsed?.job?.keyword)
            ? String(parsed.job.keyword[0] || "")
            : undefined);

        // per-batch LLM
        const batchSummaries: string[] = [];
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const tryCaps = [TWEET_CAP0, 160, 100];
          let prompt: string | null = null;

          for (const cap of tryCaps) {
            const compact = batch.map((t) => ({
              textContent: capText(t.textContent, cap),
            }));
            const p = buildAnalyzePrompt(compact, {
              projectName,
              maxWords: AI_BATCH_WORDS,
            });
            const len = promptLen(p);
            send("batch_prompt_try", { i, cap, len, BATCH_MAX });
            if (len <= BATCH_MAX) {
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
                maxWords: AI_BATCH_WORDS,
              });
              const len = promptLen(p);
              send("batch_trim_count_try", {
                i,
                cap,
                tryCount: cur.length,
                len,
                BATCH_MAX,
              });
              if (len <= BATCH_MAX) {
                prompt = p;
                break;
              }
              cur = cur.slice(0, cur.length - 3);
            }
          }
          if (!prompt) {
            send("batch_drop", { i, size: batch.length });
            continue;
          }
          send("batch_llm_start", { i });
          try {
            const summary = await callGemini(prompt, MODEL_NAME, {
              stage: "batch",
              batch: i,
            });
            batchSummaries.push(summary);
            send("batch_llm_ok", { i, summaryLen: summary.length });
          } catch (e: any) {
            send("batch_llm_fail", { i, error: e?.message || String(e) });
          }
        }
        if (!batchSummaries.length) {
          send("error", { message: "All batches failed" });
          return end();
        }

        // synthesis
        send("synthesis_start", { count: batchSummaries.length });
        let synthesisPrompt = buildSynthesisPrompt(batchSummaries, {
          projectName,
          maxWords: AI_FINAL_WORDS,
        });
        if (promptLen(synthesisPrompt) > SYNTH_MAX) {
          const trimmed = batchSummaries.map((s) =>
            s.length > 500 ? s.slice(0, 500) + "…" : s,
          );
          synthesisPrompt = buildSynthesisPrompt(trimmed, {
            projectName,
            maxWords: Math.min(AI_FINAL_WORDS, 380),
          });
          if (promptLen(synthesisPrompt) > SYNTH_MAX) {
            let arr = [...trimmed];
            while (
              arr.length > 3 &&
              promptLen(
                buildSynthesisPrompt(arr, { projectName, maxWords: 360 }),
              ) > SYNTH_MAX
            ) {
              arr = arr.slice(1);
            }
            synthesisPrompt = buildSynthesisPrompt(arr, {
              projectName,
              maxWords: Math.min(AI_FINAL_WORDS, 360),
            });
          }
        }
        const finalMarkdown = await callGemini(synthesisPrompt, MODEL_NAME, {
          stage: "synthesis",
        });
        send("synthesis_ok", { len: finalMarkdown.length });

        // emotions
        send("emotions_compute", { tweets: full.length });
        const emotions = computeEmotionalLandscape(full);
        let emotionsInsight: string | null = null;
        try {
          const emoPrompt = buildEmotionsInsightPrompt(emotions, {
            projectName,
            maxWords: 160,
          });
          send("emotions_llm_start", {});
          emotionsInsight = await callGemini(emoPrompt, MODEL_NAME, {
            stage: "emotions",
          });
          send("emotions_llm_ok", { len: emotionsInsight?.length ?? 0 });
        } catch {
          send("emotions_llm_fail", {});
        }

        // resolve searchId & persist
        let resolvedSearchId: string | undefined = parsed.searchId ?? undefined;
        if (!resolvedSearchId && parsed.jobId) {
          const row = await db.query.searches.findFirst({
            where: eq(searches.jobId, parsed.jobId),
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
              batches: batches.map((b, i) => ({
                index: i + 1,
                size: b.length,
                text: batchSummaries[i] ?? "",
              })),
              final: { text: finalMarkdown },
              emotions,
              emotionsInsight,
            },
            summaryText: finalMarkdown,
          });
          send("persist_ok", { searchId: resolvedSearchId });
        } else {
          send("persist_skip", {});
        }

        send("done", { text: finalMarkdown, emotions, emotionsInsight });
        end();
      } catch (e: any) {
        send("error", { message: e?.message || "AI error" });
        end();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
