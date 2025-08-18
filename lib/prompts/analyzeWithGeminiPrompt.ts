// lib/prompts/analyzeWithGeminiPrompt.ts
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
