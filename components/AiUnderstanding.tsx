"use client";

import Image from "next/image";
import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import polinaIcon from "@/public/polina-icon.png";

/** Dedicated renderer for the AI Understanding card */
export const AiUnderstanding: React.FC<{
  aiSummary?: string | null;
}> = ({ aiSummary }) => {
  const normalizedSummary = useMemo(
    () => normalizeGeminiMarkdown(aiSummary || ""),
    [aiSummary]
  );
  const sections = useMemo(() => splitSections(normalizedSummary), [normalizedSummary]);

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
    <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5">
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
          AI Understanding
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
                    {isScores && scores && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3">
                        {scores.map((s) => (
                          <ScoreBadge key={s.label} label={s.label} value={s.value} />
                        ))}
                      </div>
                    )}

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
  );
};

/* ===== Markdown components ===== */
const mdxComponents = {
  p: (props: any) => <p className="text-sm text-gray-300 leading-relaxed mb-2" {...props} />,
  ul: (props: any) => <ul className="list-disc list-inside text-sm text-gray-300 pl-4 my-2" {...props} />,
  ol: (props: any) => <ol className="list-decimal list-inside text-sm text-gray-300 pl-4 my-2" {...props} />,
  li: (props: any) => <li className="mb-1" {...props} />,
  strong: (props: any) => <strong className="text-white font-semibold" {...props} />,
  h4: (props: any) => <h4 className="text-white/90 text-sm font-bold mt-3 mb-1" {...props} />,
  code: (props: any) => <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px] text-white/90" {...props} />,
  a: (props: any) => (
    <a className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2" {...props} />
  ),
};

/* ===== Normalization & parsing helpers ===== */
function normalizeGeminiMarkdown(text: string): string {
  if (!text) return "";
  let out = text.trim();

  out = out.replace(/(^|\n)\s*#{1,6}\s*insights\s*$/i, "$1### Project Overview");

  if (!/(^|\n)###\s+/i.test(out)) {
    out = `### Project Overview\n${out}`;
  }

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
  return out.filter((s) => s.title.toLowerCase() !== "gemini analysis");
}

function parseScores(markdown: string): { label: string; value: number }[] | null {
  const rows = Array.from(
    markdown.matchAll(/[-*]\s*(Community Involvement|Content Clarity|Virality Potential)\s*:\s*([0-9]+)/gi)
  );
  if (!rows.length) return null;
  return rows.map((m) => ({ label: titleCase(m[1]), value: Number(m[2]) }));
}

function extractBullets(markdown: string): string[] {
  const rows = Array.from(markdown.matchAll(/(?:^|\n)[-*]\s+(.+?)(?=\n|$)/g)).map((m) => m[1].trim());
  return Array.from(new Set(rows)).filter(Boolean);
}

function extractLinks(markdown: string): string[] {
  const rxUrl = /\bhttps?:\/\/[^\s)]+/gi;
  const arr = markdown.match(rxUrl) || [];
  return Array.from(new Set(arr));
}

function stripBullets(md: string): string {
  return md.replace(/(?:^|\n)[-*]\s+.+(?=\n|$)/g, "").trim();
}

function stripUrls(md: string): string {
  return md.replace(/\bhttps?:\/\/[^\s)]+/gi, "").replace(/\(\s*\)/g, "").trim();
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/* ===== UI bits ===== */
function ScoreBadge({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(10, value)) * 10;
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
