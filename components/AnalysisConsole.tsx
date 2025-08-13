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
  className = "",
}: {
  inputs?: AnalysisInput | null;
  onTweetCountUpdate?: (n: number) => void;
  onAnalysisResult?: (res: { summary: string }) => void;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "scanning" | "complete" | "error">("idle");
  const [messages, setMessages] = useState<{ text: string; time?: string }[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tweetCount, setTweetCount] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genMsgIndexRef = useRef<number | null>(null);

  // one-shot gates & live status
  const jobStartedRef = useRef<string | null>(null);
  const analysisStartedRef = useRef(false);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  // smooth scroll
  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // welcome text when idle & empty
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

  // Run a new scan whenever inputs change
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

  function timeStr() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function append(text: string) {
    // adjacent de-dup
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

  const toFriendly = (line: string) => {
    if (line.includes("Scanning for keywords"))
      return "I’m looking through Twitter for mentions like: " + line.split(":")[1]?.trim();
    if (line.includes("Job started")) return "Okay! I’ve kicked off the scan. Give me a moment...";
    if (line.includes("Scanning in progress")) return line.replace("⏳", "⌛") + " Almost there!";
    if (line.includes("Completed"))
      return "All done! I found " + (line.match(/\d+/)?.[0] ?? "?") + " relevant tweets for you 💫";
    return line;
  };

  async function runScan(input: AnalysisInput) {
    if (pollTimer.current) clearInterval(pollTimer.current);

    setStatus("scanning");
    setMessages([]);                 // 清空欢迎语
    setJobId(null);
    setTweetCount(0);
    jobStartedRef.current = null;    // reset gates
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
          let line = raw;

          // 忽略提交提示
          if (line.includes("Job submitted")) continue;

          // 流式日志里的“Scanning in progress”在非 scanning 或已进入分析阶段时丢弃
          if (line.includes("Scanning in progress") && (statusRef.current !== "scanning" || analysisStartedRef.current)) {
            continue;
          }

          // “Completed” 交给轮询统一写入，避免重复
          if (line.includes("Completed")) continue;

          // 其他日志做友好化显示
          append(toFriendly(line));

          // 只认第一次 Job started
          const m = line.match(/Job started:\s*(.+)/i);
          if (m) {
            const id = m[1].trim();
            if (!jobStartedRef.current) {
              jobStartedRef.current = id;
              setJobId(id);
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

  function startPolling(id: string) {
    if (pollTimer.current) clearInterval(pollTimer.current);

    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobProxy?job_id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await r.json();

        // 优先处理 completed，避免已完成后再写进度
        if (data?.status === "completed") {
          if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
          if (analysisStartedRef.current) return;
          analysisStartedRef.current = true;

          setStatus("complete");
          append(toFriendly(`✅ Completed: ${data?.tweets_count || 0} tweets found.`));

          // 占位“正在分析…”
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
              body: JSON.stringify({ tweets: safeTweets }),
              signal: controller.signal,
            }).catch((e) => {
              throw new Error(e?.name === "AbortError" ? "AI request timeout (150s)" : e?.message || "Network error");
            });
            clearTimeout(timeout);

            const json = await aiRes.json().catch(() => ({}));
            const text: string = json?.text || json?.error || "";
            if (!aiRes.ok) {
              replaceGenerating(`❌ Gemini error: ${text || aiRes.statusText}`);
              return;
            }

            onAnalysisResult?.({ summary: text });
            replaceGenerating("📊 I’ve completed the analysis. Please check the full summary on the left side 👉");
          } catch (e: any) {
            replaceGenerating(`❌ Gemini request failed: ${e?.message || "Unknown error"}`);
          }

          return; // 已处理完成，直接返回，防止继续写进度
        }

        // 只有在 scanning 阶段才写进度；且没有进入分析阶段
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
        // swallow transient poll errors
      }
    }, 3000);
  }

  function replaceGenerating(text: string) {
    const idx = genMsgIndexRef.current;
    if (typeof idx === "number") {
      replaceAt(idx, text);
      genMsgIndexRef.current = null;
    } else {
      append(text);
    }
  }

  return (
    <div
      className={`p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 ${className}`}
    >
      <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Analysis · Console
      </h2>

      {/* scrollable feed */}
      <div
        ref={containerRef}
        className="px-4 py-3 space-y-4 text-sm h-[420px] overflow-y-auto border-t border-white/10"
      >
        {messages.map((m, i) => (
          <div key={i} className="flex items-start gap-3">
            <Image src={polinaIcon} alt="Polina" width={28} height={28} className="rounded-full" />
            <div>
              <div className="text-xs text-gray-400 mb-1">Polina{m.time ? ` · ${m.time}` : ""}</div>
              <div className="text-gray-200 font-mono leading-snug whitespace-pre-wrap">{m.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* meta (vertical) */}
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
    </div>
  );
}
