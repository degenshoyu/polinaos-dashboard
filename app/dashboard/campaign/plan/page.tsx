// app/dashboard/campaign/plan/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";

type PlanInput = {
  title: string;
  jobId?: string;
  objective: string;
  timeframeStart: string;
  timeframeEnd: string;
  budget?: string;
  audiences: string;          // comma separated
  pillars: string;            // comma separated (prefilled from AI Key Themes)
  kpis: string;               // comma separated (ER, views, retweets…)
  ctas: string;               // bullet lines
  notes?: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; id: string }
  | { kind: "error"; msg: string };

const STORAGE_KEY = "campaignPlanDraft";
const THEMES_KEY = "aiSummary";           // where your analysis page can stash Gemini’s markdown
const CAMPAIGN_DRAFT_KEY = "campaignDraft"; // your existing CampaignLeftPane storage

export default function CampaignPlanPage() {
  const params = useSearchParams();
  const idFromUrl = params.get("id") || undefined;
  const jobFromUrl = params.get("job_id") || undefined;

  const [plan, setPlan] = useState<PlanInput>({
    title: "",
    jobId: jobFromUrl,
    objective: "",
    timeframeStart: "",
    timeframeEnd: "",
    budget: "",
    audiences: "",
    pillars: "",
    kpis: "Engagement Rate (ER), Verified Views, Retweets, Quote-Tweets",
    ctas: "- Retweet drive\n- Quote-tweet thread\n- KOL outreach (5–10 targets)\n- Community Q&A space",
    notes: "",
  });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Prefill title from CampaignLeftPane draft (projectName)
  useEffect(() => {
    const raw = localStorage.getItem(CAMPAIGN_DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) || {};
        if (!plan.title && typeof d.projectName === "string" && d.projectName.trim()) {
          setPlan((p) => ({ ...p, title: `$${(d.projectName || "").replace(/^\$/, "")}` }));
        }
        if (!plan.jobId && typeof d.lastJobId === "string") {
          setPlan((p) => ({ ...p, jobId: d.lastJobId }));
        }
      } catch {}
    }
  }, []); // eslint-disable-line

  // Load existing draft (by id we could fetch later; for MVP we only hydrate local)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as PlanInput;
        setPlan((p) => ({ ...p, ...d, jobId: p.jobId || d.jobId || jobFromUrl }));
      } catch {}
    }
  }, [jobFromUrl]);

  // Prefill “pillars” from AI summary (Key Themes) once
  useEffect(() => {
    if (plan.pillars) return;
    const ai = localStorage.getItem(THEMES_KEY) || "";
    const pillars = extractKeyThemes(ai).slice(0, 8).join(", ");
    if (pillars) setPlan((p) => ({ ...p, pillars }));
  }, [plan.pillars]);

  // Autosave to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  }, [plan]);

  const markdown = useMemo(() => makePlanMarkdown(plan), [plan]);
  const deepLink = useMemo(() => {
    const u = new URL(window.location.href);
    if (save.kind === "saved" && save.id) {
      u.searchParams.set("id", save.id);
    }
    if (plan.jobId) u.searchParams.set("job_id", plan.jobId);
    u.pathname = "/dashboard/campaign/plan";
    return u.toString();
  }, [plan.jobId, save]);

  async function onSave() {
    setSave({ kind: "saving" });
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: plan.title || "Untitled Plan",
          job_id: plan.jobId || null,
          plan_json: plan,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.id) throw new Error(j?.error || "Failed to save plan");
      setSave({ kind: "saved", id: j.id });
    } catch (e: any) {
      setSave({ kind: "error", msg: e?.message || "Unknown error" });
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
  }

  const loading = save.kind === "saving";

  return (
    <div className="container py-6">
      <h1 className="text-2xl font-bold mb-4 bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Campaign · Plan
      </h1>

      {/* Save / status */}
      {save.kind === "error" && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          ❌ {save.msg}
        </div>
      )}
      {save.kind === "saved" && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          ✅ Plan saved. ID: <span className="font-mono">{save.id}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="grid grid-cols-1 gap-3">
            <Input
              label="Title (Ticker / Project)"
              placeholder="e.g. $USDUC Launch Week Plan"
              value={plan.title}
              onChange={(v) => setPlan({ ...plan, title: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Timeframe Start"
                placeholder="YYYY-MM-DD"
                value={plan.timeframeStart}
                onChange={(v) => setPlan({ ...plan, timeframeStart: v })}
              />
              <Input
                label="Timeframe End"
                placeholder="YYYY-MM-DD"
                value={plan.timeframeEnd}
                onChange={(v) => setPlan({ ...plan, timeframeEnd: v })}
              />
            </div>
            <Input
              label="Objective"
              placeholder="Drive verified visibility & ER; coordinate KOL push; sustain daily thread cadence"
              value={plan.objective}
              onChange={(v) => setPlan({ ...plan, objective: v })}
            />
            <Input
              label="Budget / Constraints (optional)"
              placeholder="e.g. $3k bounty pool; no paid KOLs; focus on organic traction"
              value={plan.budget || ""}
              onChange={(v) => setPlan({ ...plan, budget: v })}
            />
            <Input
              label="Target Audiences (comma separated)"
              placeholder="Crypto Twitter, NFT traders, DeFi builders, Solana memecoins"
              value={plan.audiences}
              onChange={(v) => setPlan({ ...plan, audiences: v })}
            />
            <Input
              label="Content Pillars (comma separated)"
              placeholder="AI agent utility, token mechanics, roadmap highlights, builder stories"
              value={plan.pillars}
              onChange={(v) => setPlan({ ...plan, pillars: v })}
            />
            <Input
              label="KPIs (comma separated)"
              placeholder="Engagement Rate (ER), Verified Views, Retweets, Quote-Tweets"
              value={plan.kpis}
              onChange={(v) => setPlan({ ...plan, kpis: v })}
            />
            <TextArea
              label="CTAs (one per line)"
              placeholder="- Retweet drive\n- Quote-tweet thread\n- KOL outreach (5–10 targets)\n- Community Q&A space"
              value={plan.ctas}
              onChange={(v) => setPlan({ ...plan, ctas: v })}
            />
            <TextArea
              label="Notes (optional)"
              placeholder="Risks, compliance, coordination details..."
              value={plan.notes || ""}
              onChange={(v) => setPlan({ ...plan, notes: v })}
            />
            <Input
              label="Job ID (optional)"
              placeholder="auto-filled if you came from Analysis"
              value={plan.jobId || ""}
              onChange={(v) => setPlan({ ...plan, jobId: v })}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={onSave}
              disabled={loading}
              className="px-4 py-2 rounded-md bg-gradient-to-r from-[#27a567] to-[#2fd480] text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save Plan"}
            </button>
            <button
              onClick={() => copy(markdown)}
              className="px-3 py-2 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-sm"
            >
              Copy Markdown
            </button>
            <button
              onClick={() => copy(deepLink)}
              className="px-3 py-2 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-sm"
            >
              Copy Link
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white/90">Preview</h2>
            <span className="text-xs text-gray-400">Markdown</span>
          </div>
          {markdown.trim() ? (
            <article className="prose prose-invert max-w-none">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </article>
          ) : (
            <div className="text-sm text-gray-500">Start filling the form to preview your plan…</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Helpers & UI ---------------- */
function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-gray-300">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <div className="mb-1 text-gray-300">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={5}
        className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
      />
    </label>
  );
}

function extractKeyThemes(md: string): string[] {
  // Pull bullets under "### Key Themes"
  const m = md.match(/###\s*Key\s*Themes[\s\S]*?(?=###|$)/i);
  const block = m?.[0] || "";
  const items = Array.from(block.matchAll(/[-*]\s+(.+?)(?=\n|$)/g)).map((x) => x[1].trim());
  return Array.from(new Set(items)).filter(Boolean);
}

function makePlanMarkdown(p: PlanInput) {
  const aud = listFromCsv(p.audiences);
  const pil = listFromCsv(p.pillars);
  const kpi = listFromCsv(p.kpis);
  const ctas = p.ctas
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return `
# ${p.title || "Untitled Campaign Plan"}

**Objective**  
${p.objective || "-"}

**Timeframe**  
${p.timeframeStart || "TBD"} → ${p.timeframeEnd || "TBD"}${p.jobId ? `  ·  (job_id: ${p.jobId})` : ""}

**Budget / Constraints**  
${p.budget || "-"}

## Target Audiences
${bullets(aud)}

## Content Pillars
${bullets(pil)}

## KPIs
${bullets(kpi)}

## Calls to Action
${bullets(ctas)}

## Notes
${p.notes || "-"}
`.trim();
}

function listFromCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function bullets(arr: string[]) {
  if (!arr.length) return "-";
  return arr.map((x) => `- ${x}`).join("\n");
}

