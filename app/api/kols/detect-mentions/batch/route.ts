// app/api/kols/detect-mentions/batch/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { and, or, eq, lt, gte, desc, inArray, sql } from "drizzle-orm";
import { processTweetsToRows } from "@/lib/kols/detectEngine";

/* ========================= Runtime ========================= */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================= Auth ========================= */
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

/* ========================= Query schema ========================= */
const Q = z.object({
  screen_name: z.string().min(1).default("*"), // "*" / "all" 表示全库
  days: z.coerce.number().int().min(1).max(30).default(14),
  missingOnly: z
    .union([
      z.literal("1"),
      z.literal("0"),
      z.literal("true"),
      z.literal("false"),
    ])
    .optional()
    .transform((v) => (v == null ? true : v === "1" || v === "true")),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: z.string().optional(), // base64url of { ts: ISOString, id: string }
  stream: z.union([z.literal("1"), z.literal("true")]).optional(),
});

/* ========================= Cursor helpers ========================= */
type Cursor = { ts: string; id: string };
function encCursor(c: Cursor) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
function decCursor(s?: string): Cursor | null {
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof j?.ts === "string" && typeof j?.id === "string")
      return j as Cursor;
  } catch {}
  return null;
}

/* ========================= Page runner ========================= */
async function runDetectPage(
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    limit: number;
    cursor?: string;
    url: URL;
  },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly, limit, cursor } = params;

  const raw = screen_name.trim().replace(/^@+/, "");
  const isAll = raw === "*" || raw.toLowerCase() === "all";
  const handle = isAll ? null : raw.toLowerCase();

  log({
    event: "start",
    handle: handle ?? "*",
    days,
    missingOnly,
    limit,
    cursor: cursor ?? null,
  });

  // 时间窗口 [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // 解析分页游标（排序：publishDate DESC, tweetId DESC）
  const c = decCursor(cursor || undefined);
  const cursorTs = c ? new Date(c.ts) : null;
  const cursorId = c?.id ?? null;

  const baseWhere = isAll
    ? and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until))
    : and(
        eq(kolTweets.twitterUsername, handle!),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      );

  const where = c
    ? and(
        baseWhere,
        or(
          lt(kolTweets.publishDate, cursorTs!),
          and(
            eq(kolTweets.publishDate, cursorTs!),
            lt(kolTweets.tweetId, cursorId!),
          ),
        ),
      )
    : baseWhere;

  // 拉一页
  const page = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(where)
    .orderBy(desc(kolTweets.publishDate), desc(kolTweets.tweetId))
    .limit(limit);

  log({ event: "loaded", tweets: page.length });

  if (page.length === 0) {
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: 0,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
      nextCursor: null,
    };
  }

  // missingOnly：跳过已有任何 mentions 的推文
  let candidates = page;
  if (missingOnly) {
    const existing = await db
      .select({ tweetId: tweetTokenMentions.tweetId })
      .from(tweetTokenMentions)
      .where(
        inArray(
          tweetTokenMentions.tweetId,
          page.map((t) => t.tweetId),
        ),
      );
    const has = new Set(existing.map((e) => e.tweetId));
    candidates = page.filter((t) => !has.has(t.tweetId));
  }
  log({ event: "candidates", count: candidates.length });

  // 复用引擎：抽取 → 解析（ticker/name/CA）→ rows（不写库）
  const { rows, stats } = await processTweetsToRows(
    candidates.map((t) => ({ tweetId: t.tweetId, textContent: t.textContent })),
    log, // 引擎内部也会输出 resolve_* / extracted 等事件
  );

  // 计算 nextCursor（基于本页最后一条，和排序一致）
  const last = page[page.length - 1];
  const nextCursor = last
    ? encCursor({ ts: last.published.toISOString(), id: last.tweetId })
    : null;

  if (!rows.length) {
    log({ event: "done", rows: 0, inserted: 0, updated: 0, nextCursor });
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: stats.scannedTweets,
      mentionsDetected: stats.mentionsDetected,
      inserted: 0,
      updated: 0,
      nextCursor,
    };
  }

  // 预检：统计将要插入/更新
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

  log({ event: "upsert_planning", rows: rows.length, willInsert, willUpdate });

  // Upsert（分块）：冲突键 (tweet_id, trigger_key)
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      tweetId: r.tweetId,
      tokenKey: r.tokenKey,
      tokenDisplay: r.tokenDisplay,
      confidence: r.confidence,
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
    nextCursor,
  });

  return {
    ok: true,
    handle: handle ?? "*",
    days,
    scannedTweets: stats.scannedTweets,
    mentionsDetected: rows.length,
    inserted: willInsert,
    updated: willUpdate,
    nextCursor,
  };
}

/* ========================= GET (NDJSON or JSON) ========================= */
export async function GET(req: Request) {
  if (!allowByCronSecret(req)) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const q = Q.parse(Object.fromEntries(url.searchParams.entries()));
  const wantStream = !!q.stream;

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          write({ event: "hello", ts: Date.now() });
          (async () => {
            try {
              const result = await runDetectPage(
                {
                  screen_name: q.screen_name,
                  days: q.days,
                  missingOnly: q.missingOnly,
                  limit: q.limit,
                  cursor: q.cursor,
                  url,
                },
                write,
              );
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

  const result = await runDetectPage(
    {
      screen_name: q.screen_name,
      days: q.days,
      missingOnly: q.missingOnly,
      limit: q.limit,
      cursor: q.cursor,
      url,
    },
    () => {},
  );
  return NextResponse.json(result);
}

/* ========================= POST (body 或 query，同 GET) ========================= */
export async function POST(req: Request) {
  if (!allowByCronSecret(req)) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const qs = Object.fromEntries(url.searchParams.entries());
  const isStream = qs.stream === "1" || qs.stream === "true";

  // 允许 body + query 混合；缺省与 GET 对齐
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = {
    screen_name: String(body.screen_name ?? qs.screen_name ?? "*"),
    days: Number(body.days ?? qs.days ?? 14),
    missingOnly:
      body.missingOnly ?? /^(1|true)$/i.test(String(qs.missingOnly ?? "true")),
    limit: Number(body.limit ?? qs.limit ?? 200),
    cursor: String(body.cursor ?? qs.cursor ?? "") || undefined,
  };

  if (isStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          write({ event: "hello", ts: Date.now() });
          (async () => {
            try {
              const result = await runDetectPage({ ...parsed, url }, write);
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

  const result = await runDetectPage({ ...parsed, url }, () => {});
  return NextResponse.json(result);
}
