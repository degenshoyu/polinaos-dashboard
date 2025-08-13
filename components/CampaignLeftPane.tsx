// components/CampaignLeftPane.tsx
"use client";

import Image from "next/image";
import polinaIcon from "@/public/polina-icon.png";
import ReactMarkdown from "react-markdown";
import { useEffect, useMemo, useState } from "react";
import type { AnalysisInput } from "./types";

/** 小工具：把字符串确保为非空 */
const ensureString = (v: unknown): string | undefined => {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : undefined;
  }
  return undefined;
};
/** 接受 @handle 或 https://x.com/handle -> 返回纯 handle */
const handleFromUrlOrAt = (s?: string): string | undefined => {
  if (!s) return undefined;
  const raw = s.trim();
  if (!raw) return undefined;
  if (!raw.includes("://")) return raw.replace(/^@/, "");
  try {
    const u = new URL(raw);
    const seg = u.pathname.split("/").filter(Boolean)[0] || "";
    return seg.replace(/^@/, "") || raw.replace(/^@/, "");
  } catch {
    return raw.replace(/^@/, "");
  }
};
const parseSafe = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export default function CampaignLeftPane({
  onRun,
  aiSummary,
  className = "",
}: {
  onRun: (input: AnalysisInput) => void;
  aiSummary?: string | null;
  className?: string;
}) {
  /* ========== Campaign · Input ========== */
  const [form, setForm] = useState<AnalysisInput>({
    projectName: "",
    website: "",
    xProfile: "",
    xCommunity: "",
    telegram: "",
    tokenAddress: "",
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const qp: AnalysisInput = {
      projectName: ensureString(url.searchParams.get("projectName")),
      website: ensureString(url.searchParams.get("website")),
      xProfile: handleFromUrlOrAt(ensureString(url.searchParams.get("xProfile"))),
      xCommunity: ensureString(url.searchParams.get("xCommunity")),
      telegram: ensureString(url.searchParams.get("telegram")),
      tokenAddress: ensureString(url.searchParams.get("tokenAddress")),
    } as any;

    const stored = (parseSafe("campaignDraft") ?? {}) as Partial<AnalysisInput>;
    const merged: AnalysisInput = {
      projectName: qp.projectName ?? ensureString(stored.projectName),
      website: qp.website ?? ensureString(stored.website),
      xProfile: qp.xProfile ?? handleFromUrlOrAt(ensureString(stored.xProfile)),
      xCommunity: qp.xCommunity ?? ensureString(stored.xCommunity),
      telegram: qp.telegram ?? ensureString(stored.telegram),
      tokenAddress: qp.tokenAddress ?? ensureString(stored.tokenAddress),
    } as any;

    setForm((f) => ({ ...f, ...merged }));
  }, []);

  useEffect(() => {
    localStorage.setItem("campaignDraft", JSON.stringify(form));
  }, [form]);

  const canAnalyze = useMemo(() => {
    return Boolean(
      (form.projectName && form.projectName.trim()) ||
        (form.xProfile && form.xProfile.trim()) ||
        (form.tokenAddress && form.tokenAddress.trim())
    );
  }, [form]);

  /* ========== AI Understanding：规范化 → 切分 → 美化渲染 ========== */
  const normalizedSummary = useMemo(
    () => normalizeGeminiMarkdown(aiSummary || ""),
    [aiSummary]
  );
  const sections = useMemo(
    () => splitSections(normalizedSummary),
    [normalizedSummary]
  );

  // 支持多节同时展开 & 一键展开/收起
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const toggleIdx = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const expandAll = () => setExpanded(new Set(sections.map((_, i) => i)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <div className={`flex flex-col gap-6 w-full ${className}`}>
      {/* === Card 1: Campaign · Input === */}
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
          Campaign · Input
        </h2>

        <div className="space-y-3">
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="Project name (e.g. Moodeng)"
            value={form.projectName || ""}
            onChange={(e) => setForm({ ...form, projectName: e.target.value })}
          />
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="Website (optional)"
            value={form.website || ""}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="X / Twitter profile (e.g. @project or https://x.com/project)"
            value={form.xProfile || ""}
            onChange={(e) =>
              setForm({ ...form, xProfile: handleFromUrlOrAt(e.target.value) || "" })
            }
          />
          <input
            className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
            placeholder="Token contract address (optional)"
            value={form.tokenAddress || ""}
            onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })}
          />
        </div>

        <button
          onClick={() => onRun(form)}
          disabled={!canAnalyze}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#27a567] to-[#2fd480] hover:from-[#239e5d] hover:to-[#38ec9c] text-white rounded-md text-sm font-semibold transition shadow disabled:opacity-50"
        >
          {canAnalyze ? "✨ Analyze" : "Fill one of: Project / X / Token"}
        </button>

        <div className="mt-3 text-xs text-gray-500">
          Tip: You can also pass fields via URL, e.g. <code>?xProfile=@project&tokenAddress=...</code>
        </div>
      </div>

      {/* === Card 2: Polina · AI Understanding === */}
      <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
            Polina · AI Understanding
          </h2>

          {!!sections.length && (
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs px-2 py-1 rounded-md border border-white/10 text-gray-300 hover:text-white hover:border-white/20"
                title="Expand all"
              >
                Expand all
              </button>
              <button
                onClick={collapseAll}
                className="text-xs px-2 py-1 rounded-md border border-white/10 text-gray-300 hover:text-white hover:border-white/20"
                title="Collapse all"
              >
                Collapse all
              </button>
            </div>
          )}
        </div>

        {!aiSummary ? (
          <div className="text-sm text-gray-500">
            Waiting for AI analysis… it appears here once tweets are collected.
          </div>
        ) : sections.length === 0 ? (
          <div className="bg-[#111515] rounded-lg p-4 border border-white/10 prose prose-invert max-w-none">
            <ReactMarkdown components={mdxComponents}>{normalizedSummary}</ReactMarkdown>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 mb-4">
              <Image src={polinaIcon} alt="Polina" width={28} height={28} className="rounded-full" />
              <div>
                <div className="text-xs text-gray-400 mb-1">Polina · AI Agent</div>
                <p className="leading-snug text-gray-300">
                  Here is what I discovered about your project, based on the tweets collected:
                </p>
              </div>
            </div>

            {sections.map((sec, idx) => {
              const isOpen = expanded.has(idx);
              const isScores = /^scores$/i.test(sec.title);
              const isThemes = /^key\s*themes?$/i.test(sec.title);
              const isRefs = /^references?$/i.test(sec.title);
              const isIdeas = /^campaign\s*ideas?$/i.test(sec.title);

              const scores = isScores ? parseScores(sec.content) : null;
              const themeItems = isThemes ? extractBullets(sec.content) : null;
              const refs = isRefs ? extractLinks(sec.content) : null;
              const ideas = isIdeas ? extractBullets(sec.content) : null;

              const hasSpecial = Boolean(
                (isScores && scores && scores.length) ||
                  (isThemes && themeItems && themeItems.length) ||
                  (isRefs && refs && refs.length) ||
                  (isIdeas && ideas && ideas.length)
              );

              // 供默认 Markdown 使用的清理文本（避免与特殊渲染重复）
              const contentForDefault = (() => {
                let c = sec.content;
                if (isRefs) c = stripUrls(c);
                if (isIdeas) c = stripBullets(c);
                return c;
              })();

              return (
                <div key={idx} className="bg-[#111515] rounded-lg border border-white/10 mb-3 overflow-hidden">
                  <button
                    className="w-full p-4 flex items-center justify-between text-left text-sm font-semibold text-white hover:bg-white/5 transition"
                    onClick={() => toggleIdx(idx)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
                      {sec.title}
                    </span>
                    <span className={`inline-block transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}>
                      ▾
                    </span>
                  </button>

                  {isOpen && (
                    <div className="p-4 pt-0">
                      {/* Scores -> 徽章 */}
                      {isScores && scores && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3">
                          {scores.map((s) => (
                            <ScoreBadge key={s.label} label={s.label} value={s.value} />
                          ))}
                        </div>
                      )}

                      {/* Key Themes -> 标签 */}
                      {isThemes && themeItems && themeItems.length > 0 && (
                        <div className="flex flex-wrap gap-2 my-2">
                          {themeItems.map((t, i) => (
                            <span
                              key={`${t}-${i}`}
                              className="px-2.5 py-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 text-xs"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* References -> 链接列表 + 去链接后的正文 */}
                      {isRefs && refs && refs.length > 0 && (
                        <>
                          <ul className="list-none my-3 space-y-2">
                            {refs.map((r, i) => (
                              <li key={i} className="text-sm">
                                <a
                                  className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2 break-all"
                                  href={r}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {r}
                                </a>
                              </li>
                            ))}
                          </ul>
                          {stripUrls(sec.content).trim() && (
                            <div className="text-sm text-gray-300">
                              <ReactMarkdown components={mdxComponents}>{stripUrls(sec.content)}</ReactMarkdown>
                            </div>
                          )}
                        </>
                      )}

                      {/* Campaign Ideas -> 卡片 */}
                      {isIdeas && ideas && ideas.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 my-3">
                          {ideas.map((idea, i) => (
                            <div
                              key={i}
                              className="rounded-xl border border-white/10 p-3 bg-black/10 hover:bg-black/20 transition"
                            >
                              <div className="text-xs text-gray-400 mb-1">Idea #{i + 1}</div>
                              <div className="text-sm text-gray-200 leading-relaxed">{idea}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 默认 Markdown —— 只有未做任何特殊渲染时才渲染，避免重复 */}
                      {!hasSpecial && (
                        <div className="text-sm text-gray-300">
                          <ReactMarkdown components={mdxComponents}>{contentForDefault}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/* =================== Markdown 渲染定制 =================== */
const mdxComponents = {
  p: (props: any) => <p className="text-sm text-gray-300 leading-relaxed mb-2" {...props} />,
  ul: (props: any) => <ul className="list-disc list-inside text-sm text-gray-300 pl-4 my-2" {...props} />,
  ol: (props: any) => <ol className="list-decimal list-inside text-sm text-gray-300 pl-4 my-2" {...props} />,
  li: (props: any) => <li className="mb-1" {...props} />,
  strong: (props: any) => <strong className="text-white font-semibold" {...props} />,
  h4: (props: any) => <h4 className="text-white/90 text-sm font-bold mt-3 mb-1" {...props} />,
  code: (props: any) => (
    <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px] text-white/90" {...props} />
  ),
  a: (props: any) => (
    <a className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2" {...props} />
  ),
};

/* =================== 解析 & 规范化 =================== */
/**
 * 规范化 Gemini 输出：
 * - 没有任何 ### 则包进 "Project Overview"
 * - 把 “Insights” 顶级标题替换为 "Project Overview"
 * - 收集 “- Community Involvement: 8/10” 等到 ### Scores
 * - 缺 Key Themes 则用前几个 bullet 自动兜底
 */
function normalizeGeminiMarkdown(text: string): string {
  if (!text) return "";
  let out = text.trim();

  // Insights -> Project Overview
  out = out.replace(/(^|\n)\s*#{1,6}\s*insights\s*$/i, "$1### Project Overview");

  // 没有任何 ### 标题时，包一层
  if (!/(^|\n)###\s+/i.test(out)) {
    out = `### Project Overview\n${out}`;
  }

  // 收集分数
  const scoreLines: string[] = [];
  out = out.replace(
    /(?:^|\n)\s*[-*]\s*(Community Involvement|Content Clarity|Virality Potential)\s*:\s*([0-9]+(?:\s*\/\s*10)?)/gi,
    (_: string, k: string, v: string) => {
      scoreLines.push(`- ${k}: ${v.replace(/\s+/g, "")}`);
      return "";
    }
  );
  if (scoreLines.length && !/(^|\n)###\s+Scores/i.test(out)) {
    out += `\n\n### Scores\n${scoreLines.join("\n")}\n`;
  }

  out = out.replace(/(^|\n)###\s+References[\s\S]*?(?=(^|\n)###\s+|$)/gi, "");

  // Key Themes 兜底
  if (!/(^|\n)###\s+Key Themes/i.test(out)) {
    const outNoIdeas = out.replace(/(^|\n)###\s+Campaign Ideas?[\s\S]*?(?=(^|\n)###\s+|$)/gi, "");
    const bullets = extractBullets(outNoIdeas).slice(0, 6);
    if (bullets.length) out += `

  ### Key Themes
  ${bullets.map((b) => `- ${b}`).join("\n")}
  `;
  }

  return out.trim();
}

/** 以 ### 作为小节分隔 */
function splitSections(text: string): { title: string; content: string }[] {
  if (!text?.trim()) return [];
  const sectionRegex = /###\s+(.*?)\r?\n/gi;
  const out: { title: string; content: string }[] = [];
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = sectionRegex.exec(text)) !== null) {
    if (out.length > 0) out[out.length - 1].content = text.slice(lastIndex, match.index).trim();
    out.push({ title: match[1].trim(), content: "" });
    lastIndex = match.index + match[0].length;
  }
  if (out.length > 0) out[out.length - 1].content = text.slice(lastIndex).trim();

  const hasReal = out.some((s) => s.content && s.content.trim().length > 0);
  if (!hasReal) return [];
  // 过滤“Gemini Analysis”之类无意义标题
  return out.filter((s) => s.title.toLowerCase() !== "gemini analysis");
}

/** 解析 ### Scores */
function parseScores(markdown: string): { label: string; value: number }[] | null {
  const rows = Array.from(
    markdown.matchAll(/[-*]\s*(Community Involvement|Content Clarity|Virality Potential)\s*:\s*([0-9]+)/gi)
  );
  if (!rows.length) return null;
  return rows.map((m) => ({ label: titleCase(m[1]), value: Number(m[2]) }));
}

/** 抽取 bullet 文本（用于 Themes & Ideas） */
function extractBullets(markdown: string): string[] {
  const rows = Array.from(markdown.matchAll(/(?:^|\n)[-*]\s+(.+?)(?=\n|$)/g)).map((m) => m[1].trim());
  return Array.from(new Set(rows)).filter(Boolean);
}

/** 抽取链接（用于 References） */
function extractLinks(markdown: string): string[] {
  const rxUrl = /\bhttps?:\/\/[^\s)]+/gi;
  const arr = markdown.match(rxUrl) || [];
  return Array.from(new Set(arr));
}

/** 去掉最外层 bullets，避免与 Ideas 卡片重复 */
function stripBullets(md: string): string {
  return md.replace(/(?:^|\n)[-*]\s+.+(?=\n|$)/g, "").trim();
}

/** 去掉裸露 URL，避免与 References 重复 */
function stripUrls(md: string): string {
  return md.replace(/\bhttps?:\/\/[^\s)]+/gi, "").replace(/\(\s*\)/g, "").trim();
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/* =================== UI 部件 =================== */
function ScoreBadge({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(10, value)) * 10; // 0..100
  return (
    <div className="rounded-xl border border-white/10 p-3 bg-black/20">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-[#27a567] to-[#2fd480]" style={{ width: `${pct}%` }} />
        </div>
        <div className="w-10 text-right text-xs text-white/80">{value}/10</div>
      </div>
    </div>
  );
}
