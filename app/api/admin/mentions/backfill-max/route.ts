// app/api/admin/mentions/backfill-max/route.ts
// All comments in English as requested by your convention.

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { computeMaxPairsForCA } from "@/lib/pricing/mentionMax";
// Ensure proxy is active in this worker too (defensive)
import "@/lib/net/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- helpers ----------
function parseBool(input: string | null | undefined, def: boolean): boolean {
  if (input == null) return def;
  const v = String(input).trim().toLowerCase();
  if (["1", "true", "t", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(v)) return false;
  return def;
}

// ---- Query schema (numbers/strings only; booleans用自定义解析) ----
const Q = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  concurrency: z.coerce.number().int().min(1).max(8).default(3),
  network: z.string().optional(), // e.g. "solana" | "ethereum"
  poolMode: z.enum(["primary", "top3"]).optional().default("primary"),
  minVolume: z.coerce.number().min(0).default(0),
  minuteAgg: z.coerce.number().int().min(1).max(60).optional().default(15),
  // booleans 改为字符串读取后自行解析
  minutePatch: z.string().optional(),
  updateAll: z.string().optional(),
  // 额外提供一个显式“只扫空值”的开关（优先级更高）
  onlyNulls: z.string().optional(),
});

type Group = {
  ca: string;
  items: { id: string; tokenKey: string; publishDate: string }[];
};

// Shape of a row returned by the raw SQL above
type QRow = {
  id: string;
  tokenKey: string;
  publishDate: string;
  ca: string;
};

// ----------------------- DB loader (grouped by CA) -----------------------
async function loadMentionGroups(
  days: number,
  limit: number,
  updateAll: boolean,
): Promise<Group[]> {
  try {
    const res = await db.execute<QRow>(sql/* sql */ `
      WITH cand AS (
        SELECT
          m.id,
          m.token_key AS "tokenKey",
          m.max_price_since_mention,
          m.max_price_at_since_mention,
          kt.publish_date AS "publishDate",
          m.token_key AS ca
        FROM tweet_token_mentions m
        JOIN kol_tweets kt
          ON kt.tweet_id = m.tweet_id
        WHERE kt.publish_date >= NOW() - (${days}::int * interval '1 day')
          AND m.token_key IS NOT NULL
          AND m.token_key != ''
          AND (
            ${sql.raw(updateAll ? "TRUE" : "(m.max_price_since_mention IS NULL OR m.max_price_at_since_mention IS NULL)")}
          )
        ORDER BY m.token_key, kt.publish_date ASC
        LIMIT ${limit}
      )
      SELECT * FROM cand;
    `);

    const map = new Map<string, Group>();
    const rows = res.rows as QRow[];
    for (const r of rows) {
      const ca = String(r.ca);
      const g = map.get(ca) ?? { ca, items: [] };
      g.items.push({
        id: String(r.id),
        tokenKey: String(r.tokenKey),
        publishDate: String(r.publishDate),
      });
      map.set(ca, g);
    }
    return [...map.values()];
  } catch (e: any) {
    const msg = (e?.message ?? e)?.toString?.() ?? String(e);
    throw new Error(`Failed query (loadMentionGroups): ${msg}`);
  }
}

