// app/api/kols/scan-tweets/route.ts

const ROUTE_ID = "/api/kols/scan-tweets";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { eq, sql, and, gte, lt, inArray } from "drizzle-orm";
import { extractMentions } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";

export async function GET() {
  return NextResponse.json({
    ok: true,
    routeId: ROUTE_ID,
    ts: new Date().toISOString(),
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Allow admin session OR x-cron-secret (or ?secret=...) */
async function ensureAuth(req: Request) {
  // 1) Admin session
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (isAdmin) return true;

  // 2) Header: x-cron-secret
  const secret = process.env.CRON_SECRET;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (secret && hdr && hdr === secret) return true;

  // 3) Optional: query param ?secret=... (useful for providers that can't set headers)
  const url = new URL(req.url);
  const qs = url.searchParams.get("secret");
  if (secret && qs && qs === secret) return true;

  return false;
}

/** ===== Input schema ===== */
const Body = z.object({
  screen_name: z.string().min(1),
  rangeDays: z.number().int().min(1).max(14).optional().default(7),
  pollIntervalMs: z.number().int().min(250).max(3000).optional().default(1000),
  maxWaitMs: z
    .number()
    .int()
    .min(3000)
    .max(1800000)
    .optional()
    .default(1200000),
});

const norm = (h: string) => h.trim().replace(/^@+/, "").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toBig = (v: unknown): bigint => {
  const n = Number(v);
  if (!Number.isFinite(n)) return BigInt(0);
  try {
    return BigInt(Math.trunc(n));
  } catch {
    return BigInt(0);
  }
};
const ORIGIN = (req: Request) => {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return `${proto}://${host}`;
};

/** Normalize remote tweet payload into kolTweets insert shape */
function mapTweet(raw: any, fallbackHandle: string) {
  const id = raw?.tweetId ?? raw?.id_str ?? raw?.id ?? raw?.tweet_id ?? "";
  const text =
    raw?.textContent ??
    raw?.full_text ??
    raw?.text ??
    raw?.body ??
    raw?.content ??
    "";
  const likes = raw?.likes ?? raw?.favorite_count ?? raw?.like_count ?? 0;
  const rts = raw?.retweets ?? raw?.retweet_count ?? 0;
  const replies = raw?.replies ?? raw?.reply_count ?? 0;
  const views = raw?.views ?? raw?.impression_count ?? 0;
  const createdAt =
    raw?.datetime ??
    raw?.created_at ??
    raw?.publish_date ??
    raw?.timestamp_ms ??
    raw?.timestamp ??
    null;
  const screenName =
    raw?.tweeter ??
    raw?.user?.screen_name ??
    raw?.screen_name ??
    fallbackHandle;
  const uid = raw?.user?.id_str ?? raw?.user?.id ?? raw?.twitter_uid ?? null;
  const link =
    raw?.statusLink ??
    raw?.status_link ??
    raw?.url ??
    (id && screenName ? `https://x.com/${screenName}/status/${id}` : null);
  const verified = raw?.isVerified ?? raw?.user?.verified ?? null;

  return {
    twitterUid: uid,
    twitterUsername: String(screenName || fallbackHandle).toLowerCase(),
    type: "tweet" as const,
    textContent: text,
    views: Number(views ?? 0),
    likes: Number(likes ?? 0),
    retweets: Number(rts ?? 0),
    replies: Number(replies ?? 0),
    publishDate: createdAt ? new Date(createdAt) : new Date(),
    tweetId: String(id),
    statusLink: link ? String(link) : null,
    authorIsVerified: verified === null ? null : Boolean(verified),
  };
}

/** Confidence fallback if extractMentions() didn't provide one */
function resolveConfidence(m: any): number {
  const n = Number(m?.confidence);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  const kind = String(m?.kind || "").toLowerCase();
  const v = String(
    m?.ticker || m?.value || m?.symbol || m?.contract || m?.address || "",
  );
  // contract-like → 100; $ticker-like → 99; others → 90
  if (kind === "contract" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))
    return 100;
  if (/^\$[A-Za-z0-9_]{2,20}$/.test(v)) return 99;
  return 90;
}

/** Extract mentions from text, robust to function changes */
function safeExtractMentions(text: string): any[] {
  try {
    const out = extractMentions?.(text);
    if (Array.isArray(out)) return out;
    if (out && Array.isArray((out as any).mentions))
      return (out as any).mentions;
    return [];
  } catch {
    return [];
  }
}

/** POST /api/kols/scan-tweets */
export async function POST(req: Request) {
  // --- auth ---
  if (!(await ensureAuth(req))) {
    return NextResponse.json(
      { routeId: ROUTE_ID, ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  // --- parse input ---
  const { screen_name, rangeDays, pollIntervalMs, maxWaitMs } = Body.parse(
    await req.json(),
  );
  const handle = norm(screen_name);

  // --- build ctsearch window: past 6 days ~ tomorrow (inclusive/exclusive) ---
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (rangeDays - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);
  const startDate = since.toISOString().slice(0, 10);
  const endDate = until.toISOString().slice(0, 10);

  // --- start ctsearch job ---
  const origin = ORIGIN(req);
  const cookie = req.headers.get("cookie") ?? "";
  const ctRes = await fetch(`${origin}/api/ctsearch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ twitterHandle: handle, startDate, endDate }),
    cache: "no-store",
  });
  const ctText = await ctRes.text();
  const m = ctText.match(/Job started:\s*([A-Za-z0-9_\-:.]+)/i);
  const jobId = m?.[1];
  if (!ctRes.ok || !jobId) {
    return NextResponse.json(
      {
        routeId: ROUTE_ID,
        ok: false,
        error: "ctsearch start failed",
        status: ctRes.status,
        preview: ctText.slice(0, 400),
      },
      { status: 502 },
    );
  }

  // --- poll job status ---
  const begin = Date.now();
  let last: any = null;
  while (Date.now() - begin < maxWaitMs) {
    const r = await fetch(
      `${origin}/api/jobProxy?job_id=${encodeURIComponent(jobId)}`,
      {
        cache: "no-store",
        headers: cookie ? { cookie } : undefined,
      },
    );
    const t = await r.text();
    try {
      last = JSON.parse(t);
    } catch {
      last = { error: "non-json", preview: t.slice(0, 300) };
    }
    const s = String(last?.status || "").toLowerCase();
    if (s === "completed" || s === "failed") break;
    await sleep(pollIntervalMs);
  }
  if (!last || String(last?.status).toLowerCase() !== "completed") {
    return NextResponse.json(
      {
        routeId: ROUTE_ID,
        ok: false,
        error: "poll timeout or not completed",
        last,
      },
      { status: 504 },
    );
  }

  // --- map tweets ---
  const rowsRaw: any[] = Array.isArray(last?.tweets)
    ? last.tweets
    : Array.isArray(last?.data?.tweets)
      ? last.data.tweets
      : Array.isArray(last?.result?.tweets)
        ? last.result.tweets
        : [];
  const mapped = rowsRaw
    .map((tw) => mapTweet(tw, handle))
    .filter((x) => x.tweetId);

  if (mapped.length === 0) {
    return NextResponse.json({
      routeId: ROUTE_ID,
      ok: true,
      handle,
      job_id: jobId,
      scanned: rowsRaw.length,
      inserted: 0,
      dupes: 0,
      reason: "no mappable tweets in window",
    });
  }

  // --- ensure kol record ---
  const kol = await db.query.kols.findFirst({
    where: eq(kols.twitterUsername, handle),
  });
  if (!kol?.twitterUid) {
    return NextResponse.json(
      {
        routeId: ROUTE_ID,
        ok: false,
        error: "kol missing twitterUid; run resolve-user first",
        handle,
      },
      { status: 400 },
    );
  }

  // --- upsert kol_tweets ---
  const values = mapped.map((m) => ({
    twitterUid: String(m.twitterUid ?? kol?.twitterUid ?? ""),
    twitterUsername: String(kol?.twitterUsername ?? m.twitterUsername ?? ""),
    type: m.type,
    textContent: m.textContent,
    views: toBig(m.views),
    likes: m.likes,
    retweets: m.retweets,
    replies: m.replies,
    publishDate: m.publishDate,
    tweetId: String(m.tweetId ?? ""),
    statusLink: m.statusLink,
    authorIsVerified: m.authorIsVerified ?? null,
  }));

  let inserted = 0;
  let dupes = 0;
  try {
    const res = await db
      .insert(kolTweets)
      .values(values)
      .onConflictDoUpdate({
        target: kolTweets.tweetId,
        set: {
          views: sql`GREATEST(${kolTweets.views}, EXCLUDED.views)`,
          likes: sql`GREATEST(${kolTweets.likes}, EXCLUDED.likes)`,
          retweets: sql`GREATEST(${kolTweets.retweets}, EXCLUDED.retweets)`,
          replies: sql`GREATEST(${kolTweets.replies}, EXCLUDED.replies)`,
          textContent: sql`COALESCE(EXCLUDED.text_content, ${kolTweets.textContent})`,
          statusLink: sql`COALESCE(EXCLUDED.status_link, ${kolTweets.statusLink})`,
          publishDate: sql`LEAST(${kolTweets.publishDate}, EXCLUDED.publish_date)`,
          authorIsVerified: sql`COALESCE(EXCLUDED.author_is_verified, ${kolTweets.authorIsVerified})`,
          lastSeenAt: sql`NOW()`,
        },
      })
      .returning({
        tweetId: kolTweets.tweetId,
        inserted: sql<boolean>`xmax = 0`,
      });
    const upserts = res.length;
    inserted = res.reduce((n, r) => n + (r.inserted ? 1 : 0), 0);
    dupes = upserts - inserted;
  } catch (e: any) {
    console.error("insert kolTweets error:", e);
    return NextResponse.json(
      {
        routeId: ROUTE_ID,
        ok: false,
        error: "db insert failed",
        reason: String(e?.message ?? e).slice(0, 300),
      },
      { status: 500 },
    );
  }

  // --- compute 7d totals for UI ---
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const agg = await db
    .select({
      totalTweets: sql<number>`COUNT(*)`,
      totalViews: sql<number>`COALESCE(SUM(${kolTweets.views}), 0)`,
      totalEngs: sql<number>`COALESCE(SUM(${kolTweets.likes} + ${kolTweets.retweets} + ${kolTweets.replies}), 0)`,
    })
    .from(kolTweets)
    .where(
      and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, sevenDaysAgo),
        lt(kolTweets.publishDate, tomorrow),
      ),
    );
  const totals = agg?.[0] ?? { totalTweets: 0, totalViews: 0, totalEngs: 0 };

  // === CONDITIONAL REBUILD OF MENTIONS (threshold 98) ===
  // Only for tweets involved in this scan; skip if existing max(confidence) > 98.
  const threshold = 98;
  const tweetIds = mapped.map((m) => m.tweetId);
  // Query current max confidence for these tweets
  const confRows = tweetIds.length
    ? await db
        .select({
          tweetId: tweetTokenMentions.tweetId,
          maxConf: sql<number>`MAX(${tweetTokenMentions.confidence})`,
        })
        .from(tweetTokenMentions)
        .where(inArray(tweetTokenMentions.tweetId, tweetIds))
        .groupBy(tweetTokenMentions.tweetId)
    : [];
  const confMap = new Map<string, number>();
  for (const r of confRows)
    confMap.set(String(r.tweetId), Number(r.maxConf ?? 0));

  // Split to skip/rebuild sets
  const needsRebuild = new Set<string>();
  for (const id of tweetIds) {
    const maxConf = confMap.get(id);
    if (maxConf == null || !(maxConf > threshold)) {
      needsRebuild.add(id);
    }
  }

  // Delete old mentions for rebuild set
  if (needsRebuild.size > 0) {
    await db
      .delete(tweetTokenMentions)
      .where(inArray(tweetTokenMentions.tweetId, Array.from(needsRebuild)));
  }

  // Re-extract mentions for rebuild tweets
  let mentionsInserted = 0;
  if (needsRebuild.size > 0) {
    const textById = new Map(
      mapped.map((m) => [m.tweetId, m.textContent || ""]),
    );
    const rows: Array<typeof tweetTokenMentions.$inferInsert> = [];
    for (const id of needsRebuild) {
      const text = (textById.get(id) || "").trim();
      if (!text) continue;
      const triggerKey = (() => {
        try {
          return buildTriggerKeyWithText?.(text) || null;
        } catch {
          return null;
        }
      })();
      const mentions = safeExtractMentions(text);
      for (const m of mentions) {
        const tokenDisplay =
          m?.ticker?.toString?.() ||
          m?.value?.toString?.() ||
          m?.symbol?.toString?.() ||
          "";
        const contractRaw =
          m?.contract?.toString?.() ||
          m?.address?.toString?.() ||
          m?.ca?.toString?.() ||
          "";
        if (!tokenDisplay && !contractRaw) continue;
        rows.push({
          tweetId: id,
          tokenDisplay: tokenDisplay || null,
          contractAddress: contractRaw || null,
          source: "text" as any, // replace with mentionSource.text if you have enum
          triggerKey,
          confidence: resolveConfidence(m),
        } as any);
      }
    }
    if (rows.length) {
      await db.insert(tweetTokenMentions).values(rows);
      mentionsInserted = rows.length;
    }
  }

  const mentionsChecked = tweetIds.length;
  const mentionsSkipped = mentionsChecked - needsRebuild.size;
  const mentionsRebuilt = needsRebuild.size;

  return NextResponse.json({
    routeId: ROUTE_ID,
    ok: true,
    handle,
    job_id: jobId,
    scanned: rowsRaw.length,
    inserted,
    dupes,
    totals,
    // mentions stats for visibility
    mentions_checked: mentionsChecked,
    mentions_skipped: mentionsSkipped, // already >98, not touched
    mentions_rebuilt: mentionsRebuilt, // tweets we re-extracted
    mentions_inserted: mentionsInserted, // rows inserted into tweet_token_mentions
  });
}
