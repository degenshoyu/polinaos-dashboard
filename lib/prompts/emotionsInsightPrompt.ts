// lib/prompts/emotionsInsightPrompt.ts
import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

export function buildEmotionsInsightPrompt(
  data: EmotionalLandscape,
  opts?: { projectName?: string; maxWords?: number },
) {
  const maxWords = Math.max(60, Math.min(200, opts?.maxWords ?? 160));
  const title = opts?.projectName
    ? `Project: ${opts.projectName}`
    : "Crypto topic";
  const compact = {
    totals: data.totals,
    buckets: data.buckets.map((b) => ({
      label: b.label,
      sharePct: b.sharePct,
      count: b.count,
      intensity: b.intensity,
      keywordsTop: b.keywordsTop.slice(0, 5),
    })),
    method: data.method.version,
  };

  return [
    "You are a concise crypto/Twitter sentiment strategist.",
    `Goal: Write a short **Emotional Landscape Insight** for ${title}.`,
    "",
    "INPUT JSON (distribution already computed; do not redo math):",
    JSON.stringify(compact),
    "",
    "Instructions:",
    `- Keep it under ${maxWords} words, in Markdown.`,
    "- Summarize where the spectrum leans (Bullish 🐂 / Bearish 🐻 / Optimistic / Neutral / Concerned).",
    "- Refer to **sharePct** and **intensity** qualitatively (e.g., 'dominant', 'moderate').",
    "- Mention 1–2 top keyword cues if helpful.",
    "- Give **2 concrete actions** to improve sentiment/engagement.",
    "- No tables, no code blocks, no emojis beyond those already shown.",
  ].join("\n");
}
