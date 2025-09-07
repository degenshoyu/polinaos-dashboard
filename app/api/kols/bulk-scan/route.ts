// app/api/kols/bulk-scan/route.ts

const ROUTE_ID = "/api/kols/bulk-scan";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** ===== Auth: admin OR x-cron-secret (?secret=...) ===== */
async function ensureAuth(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (isAdmin) return true;

  const secret = process.env.CRON_SECRET;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (secret && hdr && hdr === secret) return true;

  const qs = new URL(req.url).searchParams.get("secret");
  if (secret && qs && qs === secret) return true;

  return false;
}

/** ===== Small helpers ===== */
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function originOf(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return `${proto}://${host}`;
}

/** Lightweight p-limit (no deps) */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve).catch(reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** Per-item timeout */
function withTimeout<T>(p: Promise<T>, ms: number, label = "task"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timeout ${ms}ms`)),
      ms,
    );
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

/** ===== Input schema ===== */
const Body = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(5),
  concurrency: z.number().int().min(1).max(16).optional().default(3),
  offset: z.number().int().min(0).optional().default(0),
  itemTimeoutMs: z
    .number()
    .int()
    .min(3000)
    .max(120000)
    .optional()
    .default(30000),
  interDelayMs: z.number().int().min(0).max(5000).optional().default(0),
});

/** Optional GET for quick health-check (handy while testing) */
export async function GET() {
  return NextResponse.json({
    ok: true,
    routeId: ROUTE_ID,
    maxDuration,
    ts: new Date().toISOString(),
  });
}

/** ===== POST: stream logs in real-time ===== */
export async function POST(req: Request) {
  // Create a text stream so curl can see logs live
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const write = async (line: string) => {
    try {
      await writer.write(
        encoder.encode(line.endsWith("\n") ? line : line + "\n"),
      );
    } catch {
      /* client closed */
    }
  };
  const log = async (msg: string, obj?: unknown) => {
    const s = obj === undefined ? "" : " " + safePreview(obj);
    const line = `[${new Date().toISOString()}] ${msg}${s}`;
    console.log(line);
    await write(line);
  };
  const safePreview = (v: unknown) => {
    try {
      const s = JSON.stringify(v);
      return s.length > 800 ? s.slice(0, 800) + "...(trunc)" : s;
    } catch {
      return String(v);
    }
  };

  // Kick off async handler; return the stream immediately
  (async () => {
    const startedAt = Date.now();

    try {
      // Auth
      if (!(await ensureAuth(req))) {
        await log("forbidden: auth failed");
        await write(
          JSON.stringify({ routeId: ROUTE_ID, ok: false, error: "forbidden" }) +
            "\n",
        );
        await writer.close();
        return;
      }

      // Body
      let body: z.infer<typeof Body>;
      try {
        body = Body.parse(await req.json().catch(() => ({})));
      } catch (e: any) {
        await log("bad request: invalid body", e?.message);
        await write(
          JSON.stringify({
            routeId: ROUTE_ID,
            ok: false,
            error: "bad_request",
          }) + "\n",
        );
        await writer.close();
        return;
      }

      // Clamp inputs
      const LIMIT = clamp(body.limit ?? 5, 1, 5);
      const CONCURRENCY = clamp(body.concurrency ?? 3, 1, 3);
      const OFFSET = clamp(body.offset ?? 0, 0, 10_000_000);
      const ITEM_TIMEOUT_MS = clamp(body.itemTimeoutMs ?? 30000, 3000, 120000);
      const INTER_DELAY_MS = clamp(body.interDelayMs ?? 0, 0, 5000);
      await log("input", {
        LIMIT,
        CONCURRENCY,
        OFFSET,
        ITEM_TIMEOUT_MS,
        INTER_DELAY_MS,
      });

      // Select targets in deterministic order (username ASC)
      const targets =
        (await db
          .select({ twitterUsername: kols.twitterUsername })
          .from(kols)
          .orderBy(asc(kols.twitterUsername))
          .limit(LIMIT)
          .offset(OFFSET)) ?? [];

      await log("targets selected", {
        count: targets.length,
        sample: targets.slice(0, 3),
      });

      if (targets.length === 0) {
        const durationMs = Date.now() - startedAt;
        await write(
          JSON.stringify({
            routeId: ROUTE_ID,
            ok: true,
            scanned: 0,
            offset: OFFSET,
            limit: LIMIT,
            nextOffset: OFFSET,
            durationMs,
          }) + "\n",
        );
        await writer.close();
        return;
      }

      const origin = originOf(req);
      const secret =
        req.headers.get("x-cron-secret") || process.env.CRON_SECRET || "";
      const limit = pLimit(CONCURRENCY);

      let okCount = 0;
      let failCount = 0;

      // Queue tasks with concurrency
      const tasks = targets.map((t, idx) =>
        limit(async () => {
          if (INTER_DELAY_MS > 0 && idx > 0) await sleep(INTER_DELAY_MS);

          const handle = String(t.twitterUsername || "").toLowerCase();
          const t0 = Date.now();

          try {
            const res = await withTimeout(
              fetch(`${origin}/api/kols/scan-tweets`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...(secret ? { "x-cron-secret": secret } : {}),
                },
                body: JSON.stringify({ screen_name: handle }),
                cache: "no-store",
              }),
              ITEM_TIMEOUT_MS,
              `scan(@${handle})`,
            );

            const txt = await res.text();
            let parsed: any = null;
            try {
              parsed = JSON.parse(txt);
            } catch {
              parsed = { preview: txt.slice(0, 500) };
            }

            const EXPECTED_SCAN_ID = "/api/kols/scan-tweets";
            if (
              parsed &&
              typeof parsed === "object" &&
              "routeId" in parsed &&
              parsed.routeId !== EXPECTED_SCAN_ID
            ) {
              failCount++;
              await log(`FAIL @${handle} wrong-route`, {
                got: parsed?.routeId,
                expect: EXPECTED_SCAN_ID,
                ms: Date.now() - t0,
              });
              return;
            }

            if (res.ok) {
              okCount++;
              await log(`OK @${handle}`, {
                status: res.status,
                inserted: parsed?.inserted,
                dupes: parsed?.dupes,
                totals: parsed?.totals,
                scanned: parsed?.scanned,
                reason: parsed?.reason,
                ms: Date.now() - t0,
              });
            } else {
              failCount++;
              await log(`FAIL @${handle}`, {
                status: res.status,
                body: parsed,
                ms: Date.now() - t0,
              });
            }
          } catch (e: any) {
            failCount++;
            await log(`EXC  @${handle}`, {
              error:
                e?.name === "AbortError" ? "timeout" : String(e?.message ?? e),
              ms: Date.now() - t0,
            });
          }
        }),
      );

      // Wait for all tasks
      await Promise.allSettled(tasks);

      const durationMs = Date.now() - startedAt;
      await log("page done", { okCount, failCount, durationMs });

      // Final JSON line (so scripts can parse)
      await write(
        JSON.stringify({
          routeId: ROUTE_ID,
          ok: true,
          scanned: targets.length,
          okCount,
          failCount,
          offset: OFFSET,
          limit: LIMIT,
          nextOffset: OFFSET + targets.length,
          durationMs,
        }) + "\n",
      );
    } catch (e: any) {
      await log("fatal error", String(e?.message ?? e));
      try {
        await write(
          JSON.stringify({
            routeId: ROUTE_ID,
            ok: false,
            error: "fatal",
            reason: String(e?.message ?? e),
          }) + "\n",
        );
      } catch {}
    } finally {
      try {
        await writer.close();
      } catch {}
    }
  })();

  // Immediately return the streaming response
  return new Response(readable, {
    status: 200,
    headers: {
      // text/plain makes curl stream nicely; you can switch to text/event-stream (SSE) if you prefer.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Vercel/Edge uses chunked encoding automatically for streams
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
    },
  });
}
