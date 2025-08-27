// lib/prompts/analyzeWithGeminiPrompt.ts

import type { EmotionalLandscape } from "@/lib/analysis/emotionalLandscape";

export type TweetLite = { textContent: string };

export function buildAnalyzePrompt(
  tweets: TweetLite[],
  opts?: { projectName?: string; maxWords?: number },
) {
  const maxWords = opts?.maxWords ?? 320;
  const project = opts?.projectName ? `Project: ${opts.projectName}\n` : "";

  const list = tweets.map((t) => `- ${t.textContent}`).join("\n");

  return `You are a social media analyst. Summarize this batch of tweets into a concise, well-structured markdown.

${project}Tweets:
${list}

# Output requirements
- Use these sections: "### Project Overview", "### Key Themes", "### Scores", "### Campaign Ideas".
- "### Scores" must include: Community Involvement, Content Clarity, Virality Potential (0-10).
- Keep within ~${maxWords} words.
- Avoid redundancy. Extract insights, not raw quotes.`;
}

export function buildSynthesisPrompt(
  batchSummaries: string[],
  opts?: { projectName?: string; maxWords?: number },
) {
  const maxWords = opts?.maxWords ?? 450;
  const project = opts?.projectName ? `Project: ${opts.projectName}\n` : "";
  const bullets = batchSummaries
    .map((s, i) => `- [Batch ${i + 1}] ${s}`)
    .join("\n");

  return `You are an expert editor. Combine the following batch summaries into ONE cohesive report.

${project}Batch Summaries:
${bullets}

# Output requirements
- Merge overlapping insights; remove duplication/contradictions.
- Output sections: "### Project Overview", "### Key Themes", "### Scores", "### Campaign Ideas".
- "### Scores" must include: Community Involvement, Content Clarity, Virality Potential (0-10).
- Keep within ~${maxWords} words. Ensure clear, self-contained markdown.`;
}

export function buildTaskPrompt(
  finalMarkdown: string,
  opts?: { mode?: "weekly" | "launch"; maxItems?: number },
) {
  const maxItems = Math.max(3, Math.min(10, opts?.maxItems ?? 6));
  const mode = opts?.mode ?? "weekly";
  return `You are a community growth strategist.
Based on the analysis below, output ${maxItems} concrete ${mode} tasks for the project's Twitter community.

# Analysis
${finalMarkdown}

# Output requirements
- Markdown list with brief rationale per item.
- Each item should include: goal, example tweet angle, simple measurement KPI.
- Avoid generic advice; be specific and realistic.`;
}

export function buildEmotionsInsightPrompt(
  landscape: EmotionalLandscape,
  opts?: { projectName?: string; maxWords?: number },
): string {
  const maxWords = Math.max(60, Math.min(400, opts?.maxWords ?? 160));
  const name = (opts?.projectName || "").trim() || "the asset";

  const compact = {
    method: {
      version: landscape.method?.version,
      weightFormula: landscape.method?.weightFormula,
    },
    totals: {
      tweets: landscape.totals?.tweets,
      views: landscape.totals?.views,
      engagements: landscape.totals?.engagements,
    },
    buckets: landscape.buckets.map((b) => ({
      label: b.label,
      sharePct: b.sharePct,
      count: b.count,
      intensity: b.intensity,
      keywordsTop: (b.keywordsTop || []).slice(0, 6).map((k) => k.term),
      topExamples: (b.topTweets || []).slice(0, 2).map((t) => ({
        likes: t.likes,
        retweets: t.retweets,
        replies: t.replies,
        views: t.views,
      })),
    })),
  };

  const dataJson = JSON.stringify(compact, null, 2);

  return [
    `You are a crypto social sentiment analyst.`,
    `Using ONLY the aggregated data below (do not fabricate extra numbers), write a concise **Emotional Insight** for ${name}.`,
    ``,
    `Constraints:`,
    `- Keep it under ~${maxWords} words.`,
    `- Start with a single bold takeaway sentence.`,
    `- Then add 1–3 bullet points describing:`,
    `  • distribution across buckets (e.g., bullish/neutral/concerned %),`,
    `  • where intensity/engagement concentrates (use views/likes/retweets/replies only as signals),`,
    `  • 1 actionable suggestion (what to do next).`,
    `- No headings other than the bold first sentence. Use plain Markdown.`,
    `- If a bucket share is tiny, you can omit it.`,
    `- Do NOT create any numbers that are not inferable from the data.`,
    ``,
    `DATA (aggregated emotional landscape):`,
    "```json",
    dataJson,
    "```",
    ``,
    `Output format example (structure only):`,
    `**One-sentence bold takeaway**`,
    `- Key observation about distribution and intensity.`,
    `- Where engagement concentrates & what that implies.`,
    `- Action: one practical next step.`,
  ].join("\n");
}
