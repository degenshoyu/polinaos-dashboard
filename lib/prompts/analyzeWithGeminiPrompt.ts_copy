// lib/prompts/analyzeWithGeminiPrompt.ts
/**
 * Unified Gemini Prompt Generator for Token Tweet Analysis
 * Supports three phases: "single", "batch", "reduce".
 *
 * Return shape is compatible with Google Gemini `generateContent`:
 *   [{ role: 'user', parts: [{ text: '...' }] }]
 */

// ---------- Types ----------
export type SingleParams = {
  phase: "single";
  /** Pre-joined tweet lines string, e.g. "- tweet1\n- tweet2" */
  tweetLines: string;
};

export type BatchParams = {
  phase: "batch";
  tweets: string[];
  /** 1-based index of the batch */
  index: number;
  /** total number of batches */
  total: number;
};

export type ReduceParams = {
  phase: "reduce";
  /** Text summaries per batch */
  summaries: string[];
};

export type AnalyzeWithGeminiParams = SingleParams | BatchParams | ReduceParams;

// ---------- Builder ----------
export async function buildAnalyzeWithGeminiPrompt(
  params: AnalyzeWithGeminiParams,
): Promise<Array<{ role: "user"; parts: Array<{ text: string }> }>> {
  // ----- SINGLE PHASE -----
  if (params.phase === "single") {
    const { tweetLines } = params;
    const text = `You are an AI assistant helping a crypto project researcher understand how a specific token is being discussed on Twitter.

Important Instructions:
- Focus **only on the project that is mentioned repeatedly or directly**, based on the submitted keywords (e.g., the project name like "Moodeng" or a specific token address).
- Do **not** include or speculate about other unrelated tokens.
- If multiple tokens are mentioned, include them **only when they are directly connected** to the main project.
- Ignore misleading/irrelevant mentions like meme coins that aren't core to the project.

💡 Formatting Instructions:
Use **Markdown headings**. Each section must start with a third-level heading (\`\`\`### Section Title\`\`\`). Do **not** include any general summary at the top.

### Example Format:

### Project Overview
...

### Community Activity
...

### Content Quality
...

### Virality Potential
...

### Scores
- Community Involvement: 8
- Content Clarity: 7
- Virality Potential: 9

### Key Themes
- Meme culture
- Pump.fun mentions
- Anniversary campaigns

📊 Now please analyze the following tweets and respond in the above format:

Tweets to analyze:
${tweetLines}`;

    return [{ role: "user", parts: [{ text }] }];
  }

  // ----- BATCH PHASE -----
  if (params.phase === "batch") {
    const { tweets, index, total } = params;
    const joined = tweets.map((t) => `- ${t}`).join("\n");

    const text = `You are Polina, an AI analyst focused on crypto/community growth.

You will receive a batch of tweets (${index}/${total}). Please:
- Extract key entities (project names, tokens, tags, KOLs).
- Identify themes (sentiment, engagement drivers, concerns).
- Surface actionable signals (potential shillers, collab hints, campaign ideas).
- Be concise and structured in markdown.

Tweets (batch ${index}/${total}):
${joined}

Return a short markdown section with the following structure:

### Findings (Batch ${index})
- Point 1
- Point 2
- Point 3`;

    return [{ role: "user", parts: [{ text }] }];
  }

  // ----- REDUCE PHASE -----
  if (params.phase === "reduce") {
    const { summaries } = params;
    const joined = summaries
      .map((s, i) => `### Batch ${i + 1}\n${s}`)
      .join("\n\n");

    const text = `You are Polina, an AI analyst.

Below are per-batch findings that came from multiple summarization calls. Synthesize them into ONE cohesive report:
- Merge duplicates, remove noise.
- Provide **5–8 crisp insights**.
- Give **3–5 actionable campaign ideas** (bullet list).
- If token/contract addresses or X handles appear, include them once in a "### References" section.
- Keep the total under ~700 words.
- Use clean markdown with sections: "### Insights", "### Campaign Ideas", "### References".

Per-batch findings:
${joined}`;

    return [{ role: "user", parts: [{ text }] }];
  }

  // Should be unreachable due to union type, but keeps TS happy if type assertion is bypassed.
  throw new Error("Invalid phase for buildAnalyzeWithGeminiPrompt");
}

// Optional alias for convenience
export const buildGeminiPrompt = buildAnalyzeWithGeminiPrompt;

export default buildAnalyzeWithGeminiPrompt;
