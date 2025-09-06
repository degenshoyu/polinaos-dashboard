// app/api/kols/cron-detect/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets } from "@/lib/db/schema";
import { gte } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { POST as DetectMentions } from "@/app/api/kols/detect-mentions/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const DEFAULT_CONCURRENCY = 4;

const Body = z.object({
  handles: z.array(z.string().min(1)).optional(),
  days: z.number().int().min(1).max(30).optional().default(DEFAULT_DAYS),
  missingOnly: z.boolean().optional().default(true),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(16)
    .optional()
    .default(DEFAULT_CONCURRENCY),
});

function ok<T>(data: T, init: number = 200) {
  return NextResponse.json(
    { ok: true, ...((data as any) ?? {}) },
    { status: init },
  );
}
function err(message: string, init: number = 400) {
  return NextResponse.json({ ok: false, error: message }, { status: init });
}

/** Allow GET when:
 *  - has valid ?secret=... equals process.env.CRON_SECRET
 *  - OR request has typical Vercel Cron header (x-vercel-cron / x-vercel-schedule)
 * POST requires admin session.
 */
function isCronRequest(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const goodSecret =
    process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  const hasVercelHeader =
    req.headers.has("x-vercel-cron") || req.headers.has("x-vercel-schedule");
  return Boolean(goodSecret || hasVercelHeader);
}

async function listActiveHandles(days: number): Promise<string[]> {
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));

  const rows = await db
    .select({ handle: kolTweets.twitterUsername })
    .from(kolTweets)
    .where(gte(kolTweets.publishDate, since));

  const set = new Set<string>();
  for (const r of rows) {
    const h = (r.handle ?? "").trim().replace(/^@+/, "").toLowerCase();
    if (h) set.add(h);
  }
  return Array.from(set);
}

async function runDetectForHandle(
  handle: string,
  days: number,
  missingOnly: boolean,
) {
  const req = new Request("http://internal/api/kols/detect-mentions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screen_name: handle, days, missingOnly }),
  });
  const res = await DetectMentions(req);
  // NextResponse extends Web Response — .json() is available
  const j = await res.json().catch(() => ({}));
  return j as {
    ok: boolean;
    inserted?: number;
    updated?: number;
    mentionsDetected?: number;
  };
}

async function runInBatches<T, R>(
  items: T[],
  limit: number,
  worker: (t: T) => Promise<R>,
) {
  const results: R[] = [];
  let idx = 0;
  const inflight = new Set<Promise<void>>();

  async function spawn(t: T) {
    const p = (async () => {
      const r = await worker(t);
      results.push(r);
    })().finally(() => inflight.delete(p));
    inflight.add(p);
  }

  while (idx < items.length || inflight.size > 0) {
    while (idx < items.length && inflight.size < limit) {
      await spawn(items[idx++]);
    }
    if (inflight.size > 0) {
      await Promise.race(inflight);
    }
  }
  return results;
}

/* ------------------- GET (cron) ------------------- */
export async function GET(req: Request) {
  if (!isCronRequest(req)) {
    return err("forbidden", 403);
  }
  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(30, Number(url.searchParams.get("days") ?? DEFAULT_DAYS)),
  );
  const missingOnly = url.searchParams.get("missingOnly") !== "false";
  const concurrency = Math.max(
    1,
    Math.min(
      16,
      Number(url.searchParams.get("concurrency") ?? DEFAULT_CONCURRENCY),
    ),
  );

  // If handles=... is passed (comma-separated), use it; else auto-list from kolTweets
  const handlesParam = url.searchParams.get("handles");
  const handles = handlesParam
    ? handlesParam
        .split(",")
        .map((s) => s.trim().replace(/^@+/, "").toLowerCase())
        .filter(Boolean)
    : await listActiveHandles(days);

  if (!handles.length) return ok({ scanned: 0, handles: [] });

  const results = await runInBatches(handles, concurrency, (h) =>
    runDetectForHandle(h, days, missingOnly),
  );

  let inserted = 0,
    updated = 0,
    detected = 0,
    failures: Array<{ handle: string; error?: string }> = [];

  results.forEach((r, i) => {
    if ((r as any)?.ok) {
      inserted += Number(r.inserted ?? 0);
      updated += Number(r.updated ?? 0);
      detected += Number(r.mentionsDetected ?? 0);
    } else {
      failures.push({
        handle: handles[i],
        error: (r as any)?.error ?? "unknown",
      });
    }
  });

  return ok({
    scanned: handles.length,
    handles,
    inserted,
    updated,
    mentionsDetected: detected,
    failures,
  });
}

/* ------------------- POST (manual, admin) ------------------- */
export async function POST(req: Request) {
  // admin only
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (!isAdmin) return err("forbidden", 403);

  const body = Body.parse(await req.json().catch(() => ({})));
  const { handles: inputHandles, days, missingOnly, concurrency } = body;

  const handles =
    inputHandles && inputHandles.length
      ? inputHandles
          .map((s) => s.trim().replace(/^@+/, "").toLowerCase())
          .filter(Boolean)
      : await listActiveHandles(days);

  if (!handles.length) return ok({ scanned: 0, handles: [] });

  const results = await runInBatches(handles, concurrency, (h) =>
    runDetectForHandle(h, days, missingOnly),
  );

  let inserted = 0,
    updated = 0,
    detected = 0,
    failures: Array<{ handle: string; error?: string }> = [];

  results.forEach((r, i) => {
    if ((r as any)?.ok) {
      inserted += Number(r.inserted ?? 0);
      updated += Number(r.updated ?? 0);
      detected += Number(r.mentionsDetected ?? 0);
    } else {
      failures.push({
        handle: handles[i],
        error: (r as any)?.error ?? "unknown",
      });
    }
  });

  return ok({
    scanned: handles.length,
    handles,
    inserted,
    updated,
    mentionsDetected: detected,
    failures,
  });
}
