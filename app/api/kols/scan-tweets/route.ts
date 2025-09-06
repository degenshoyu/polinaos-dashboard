// app/api/kols/bulk-scan/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give ourselves headroom, but still keep each invocation small/fast.
export const maxDuration = 300;

/** ===== Auth: allow admin session OR x-cron-secret (?secret=...) ===== */
async function ensureAuth(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (isAdmin) return true;

  const secret = process.env.CRON_SECRET;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  if (secret && hdr && hdr === secret) return true;

  const url = new URL(req.url);
  const qs = url.searchParams.get("secret");
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

/** Lightweight p-limit */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    if (queue.length > 0) queue.shift()?.();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn()
          .then((v) => resolve(v))
          .catch(reject)
          .finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** Per-item timeout wrapper for fetch/any promise */
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

/** ===== Input schema =====
 * We accept limit / concurrency / offset from caller,
 * but we will clamp them to safe small values.
 */
const Body = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(5),
  concurrency: z.number().int().min(1).max(16).optional().default(3),
  offset: z.number().int().min(0).optional().default(0),
  // Optional per-item timeout (ms), default 30s
  itemTimeoutMs: z
    .number()
    .int()
    .min(3000)
    .max(120000)
    .optional()
    .default(30000),
  // Optional small delay between items batches (ms) to reduce pressure.
  interDelayMs: z.number().int().min(0).max(5000).optional().default(0),
});

/** ===== POST /api/kols/bulk-scan ===== */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const logs: string[] = []; // We will also console.log them.

  function log(msg: string, obj?: unknown) {
    const line = `[${new Date().toISOString()}] ${msg}${
      obj !== undefined ? ` ${safePreview(obj)}` : ""
    }`;
    logs.push(line);
    // Also print to Vercel logs:
    console.log(line);
  }

  function safePreview(obj: unknown) {
    try {
      const s = JSON.stringify(obj);
      return s.length > 800 ? s.slice(0, 800) + "...(trunc)" : s;
    } catch {
      return String(obj);
    }
  }

  // --- Auth ---
  if (!(await ensureAuth(req))) {
    log("forbidden: auth failed");
    return NextResponse.json(
      { ok: false, error: "forbidden", logs },
      { status: 403 },
    );
  }

  // --- Parse input and clamp ---
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e: any) {
    log("bad request: invalid body", e?.message);
    return NextResponse.json(
      { ok: false, error: "bad_request", logs },
      { status: 400 },
    );
  }

  const LIMIT = clamp(body.limit ?? 5, 1, 5); // hard clamp to 5
  const CONCURRENCY = clamp(body.concurrency ?? 3, 1, 3); // hard clamp to 3
  const OFFSET = clamp(body.offset ?? 0, 0, 10_000_000);
  const ITEM_TIMEOUT_MS = clamp(body.itemTimeoutMs ?? 30000, 3000, 120000);
  const INTER_DELAY_MS = clamp(body.interDelayMs ?? 0, 0, 5000);

  log("input", { LIMIT, CONCURRENCY, OFFSET, ITEM_TIMEOUT_MS, INTER_DELAY_MS });

  // --- Select targets: ORDER BY twitter_username ASC for deterministic paging ---
  const targets =
    (await db
      .select({
        twitterUsername: kols.twitterUsername,
      })
      .from(kols)
      .orderBy(asc(kols.twitterUsername))
      .limit(LIMIT)
      .offset(OFFSET)) ?? [];

  log("targets selected", {
    count: targets.length,
    sample: targets.slice(0, 3),
  });

  if (targets.length === 0) {
    const durationMs = Date.now() - startedAt;
    log("no targets found for this page");
    return NextResponse.json(
      {
        ok: true,
        scanned: 0,
        offset: OFFSET,
        limit: LIMIT,
        nextOffset: OFFSET, // unchanged
        durationMs,
        logs,
      },
      { status: 200 },
    );
  }

  const origin = originOf(req);
  const secret =
    req.headers.get("x-cron-secret") || process.env.CRON_SECRET || "";
  const limiter = pLimit(CONCURRENCY);

  // Run scans with per-item timeout and concurrency limit
  let okCount = 0;
  let failCount = 0;
  const perItem: Array<{
    handle: string;
    ok: boolean;
    status?: number;
    error?: string;
    summary?: unknown;
    durationMs: number;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const handle = String(targets[i].twitterUsername || "").toLowerCase();

    // Optional small pacing between queueing tasks
    if (INTER_DELAY_MS > 0 && i > 0) {
      await sleep(INTER_DELAY_MS);
    }

    const task = async () => {
      const t0 = Date.now();
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), ITEM_TIMEOUT_MS);

      try {
        // We call our internal scan endpoint; it accepts x-cron-secret too.
        const res = await fetch(`${origin}/api/kols/scan-tweets`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(secret ? { "x-cron-secret": secret } : {}),
          },
          body: JSON.stringify({ screen_name: handle }),
          signal: ctrl.signal,
          cache: "no-store",
        });

        const txt = await res.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(txt);
        } catch {
          // not JSON; return preview
          parsed = { preview: txt.slice(0, 400) };
        }

        const item = {
          handle,
          ok: res.ok,
          status: res.status,
          summary: {
            inserted: parsed?.inserted,
            dupes: parsed?.dupes,
            totals: parsed?.totals,
            mentions_checked: parsed?.mentions_checked,
            mentions_rebuilt: parsed?.mentions_rebuilt,
          },
          durationMs: Date.now() - t0,
        };
        perItem.push(item);

        if (res.ok) {
          okCount++;
          log(`scan OK: @${handle}`, item.summary);
        } else {
          failCount++;
          log(`scan FAIL(${res.status}): @${handle}`, parsed);
        }
      } catch (e: any) {
        failCount++;
        const item = {
          handle,
          ok: false,
          error: e?.name === "AbortError" ? "timeout" : String(e?.message ?? e),
          durationMs: Date.now() - t0,
        };
        perItem.push(item);
        log(`scan EXCEPTION: @${handle}`, item);
      } finally {
        clearTimeout(to);
      }
    };

    // enqueue with concurrency limit
    await limiter(task);
  }

  // Wait a tick to flush all queued tasks
  // (our limiter resolves per task; if you want strict "all done", you can wait Promise.all over an array)
  // Here, tasks are awaited inline so we're already done.

  const durationMs = Date.now() - startedAt;
  log("bulk-scan page done", { okCount, failCount, durationMs });

  return NextResponse.json(
    {
      ok: true,
      scanned: targets.length,
      okCount,
      failCount,
      offset: OFFSET,
      limit: LIMIT,
      nextOffset: OFFSET + targets.length,
      durationMs,
      perItem,
      logs, // full verbose logs for curl-based debugging
    },
    { status: 200 },
  );
}
