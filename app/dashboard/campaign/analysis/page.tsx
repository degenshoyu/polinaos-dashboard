// app/dashboard/campaign/analysis/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import CampaignLeftPane from "@/components/CampaignLeftPane";
import CampaignRightPane from "@/components/CampaignRightPane";
import type { AnalysisInput } from "@/components/types";
import {
  computeEmotionalLandscape,
  type TweetForEmotion,
} from "@/lib/analysis/emotionalLandscape";

/** ===== types ===== */
type JobTweet = Partial<TweetForEmotion> & {
  tweetId?: string;
  tweeter?: string;
  textContent?: string;
  datetime?: string;
  statusLink?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  isVerified?: boolean;
};

type JobPayload = {
  job_id: string;
  status: string;
  start_date?: string;
  end_date?: string;
  keyword?: string[];
  tweets_count?: number;
  tweets?: JobTweet[];
};

type UnderstandingResp = {
  summary: string | null;
  emotions: ReturnType<typeof computeEmotionalLandscape> | null;
  emotionsInsight: string | null;
  error?: string;
};

type EmotionsInsightResp = {
  emotionsInsight?: string;
  error?: string;
};

/** ===== Outer wrapper: Suspense boundary (does NOT call useSearchParams) ===== */
export default function AnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground">
          Loading analysis…
        </div>
      }
    >
      <AnalysisClient />
    </Suspense>
  );
}

