// app/api/analyzeWithGemini/route.ts
import { NextResponse } from "next/server";
import { buildAnalyzeWithGeminiPrompt } from "@/lib/prompts/analyzeWithGeminiPrompt";
import { getErrorMessage } from "@/lib/errors";

/** ===================== Config & Tunables ===================== */
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";
const API_KEY = process.env.GEMINI_API_KEY!;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_TWEETS_PER_BATCH = toNum(process.env.MAX_TWEETS_PER_BATCH, 25);
const MAX_BATCHES = toNum(process.env.MAX_BATCHES, 10);
const BATCH_OUTPUT_HINT_TOKENS = toNum(
  process.env.BATCH_OUTPUT_HINT_TOKENS,
  500,
);
const FINAL_OUTPUT_HINT_TOKENS = toNum(
  process.env.FINAL_OUTPUT_HINT_TOKENS,
  1000,
);
const TIMEOUT_MS = toNum(process.env.GEMINI_TIMEOUT_MS, 60_000);

/** ===================== Route Handler ===================== */
export async function POST(req: Request) {
  try {
    if (!API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing" },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const tweets = (body?.tweets ?? []) as Array<Record<string, unknown>>;

    if (!Array.isArray(tweets) || tweets.length === 0) {
      return NextResponse.json(
        { error: "Expected body: { tweets: Array<{ textContent?: string }>" },
        { status: 400 },
      );
    }

    const texts = tweets
      .map((t) => {
        const s =
          (typeof t["textContent"] === "string" &&
            (t["textContent"] as string)) ||
          (typeof t["text"] === "string" && (t["text"] as string)) ||
          (typeof t["full_text"] === "string" && (t["full_text"] as string)) ||
          (typeof t["content"] === "string" && (t["content"] as string)) ||
          "";
        return s.replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);

    if (texts.length === 0) {
      return NextResponse.json(
        { error: "No usable tweet text" },
        { status: 400 },
      );
    }

    const batches = chunk(texts, MAX_TWEETS_PER_BATCH).slice(0, MAX_BATCHES);
    const batchSummaries: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      const batchContents =
        (await buildPromptSafe("batch", {
          tweets: batch,
          index: i + 1,
          total: batches.length,
        })) ?? makeBatchPrompt(batch, i + 1, batches.length);

      const summary = await callGemini(batchContents, BATCH_OUTPUT_HINT_TOKENS);
      batchSummaries.push(
        summary?.trim() ||
          `Batch ${i + 1}: (no summary due to token constraints)`,
      );
    }

    const reduceContents =
      (await buildPromptSafe("reduce", { summaries: batchSummaries })) ??
      makeReducePrompt(batchSummaries);

    const finalText = await callGemini(
      reduceContents,
      FINAL_OUTPUT_HINT_TOKENS,
    );

    if (!finalText?.trim()) {
      return NextResponse.json({
        text: "",
        warning:
          "Gemini returned no text in the final synthesis. Try lowering MAX_TWEETS_PER_BATCH / MAX_BATCHES.",
      });
    }

    return NextResponse.json({ text: finalText });
  } catch (err) {
    const message = safeError(err);
    const status = /timeout/i.test(message) ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** ===================== Helpers ===================== */

function toNum(v: string | undefined, def: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function buildPromptSafe(
  phase: "batch" | "reduce",
  payload:
    | { tweets: string[]; index: number; total: number }
    | { summaries: string[] },
) {
  try {
    const contents =
      phase === "batch"
        ? await buildAnalyzeWithGeminiPrompt({
            phase: "batch",
            ...(payload as {
              tweets: string[];
              index: number;
              total: number;
            }),
          })
        : await buildAnalyzeWithGeminiPrompt({
            phase: "reduce",
            ...(payload as {
              summaries: string[];
            }),
          });

    if (Array.isArray(contents) && contents.length > 0) return contents;
    return null;
  } catch {
    return null;
  }
}

function makeBatchPrompt(tweets: string[], idx: number, total: number) {
  const joined = tweets.map((t) => `- ${t}`).join("\n");
  return [
    {
      role: "user",
      parts: [
        {
          text: `You are Polina, an AI analyst for crypto/community growth.

You will receive a batch of tweets (${idx}/${total}). Your task:
1) Extract key entities (project names, tokens, tags, KOLs).
2) Identify themes (sentiment, engagement drivers, concerns).
3) Summarize concrete signals (potential shillers, collab hints, campaign ideas).
4) Be concise and structured in markdown.

Tweets (batch ${idx}/${total}):
${joined}

Return a short markdown section with "### Findings (Batch ${idx})" and bullet points.`,
        },
      ],
    },
  ];
}

function makeReducePrompt(batchSummaries: string[]) {
  const joined = batchSummaries
    .map((s, i) => `### Batch ${i + 1}\n${s}`)
    .join("\n\n");
  return [
    {
      role: "user",
      parts: [
        {
          text: `You are Polina, an AI analyst for community growth.

Below are per-batch findings from multiple summarization calls. Synthesize them into ONE cohesive report:
- Merge duplicates, remove noise.
- Provide 5–8 crisp insights.
- Give 3–5 actionable campaign ideas (bullet list).
- If token/contract or X handles appear, include them once in a "References" section.
- Keep it under ~700 words.
- Use clean markdown with "### Insights", "### Campaign Ideas", "### References" sections.

Per-batch findings:
${joined}`,
        },
      ],
    },
  ];
}

async function callGemini(contents: any, maxOutputTokens: number) {
  const controller = new AbortController();
  const to = setTimeout(
    () => controller.abort(new Error("Gemini request timeout")),
    TIMEOUT_MS,
  );

  try {
    const resp = await fetch(`${ENDPOINT}?key=${API_KEY}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens,
        },
      }),
    });

    const json = await resp.json().catch(() => ({}) as any);
    if (!resp.ok) {
      const reason =
        json?.error?.message ||
        json?.error?.status ||
        json?.candidates?.[0]?.finishReason ||
        resp.statusText;
      throw new Error(`Gemini error: ${reason}`);
    }

    const text =
      json?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text)
        .join("") || "";
    return text;
  } finally {
    clearTimeout(to);
  }
}

function safeError(err: unknown) {
  try {
    return getErrorMessage(err);
  } catch {
    return (err as any)?.message || String(err);
  }
}