// ---------------------------- SSE handler ----------------------------
async function handleSSE(req: NextRequest) {
  const url = new URL(req.url);
  const q = Q.parse({
    days: url.searchParams.get("days") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    concurrency: url.searchParams.get("concurrency") ?? undefined,
    network: url.searchParams.get("network") ?? undefined,
    poolMode: url.searchParams.get("poolMode") ?? undefined,
    minVolume: url.searchParams.get("minVolume") ?? undefined,
    minuteAgg: url.searchParams.get("minuteAgg") ?? undefined,
    minutePatch: url.searchParams.get("minutePatch") ?? undefined,
    updateAll: url.searchParams.get("updateAll") ?? undefined,
    onlyNulls: url.searchParams.get("onlyNulls") ?? undefined,
  });

  // 统一、可靠的布尔解析（支持 0/1/true/false/on/off）
  const minutePatch = parseBool(q.minutePatch, true);
  // 若用户显式传 onlyNulls=true，则强制 updateAll=false
  const onlyNulls = parseBool(q.onlyNulls, false);
  const updateAllRaw = parseBool(q.updateAll, false);
  const updateAll = onlyNulls ? false : updateAllRaw;

  const finalParams = {
    days: q.days,
    limit: q.limit,
    concurrency: q.concurrency,
    network: q.network,
    poolMode: q.poolMode,
    minVolume: q.minVolume,
    minuteAgg: q.minuteAgg,
    minutePatch,
    updateAll,
    onlyNulls,
  };

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const write = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        const comment = (txt: string) =>
          controller.enqueue(encoder.encode(`:${txt}\n\n`));

        // Heartbeat immediately so the client sees output at once
        comment("heartbeat");
        write({ evt: "start", params: finalParams });

        try {
          const t0 = Date.now();
          const groups = await loadMentionGroups(
            finalParams.days,
            finalParams.limit,
            finalParams.updateAll,
          );

          const totalGroups = groups.length;
          let doneGroups = 0;
          write({ evt: "groups", count: totalGroups });

          if (!totalGroups) {
            write({ evt: "done", reason: "no_groups" });
            controller.close();
            return;
          }

          const progress = () => {
            const elapsed = (Date.now() - t0) / 1000;
            const pct = totalGroups ? (doneGroups / totalGroups) * 100 : 100;
            const avgPerGroup = doneGroups ? elapsed / doneGroups : 0;
            const remainSec = Math.max(0, (totalGroups - doneGroups) * avgPerGroup);
            write({
              evt: "progress",
              doneGroups,
              totalGroups,
              pct: Number.isFinite(pct) ? Number(pct.toFixed(2)) : 100,
              elapsedSec: Number(elapsed.toFixed(1)),
              etaSec: Number(remainSec.toFixed(1)),
            });
          };

          // Simple concurrency pool
          let idx = 0;
          const running: Promise<void>[] = [];

          const runOne = async () => {
            const g = groups[idx++];
            if (!g) return;

            write({ evt: "group_start", ca: g.ca, size: g.items.length });

            try {
              const pairs = await computeMaxPairsForCA(g.ca, g.items, {
                poolMode: finalParams.poolMode,
                minVolume: finalParams.minVolume,
                minutePatch: finalParams.minutePatch,
                minuteAgg: finalParams.minuteAgg,
                network: finalParams.network,
              });

              // Batch update per group in a single transaction
              await db.transaction(async (tx) => {
                let doneInGroup = 0;
                for (const it of g.items) {
                  const pair = pairs.get(it.id) ?? { maxPrice: null, maxAt: null };
                  await tx.execute(sql/* sql */ `
                    UPDATE tweet_token_mentions
                    SET
                      max_price_since_mention = ${pair.maxPrice},
                      max_price_at_since_mention = ${pair.maxAt}
                    WHERE id = ${it.id};
                  `);
                  doneInGroup++;
                  write({ evt: "group_progress", ca: g.ca, done: doneInGroup, total: g.items.length });
                }
              });

              doneGroups++;
              write({ evt: "group_done", ca: g.ca, updated: g.items.length });
              progress();
            } catch (err: any) {
              doneGroups++;
              write({ evt: "group_error", ca: g.ca, error: String(err?.message ?? err) });
              progress();
            }
            return runOne();
          };

          const conc = Math.max(1, Math.min(8, finalParams.concurrency));
          for (let c = 0; c < conc; c++) running.push(runOne());
          await Promise.all(running);

          write({ evt: "done" });
          controller.close();
        } catch (e: any) {
          write({ evt: "fatal", error: String(e?.message ?? e) });
          controller.close();
        }
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    },
  );
}

// Expose both GET (for curl -N) and POST, sharing the same SSE handler
export async function GET(req: NextRequest) {
  return handleSSE(req);
}
export async function POST(req: NextRequest) {
  return handleSSE(req);
}