/** ===== Inner client that reads search params ===== */
function AnalysisClient() {
  const searchParams = useSearchParams();
  const deeplinkJob = searchParams.get("job");

  const [summary, setSummary] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState<AnalysisInput | null>(null);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | undefined>(undefined);

  const [emotions, setEmotions] =
    useState<ReturnType<typeof computeEmotionalLandscape> | null>(null);
  const [emotionsInsight, setEmotionsInsight] = useState<string | null>(null);

  const [ticker, setTicker] = useState<string | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);

  async function handleJobIdChange(jobId: string | null) {
    if (!jobId) {
      setDeepLinkUrl(undefined);
      return;
    }
    const base = window.location.origin;
    setDeepLinkUrl(
      `${base}/dashboard/campaign/analysis?job=${encodeURIComponent(jobId)}`
    );
  }

  useEffect(() => {
    if (!deeplinkJob) return;

    handleJobIdChange(deeplinkJob);

    (async () => {
      try {
        // 1) 拉 Job 数据
        const r = await fetch(
          `/api/jobProxy?job_id=${encodeURIComponent(deeplinkJob)}`,
          { cache: "no-store" }
        );
        const j = (await r.json()) as JobPayload;
        if (!r.ok) throw new Error((j as any)?.error || r.statusText);

        const rows = Array.isArray(j.tweets) ? j.tweets : [];

        // 2) 规范化并计算情感图（本地）
        const norm: TweetForEmotion[] = rows
          .map((t) => ({
            textContent:
              (typeof t.textContent === "string" && t.textContent) ||
              (typeof (t as any).text === "string" && (t as any).text) ||
              (typeof (t as any).full_text === "string" &&
                (t as any).full_text) ||
              (typeof (t as any).content === "string" && (t as any).content) ||
              "",
            tweetId: t.tweetId || (t as any).id_str || (t as any).id,
            tweeter:
              t.tweeter ||
              (t as any).user?.screen_name ||
              (t as any).user?.name,
            datetime: t.datetime || (t as any).created_at,
            isVerified: Boolean(t.isVerified || (t as any).user?.verified),
            views: toNum((t as any).views),
            likes: toNum((t as any).likes ?? (t as any).favorite_count),
            replies: toNum((t as any).replies),
            retweets: toNum((t as any).retweets ?? (t as any).retweet_count),
            statusLink: t.statusLink,
          }))
          .filter(
            (t) =>
              typeof t.textContent === "string" &&
              t.textContent.trim().length > 0
          );

        let emo: ReturnType<typeof computeEmotionalLandscape> | null = null;
        if (norm.length) {
          emo = computeEmotionalLandscape(norm);
          setEmotions(emo);
        } else {
          setEmotions(null);
        }

        // 3) 推断 ticker / contract
        const kw = Array.isArray(j.keyword)
          ? j.keyword.filter((s): s is string => typeof s === "string")
          : [];
        const guessTicker =
          kw.find((k) => /^\$[A-Za-z0-9_]{2,20}$/.test(k)) || null;
        const guessContract =
          kw.find((k) => /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(k)) || null;
        setTicker(guessTicker);
        setContractAddress(guessContract);
        const projectName =
          (Array.isArray(j.keyword) && j.keyword[0]) || undefined;

        // 4) 拉最近一次 AI understanding（若有历史 insight 直接使用）
        try {
          const u = await fetch(
            `/api/aiUnderstanding?job_id=${encodeURIComponent(deeplinkJob)}`,
            { cache: "no-store" }
          );
          const uj = (await u.json()) as UnderstandingResp;
          if (u.ok) {
            if (typeof uj.summary === "string" && !summary)
              setSummary(uj.summary);
            if (uj.emotions && !emotions) setEmotions(uj.emotions);
            if (typeof uj.emotionsInsight === "string") {
              setEmotionsInsight(uj.emotionsInsight);
            } else if (emo) {
              // 5) 没有历史 insight，就即时生成并写库
              const created = await createInsightForJob(
                deeplinkJob,
                emo,
                projectName
              );
              if (created) setEmotionsInsight(created);
            }
          } else if (emo) {
            // 接口失败时也尽力生成（不阻塞页面）
            const created = await createInsightForJob(
              deeplinkJob,
              emo,
              projectName
            );
            if (created) setEmotionsInsight(created);
          }
        } catch {
          // 静默失败：不阻塞页面（用户仍可在右侧运行分析）
          if (emo) {
            const created = await createInsightForJob(
              deeplinkJob,
              emo,
              projectName
            );
            if (created) setEmotionsInsight(created);
          }
        }

        // 保持与之前行为一致
        setSummary((prev) => prev ?? null);
        setEmotionsInsight((prev) => prev ?? null);
      } catch (e) {
        console.warn("[deeplink hydrate failed]", (e as any)?.message || e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deeplinkJob]);

  return (
    <div className="grid grid-cols-12 gap-6 items-start">
      {/* Left column: Input + AI Understanding + Emotional Landscape */}
      <div className="col-span-12 md:col-span-6">
        <CampaignLeftPane
          aiSummary={summary}
          deepLinkUrl={deepLinkUrl}
          emotions={emotions}
          emotionsInsight={emotionsInsight}
          ticker={ticker}
          contractAddress={contractAddress}
          onRun={(input) => {
            setSummary(null);
            setEmotions(null);
            setEmotionsInsight(null);
            setLastInput(input);
          }}
        />
      </div>

      {/* Right column: Console + StatisticSummary (sticky on md+) */}
      <div className="col-span-12 md:col-span-6 md:sticky md:top-20 self-start">
        <CampaignRightPane
          inputs={lastInput}
          onAnalysisResult={(
            res: {
              summary: string;
              emotions?: ReturnType<typeof computeEmotionalLandscape> | null;
              emotionsInsight?: string | null;
            }
          ) => {
            setSummary(res.summary);
            // 只有在明确提供时才更新；undefined 时保留现有值（避免旧数据清空）
            setEmotions((prev) =>
              res.emotions !== undefined ? (res.emotions ?? null) : prev
            );
            setEmotionsInsight((prev) =>
              res.emotionsInsight !== undefined
                ? (res.emotionsInsight ?? null)
                : prev
            );
          }}
          onJobIdChange={handleJobIdChange}
        />
      </div>
    </div>
  );
}

/** ===== helpers ===== */
function toNum(n: any): number | undefined {
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

/** 生成并入库 emotions insight（POST /api/emotionsInsight） */
async function createInsightForJob(
  jobId: string,
  emotions: ReturnType<typeof computeEmotionalLandscape>,
  projectName?: string
): Promise<string | null> {
  try {
    const r2 = await fetch("/api/emotionsInsight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        emotions,
        projectName,
        maxWords: 160,
      }),
    });
    const jr2 = (await r2.json()) as EmotionsInsightResp;
    if (r2.ok && typeof jr2.emotionsInsight === "string") {
      return jr2.emotionsInsight;
    }
  } catch {}
  return null;
}
