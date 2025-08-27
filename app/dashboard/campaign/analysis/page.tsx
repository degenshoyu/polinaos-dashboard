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

/** ===== Outer wrapper: provides Suspense boundary (does NOT call useSearchParams) ===== */
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
        const r = await fetch(
          `/api/jobProxy?job_id=${encodeURIComponent(deeplinkJob)}`,
          { cache: "no-store" }
        );
        const j = (await r.json()) as JobPayload;
        if (!r.ok) throw new Error((j as any)?.error || r.statusText);

        const rows = Array.isArray(j.tweets) ? j.tweets : [];

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
            (t) => typeof t.textContent === "string" && t.textContent.trim().length > 0
          );

        if (norm.length) {
          const emo = computeEmotionalLandscape(norm);
          setEmotions(emo);
        } else {
          setEmotions(null);
        }

        const kw = Array.isArray(j.keyword)
          ? j.keyword.filter(
              (s): s is string => typeof s === "string"
            )
          : [];
        const guessTicker =
          kw.find((k) => /^\$[A-Za-z0-9_]{2,20}$/.test(k)) || null;
        const guessContract =
          kw.find((k) => /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(k)) || null; 
        setTicker(guessTicker);
        setContractAddress(guessContract);

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
          onAnalysisResult={(res) => {
            setSummary(res.summary);
            setEmotions((prev) =>
              // @ts-expect-error allow partial result shape
              res.emotions !== undefined ? (res.emotions ?? null) : prev
            );
            setEmotionsInsight((prev) =>
              // @ts-expect-error allow partial result shape
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
