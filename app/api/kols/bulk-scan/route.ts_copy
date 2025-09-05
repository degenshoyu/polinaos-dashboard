// app/api/kols/bulk-scan/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { sql, asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** -------- Input schema -------- */
const Body = z.object({
  // Optional: explicit list of handles (@ optional, case-insensitive)
  handles: z.array(z.string().min(1)).optional(),
  // Scan window for each handle (hours)
  windowHours: z.number().int().min(1).max(168).optional().default(24),
  // Concurrency level for parallel scans
  concurrency: z.number().int().min(1).max(6).optional().default(3),
  // Max time to wait for each handle's job inside /scan-tweets
  maxWaitMs: z
    .number()
    .int()
    .min(30_000)
    .max(1_800_000)
    .optional()
    .default(1_200_000),
  // Poll interval passed to /scan-tweets
  pollIntervalMs: z
    .number()
    .int()
    .min(250)
    .max(3_000)
    .optional()
    .default(1_000),
  // If handles is empty, pull up to 'limit' KOLs from DB (ordered by recent activity if available)
  limit: z.number().int().min(1).max(2000).optional().default(250),
});

/** -------- Helpers -------- */
const norm = (h: string) => h.trim().replace(/^@+/, "").toLowerCase();
const ORIGIN = (req: Request) => {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return `${proto}://${host}`;
};

/** Basic concurrency control without external deps */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  iter: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        results[idx] = await iter(items[idx], idx);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** Allow either admin session OR x-cron-secret header */
async function ensureAuth(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  if (isAdmin) return true;
  const secret = process.env.CRON_SECRET;
  const hdr = req.headers.get("x-cron-secret") ?? "";
  return Boolean(secret && hdr && secret === hdr);
}

/** POST /api/kols/bulk-scan */
export async function POST(req: Request) {
  if (!(await ensureAuth(req))) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const origin = ORIGIN(req);
  const cookie = req.headers.get("cookie") ?? "";

  const {
    handles: inputHandles,
    windowHours,
    concurrency,
    maxWaitMs,
    pollIntervalMs,
    limit,
  } = Body.parse(await req.json().catch(() => ({})));

  // 1) Resolve handle list
  let handles: string[] = [];
  if (inputHandles?.length) {
    handles = Array.from(new Set(inputHandles.map(norm))).filter(Boolean);
  } else {
    // Pull from DB; prefer recently seen or by id
    const rows = await db
      .select({ handle: kols.twitterUsername })
      .from(kols)
      .orderBy(asc(kols.twitterUsername))
      .limit(limit);
    handles = rows
      .map((r) => String(r.handle || "").toLowerCase())
      .filter(Boolean);
  }

  if (!handles.length) {
    return NextResponse.json({ ok: true, total: 0, done: [], summary: {} });
  }

  // 2) Per-handle runner => call internal /api/kols/scan-tweets
  type PerHandleResult = {
    handle: string;
    ok: boolean;
    status: number;
    scanned?: number;
    inserted?: number;
    dupes?: number;
    totals?: unknown;
    mentions_checked?: number;
    mentions_skipped?: number;
    mentions_rebuilt?: number;
    mentions_inserted?: number;
    error?: string;
  };

  async function runOne(handle: string): Promise<PerHandleResult> {
    try {
      const res = await fetch(`${origin}/api/kols/scan-tweets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
          // Forward cron secret too (if this route is called by Cron)
          ...(req.headers.get("x-cron-secret")
            ? { "x-cron-secret": req.headers.get("x-cron-secret")! }
            : {}),
        },
        body: JSON.stringify({
          screen_name: handle,
          windowHours,
          pollIntervalMs,
          maxWaitMs,
          // NOTE: /scan-tweets Body uses zod: extra fields are ignored by default,
          // so we don't pass bulk-specific options here to avoid schema mismatch.
        }),
        cache: "no-store",
      });

      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: "non-json", preview: text.slice(0, 400) };
      }

      return {
        handle,
        ok: res.ok && Boolean(json?.ok !== false),
        status: res.status,
        scanned: Number(json?.scanned ?? 0),
        inserted: Number(json?.inserted ?? 0),
        dupes: Number(json?.dupes ?? 0),
        totals: json?.totals ?? null,
        mentions_checked: Number(json?.mentions_checked ?? 0),
        mentions_skipped: Number(json?.mentions_skipped ?? 0),
        mentions_rebuilt: Number(json?.mentions_rebuilt ?? 0),
        mentions_inserted: Number(json?.mentions_inserted ?? 0),
        error: res.ok
          ? undefined
          : String(json?.error ?? json?.reason ?? "scan failed"),
      };
    } catch (e: any) {
      return {
        handle,
        ok: false,
        status: 500,
        error: String(e?.message ?? e),
      };
    }
  }

  // 3) Execute with concurrency
  const startedAt = Date.now();
  const done = await mapLimit(handles, concurrency, runOne);
  const durationMs = Date.now() - startedAt;

  // 4) Aggregate summary
  const okCount = done.filter((d) => d.ok).length;
  const failed = done.filter((d) => !d.ok);
  const summary = {
    totalHandles: handles.length,
    ok: okCount,
    failed: failed.length,
    scanned: done.reduce((s, d) => s + (d.scanned || 0), 0),
    inserted: done.reduce((s, d) => s + (d.inserted || 0), 0),
    mentionsChecked: done.reduce((s, d) => s + (d.mentions_checked || 0), 0),
    mentionsRebuilt: done.reduce((s, d) => s + (d.mentions_rebuilt || 0), 0),
    mentionsInserted: done.reduce((s, d) => s + (d.mentions_inserted || 0), 0),
    durationMs,
    windowHours,
    concurrency,
  };

  return NextResponse.json({ ok: true, total: handles.length, done, summary });
}
