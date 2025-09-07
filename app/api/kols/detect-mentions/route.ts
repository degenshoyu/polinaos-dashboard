// app/api/kols/detect-mentions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { eq, and, gte, lt, sql, inArray, desc } from "drizzle-orm";
import { processTweetsToRows } from "@/lib/kols/detectEngine";

/* ========================= Runtime ========================= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================= Auth helpers ========================= */
function allowByCronSecret(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret")?.trim() || "";
  const h =
    req.headers.get("x-cron-secret")?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    "";
  return q === expected || h === expected;
}

/* ========================= Body schema ========================= */
const Body = z.object({
  screen_name: z.string().min(1), // 支持具体账号或 "*" / "all"
  days: z.number().int().min(1).max(30).optional().default(7),
  missingOnly: z.boolean().optional().default(true),
});

/* ========================= Core runner (single window) ========================= */
async function runDetectOnce(
  params: { screen_name: string; days: number; missingOnly: boolean; url: URL },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly } = params;

  const raw = screen_name.trim().replace(/^@+/, "");
  const isAll = raw === "*" || raw.toLowerCase() === "all";
  const handle = isAll ? null : raw.toLowerCase();

  log({ event: "start", handle: handle ?? "*", days, missingOnly });

  // 时间窗口 [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // 读取推文（按时间倒序）
  const tweets = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(
      isAll
        ? and(
            gte(kolTweets.publishDate, since),
            lt(kolTweets.publishDate, until),
          )
        : and(
            eq(kolTweets.twitterUsername, handle!),
            gte(kolTweets.publishDate, since),
            lt(kolTweets.publishDate, until),
          ),
    )
    .orderBy(desc(kolTweets.publishDate));

  log({ event: "loaded", tweets: tweets.length });

  if (!tweets.length) {
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: 0,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
    };
  }

  // 当 missingOnly=true：排除已有任何 mentions 的推文
  let candidates = tweets;
  if (missingOnly) {
    const existing = await db
      .select({ tweetId: tweetTokenMentions.tweetId })
      .from(tweetTokenMentions)
      .where(
        inArray(
          tweetTokenMentions.tweetId,
          tweets.map((t) => t.tweetId),
        ),
      );
    const has = new Set(existing.map((e) => e.tweetId));
    candidates = tweets.filter((t) => !has.has(t.tweetId));
  }
  log({ event: "candidates", count: candidates.length });

  // 交给引擎：抽取 → 解析（tickers/names/CA）→ 产出 rows（不涉及 DB）
  const { rows, stats } = await processTweetsToRows(
    candidates.map((t) => ({ tweetId: t.tweetId, textContent: t.textContent })),
    log,
  );

  if (!rows.length) {
    log({ event: "done", rows: 0, inserted: 0, updated: 0 });
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: stats.scannedTweets,
      mentionsDetected: stats.mentionsDetected,
      inserted: 0,
      updated: 0,
    };
  }

  // 统计：先查 (tweetId, triggerKey) 是否已存在，算 willInsert/willUpdate
  const tweetIds = Array.from(new Set(rows.map((r) => r.tweetId)));
  const triggers = Array.from(new Set(rows.map((r) => r.triggerKey)));
  const existingPairs = await db
    .select({
      tweetId: tweetTokenMentions.tweetId,
      triggerKey: tweetTokenMentions.triggerKey,
      tokenKey: tweetTokenMentions.tokenKey,
    })
    .from(tweetTokenMentions)
    .where(
      and(
        inArray(tweetTokenMentions.tweetId, tweetIds),
        inArray(tweetTokenMentions.triggerKey, triggers),
      ),
    );

  const existsMap = new Map(
    existingPairs.map((e) => [`${e.tweetId}___${e.triggerKey}`, e.tokenKey]),
  );
  const willInsert = rows.filter(
    (r) => !existsMap.has(`${r.tweetId}___${r.triggerKey}`),
  ).length;
  const willUpdate = rows.filter((r) => {
    const prev = existsMap.get(`${r.tweetId}___${r.triggerKey}`);
    return prev && prev !== r.tokenKey;
  }).length;

  log({
    event: "upsert_planning",
    rows: rows.length,
    willInsert,
    willUpdate,
  });

  // Upsert：以 (tweet_id, trigger_key) 为冲突键，分块写入
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      tweetId: r.tweetId,
      tokenKey: r.tokenKey,
      tokenDisplay: r.tokenDisplay,
      confidence: r.confidence,
      // cast 到数据库 enum（"ca" | "ticker" | "phrase"...）
      source: r.source as (typeof mentionSource.enumValues)[number],
      triggerKey: r.triggerKey,
      triggerText: r.triggerText,
    }));

    await db
      .insert(tweetTokenMentions)
      .values(chunk)
      .onConflictDoUpdate({
        target: [tweetTokenMentions.tweetId, tweetTokenMentions.triggerKey],
        set: {
          tokenKey: sql`excluded.token_key`,
          tokenDisplay: sql`excluded.token_display`,
          confidence: sql`excluded.confidence`,
          source: sql`excluded.source`,
          triggerText: sql`excluded.trigger_text`,
          updatedAt: sql`now()`,
        },
      });
  }

  log({
    event: "done",
    rows: rows.length,
    inserted: willInsert,
    updated: willUpdate,
  });

  return {
    ok: true,
    handle: handle ?? "*",
    days,
    scannedTweets: stats.scannedTweets,
    mentionsDetected: stats.mentionsDetected,
    inserted: willInsert,
    updated: willUpdate,
  };
}

/* ========================= Route (POST) ========================= */
export async function POST(req: Request) {
  // Admin 或 CRON 密钥
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  const bySecret = allowByCronSecret(req);
  if (!isAdmin && !bySecret) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const wantStream =
    url.searchParams.get("stream") === "1" ||
    url.searchParams.get("stream") === "true";

  const body = Body.parse(await req.json().catch(() => ({})));
  const params = { ...body, url };

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          (async () => {
            try {
              const result = await runDetectOnce(params, write);
              write({ event: "result", result });
              controller.close();
            } catch (e: any) {
              write({ event: "error", message: e?.message || String(e) });
              controller.close();
            }
          })();
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  }

  // 非流式：直接返回 JSON
  const result = await runDetectOnce(params, () => {});
  return NextResponse.json(result);
}
