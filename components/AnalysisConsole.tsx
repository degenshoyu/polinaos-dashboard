// components/AnalysisConsole.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import polinaIcon from "@/public/polina-icon.png";
import type { AnalysisInput } from "./types";

export default function AnalysisConsole({
  inputs,
  onTweetCountUpdate,
  onAnalysisResult,
  onJobIdChange,
  className = "",
}: {
  inputs?: AnalysisInput | null;
  onTweetCountUpdate?: (n: number) => void;
  onAnalysisResult?: (res: { summary: string }) => void;
  onJobIdChange?: (id: string | null) => void;
  className?: string;
}) {
  // UI + status states
  const [status, setStatus] = useState<"idle" | "scanning" | "complete" | "error">("idle");
  const [messages, setMessages] = useState<{ text: string; time?: string }[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tweetCount, setTweetCount] = useState<number>(0);

  // Collapsible card state (persisted)
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Refs for effects and timers
  const containerRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genMsgIndexRef = useRef<number | null>(null);

  // One-shot gates & live status mirrors
  const jobStartedRef = useRef<string | null>(null);
  const analysisStartedRef = useRef(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Restore collapsed preference on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("analysisConsoleCollapsed");
      if (raw != null) setCollapsed(JSON.parse(raw) === true);
    } catch {/* ignore */}
  }, []);

  // Persist collapsed preference when it changes
  useEffect(() => {
    try {
      localStorage.setItem("analysisConsoleCollapsed", JSON.stringify(collapsed));
    } catch {/* ignore */}
  }, [collapsed]);

  // Auto scroll to latest message
  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Welcome text on idle
  useEffect(() => {
    if (status === "idle" && messages.length === 0) {
      append(
        `👋 Hi, I’m Polina – your assistant for understanding how your project is performing on Twitter.

I'll guide you through the whole process:
1. Fetch the most recent tweets that mention your project.
2. Use my AI power to summarize the content, tone and trends.
3. Generate tailored community tasks and track engagement.

✨ Most features are still under development. Want full access? Join the waitlist!`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Trigger a new scan when inputs change (projectName/xProfile/tokenAddress)
  useEffect(() => {
    if (!inputs) return;
    runScan(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs?.projectName, inputs?.xProfile, inputs?.tokenAddress]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  // Utilities
  function timeStr() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function append(text: string) {
    // Deduplicate adjacent identical lines
    setMessages((prev) => {
      const last = prev[prev.length - 1]?.text;
      if (last === text) return prev;
      return [...prev, { text, time: timeStr() }];
    });
  }

  function replaceAt(index: number, text: string) {
    setMessages((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], text };
      return next;
    });
  }

  // Make raw backend logs more user friendly
  const toFriendly = (line: string) => {
    if (line.includes("Scanning for keywords"))
      return "I’m looking through Twitter for mentions like: " + line.split(":")[1]?.trim();
    if (line.includes("Job started")) return "Okay! I’ve kicked off the scan. Give me a moment...";
    if (line.includes("Scanning in progress")) return line.replace("⏳", "⌛") + " Almost there!";
    if (line.includes("Completed"))
      return "All done! I found " + (line.match(/\d+/)?.[0] ?? "?") + " relevant tweets for you 💫";
    return line;
  };

  // Launch a scan flow
  async function runScan(input: AnalysisInput) {
    if (pollTimer.current) clearInterval(pollTimer.current);

    setStatus("scanning");
    setMessages([]); // clear welcome
    setJobId(null);
    onJobIdChange?.(null);
    setTweetCount(0);
    jobStartedRef.current = null;
    analysisStartedRef.current = false;

    append("🔍 Starting analysis of your project…");

    try {
      const res = await fetch("/api/ctsearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: input.projectName || "",
          twitterHandle: input.xProfile || "",
          contractAddress: input.tokenAddress || "",
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const raw of lines) {
          const line = raw;

          // Ignore submission hint
          if (line.includes("Job submitted")) continue;

          // Drop "Scanning in progress" when not scanning or after analysis started
          if (
            line.includes("Scanning in progress") &&
            (statusRef.current !== "scanning" || analysisStartedRef.current)
          ) {
            continue;
          }

          // "Completed" is handled by poller to avoid duplicates
          if (line.includes("Completed")) continue;

          // Friendly display
          append(toFriendly(line));

          // Only record the first "Job started"
          const m = line.match(/Job started:\s*(.+)/i);
          if (m) {
            const id = m[1].trim();
            if (!jobStartedRef.current) {
              jobStartedRef.current = id;
              setJobId(id);
              onJobIdChange?.(id);
              startPolling(id);
            }
          }
        }
      }
    } catch (e: any) {
      setStatus("error");
      append("❌ Scan failed to start. " + (e?.message || "Unknown error"));
    }
  }

  // Poll job status and then trigger AI analysis
  function startPolling(id: string) {
    if (pollTimer.current) clearInterval(pollTimer.current);

    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobProxy?job_id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await r.json();

        // Completed first, to avoid writing progress after done
        if (data?.status === "completed") {
          if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
          if (analysisStartedRef.current) return;
          analysisStartedRef.current = true;

          setStatus("complete");
          append(toFriendly(`✅ Completed: ${data?.tweets_count || 0} tweets found.`));

          // Placeholder while AI generates
          setMessages((prev) => {
            genMsgIndexRef.current = prev.length;
            return [
              ...prev,
              {
                text: "🧠 Let me analyze the content and extract key insights for you...",
                time: timeStr(),
              },
            ];
          });

          try {
            // Sanitize tweets for AI (text-only)
            const rawTweets = Array.isArray(data?.tweets) ? data.tweets : [];
            const safeTweets = rawTweets
              .map((t: any) => {
                const textContent =
                  (typeof t?.textContent === "string" && t.textContent) ||
                  (typeof t?.text === "string" && t.text) ||
                  (typeof t?.full_text === "string" && t.full_text) ||
                  (typeof t?.content === "string" && t.content) ||
                  "";
                return textContent ? { textContent } : null;
              })
              .filter(Boolean);

            if (safeTweets.length === 0) {
              replaceGenerating("❌ No parsable tweets for AI (missing text).");
              return;
            }

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 150_000);
            const aiRes = await fetch("/api/analyzeWithGemini", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tweets: safeTweets, jobId }),
              signal: controller.signal,
            }).catch((e) => {
              throw new Error(
                e?.name === "AbortError" ? "AI request timeout (150s)" : e?.message || "Network error"
              );
            });
            clearTimeout(timeout);

            const json = await aiRes.json().catch(() => ({}));
            const text: string = json?.text || json?.error || "";
            if (!aiRes.ok) {
              replaceGenerating(`❌ Gemini error: ${text || aiRes.statusText}`);
              return;
            }

            onAnalysisResult?.({ summary: text });
            replaceGenerating("📊 I’ve completed the analysis. Please check the full summary on the AI Understanding card.");
          } catch (e: any) {
            replaceGenerating(`❌ Gemini request failed: ${e?.message || "Unknown error"}`);
          }

          return;
        }

        // Progress while scanning (not yet analyzing)
        if (statusRef.current === "scanning" && !analysisStartedRef.current && typeof data?.tweets_count === "number") {
          setTweetCount(data.tweets_count);
          onTweetCountUpdate?.(data.tweets_count);

          setMessages((prev) => {
            const msg = `⏳ Scanning in progress... ${data.tweets_count} tweets collected.`;
            const friendly = toFriendly(msg);
            const last = prev[prev.length - 1]?.text || "";
            if (last.startsWith("⌛ Scanning in progress")) {
              const copy = prev.slice(0, -1);
              return [...copy, { text: friendly, time: timeStr() }];
            }
            return [...prev, { text: friendly, time: timeStr() }];
          });
        }
      } catch {
        // Swallow transient poll errors silently
      }
    }, 3000);
  }

  // Replace the temporary "generating" placeholder with final text
  function replaceGenerating(text: string) {
    const idx = genMsgIndexRef.current;
    if (typeof idx === "number") {
      replaceAt(idx, text);
      genMsgIndexRef.current = null;
    } else {
      append(text);
    }
  }

  // Toggle collapsed state (accessible + persisted)
  function toggleCollapsed() {
    setCollapsed((prev) => !prev);
  }

  return (
    <div
      className={`p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 ${className}`}
    >
      {/* Header acts as the collapse/expand trigger */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="analysis-console-body"
        className="
          w-full flex items-center justify-between
          text-left group outline-none
          focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded-xl
        "
        title={collapsed ? "Expand Analysis Console" : "Collapse Analysis Console"}
      >
        <span className="text-xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
          Analysis · Console
        </span>
        <span
          className={`
            ml-3 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-white/5
            text-white/80 transition-transform duration-200
            ${collapsed ? "" : "rotate-180"}
            group-hover:bg-white/10
          `}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {/* Body (hidden when collapsed). Keep logic running; just don't render the UI. */}
      {!collapsed && (
        <>
          {/* Scrollable feed */}
          <div
            id="analysis-console-body"
            ref={containerRef}
            className="px-4 py-3 space-y-4 text-sm h-[420px] overflow-y-auto border-t border-white/10 mt-3"
          >
            {messages.map((m, i) => {
              // Detect special lines to replace their leading emoji with a lotus icon
              const isScanningLine = m.text.startsWith("⌛ Scanning in progress");
              const isCompletedLine = m.text.startsWith("📊 I’ve completed the analysis");
              const isAnalyzingLine = m.text.startsWith("🧠 Let me analyze");

              // Normalize text by stripping the leading emoji when we render a lotus
              const textNormalized = isScanningLine
                ? m.text.replace(/^⌛\s*/, "")
                : isCompletedLine
                ? m.text.replace(/^📊\s*/, "")
                : isAnalyzingLine
                ? m.text.replace(/^🧠\s*/, "")
                : m.text;

              return (
                <div key={i} className="flex items-start gap-3">
                  <Image src={polinaIcon} alt="Polina" width={28} height={28} className="rounded-full" />
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Polina{m.time ? ` · ${m.time}` : ""}</div>

                    <div className="text-gray-200 font-mono leading-snug whitespace-pre-wrap">
                      {isScanningLine || isCompletedLine || isAnalyzingLine ? (
                        <span className="inline-flex items-center gap-2">
                          {/* Rotating lotus while scanning & analyzing; static lotus after completion */}
                          <LotusIcon
                            className={`w-12 h-12 shrink-0 ${
                              (isScanningLine && status === "scanning") || isAnalyzingLine
                                ? "animate-spin motion-reduce:animate-none"
                                : ""
                            }`}
                            style={
                              (isScanningLine && status === "scanning") || isAnalyzingLine
                                ? { animationDuration: "2.2s" }
                                : undefined
                            }
                            title={
                              isAnalyzingLine ? "Analyzing" : isScanningLine ? "Scanning" : "Completed"
                            }
                          />
                          <span>{textNormalized}</span>
                        </span>
                      ) : (
                        textNormalized
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Meta info */}
          <div className="mt-4 text-xs text-gray-400 space-y-1">
            <div className="truncate">
              <span className="text-gray-400">Job ID: </span>
              <span className="text-gray-200 break-all">{jobId || "-"}</span>
            </div>
            <div>
              <span className="text-gray-400">Tweets: </span>
              <span className="text-gray-200">{tweetCount}</span>
            </div>
            <div>
              <span className="text-gray-400">Status: </span>
              <span className="text-gray-200">{status}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Top-view lotus icon: symmetric petals so rotation looks centered & balanced. */
function LotusIcon({
  className,
  style,
  title,
}: {
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  // Petal is drawn pointing up, then rotated around center for radial symmetry
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={style}
      role="img"
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {/* Soft green gradient to match Polina's accent */}
        <linearGradient id="lotusGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3ef2ac" />
          <stop offset="100%" stopColor="#27a567" />
        </linearGradient>
      </defs>

      {/* Center circle */}
      <circle cx="12" cy="12" r="2" fill="url(#lotusGrad)" opacity="0.95" />

      {/* Single petal path (top), then replicated by rotation for symmetry */}
      {/* The curve creates a petal-like teardrop. Adjusted for balanced spin */}
      <g fill="url(#lotusGrad)" opacity="0.95">
        {Array.from({ length: 8 }).map((_, idx) => (
          <g key={idx} transform={`rotate(${idx * 45} 12 12)`}>
            <path d="M12 4 C 13.8 6.8, 14.2 9.2, 12 11 C 9.8 9.2, 10.2 6.8, 12 4 Z" />
          </g>
        ))}
      </g>
    </svg>
  );
}
