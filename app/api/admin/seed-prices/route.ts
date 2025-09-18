/* app/api/admin/seed-prices/route.ts
 * Seed initial price snapshots into coin_price with streaming progress.
 * - Auth via Authorization: Bearer <CRON_SECRET>
 * - Sources: "mentions" | "catalog"
 * - Pagination + concurrency + 429 retry
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { coinPrice, tweetTokenMentions, coinCaTicker } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { RequestInit } from "next/dist/server/web/spec-extension/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------ Input schema ------------------ */
const Body = z.object({
  days: z.number().int().min(1).max(90).default(30),
  source: z.enum(["mentions", "catalog"]).default("mentions"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(200),
  limit: z.number().int().min(1).max(1000).optional(),
  pretty: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(2).default(1),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

type Opts = z.infer<typeof Body>;

/* ------------------ Small helpers ------------------ */
function bool(v: string | null | undefined) {
  return v === "1" || v === "true";
}
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
function nowIso() {
  return new Date().toISOString();
}

// SSE-ish emitter；pretty=true 时每行都带 data: 前缀 + 缩进
function makeEmitter(
  controller: ReadableStreamDefaultController,
  pretty: boolean,
) {
  return (obj: any) => {
    const text = JSON.stringify(obj, null, pretty ? 2 : 0);
    if (pretty) {
      const prefixed = "data: " + text.replace(/\n/g, "\ndata: ");
      controller.enqueue(prefixed + "\n\n");
    } else {
      controller.enqueue("data: " + text + "\n\n");
    }
  };
}

/* ------------------ Auth ------------------ */
function ensureAuth(req: NextRequest) {
  const sec = process.env.CRON_SECRET || "";
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m || m[1] !== sec) {
    const err = new Error("Unauthorized");
    (err as any).status = 401; // 给 catch 使用的自定义状态
    throw err;
  }
}

/* ------------------ GeckoTerminal fetch ------------------ */
// Try project helper first; fallback to GT simple API.
async function fetchSpotUsd(
  network: string,
  ca: string,
  init?: RequestInit,
): Promise<number | null> {
  try {
    const mod: any = await import("@/lib/pricing/geckoterminal");
    if (typeof mod.getSpotPriceUsd === "function") {
      const v = await mod.getSpotPriceUsd(network, ca, init);
      if (v != null) return v;
    }
    if (typeof mod.fetchSpotPriceUsd === "function") {
      const v = await mod.fetchSpotPriceUsd(network, ca, init);
      if (v != null) return v;
    }
    if (typeof mod.getLatestPriceUsd === "function") {
      const v = await mod.getLatestPriceUsd(network, ca, init);
      if (v != null) return v;
    }
    if (typeof mod.fetchPriceUsd === "function") {
      const v = await mod.fetchPriceUsd(network, ca, init);
      if (v != null) return v;
    }
  } catch {
    // ignore and try fallback
  }

  const url = `https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/${encodeURIComponent(ca)}`;
  const r = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers || {}) },
  });
  if (r.status === 429) {
    const e = new Error("429");
    (e as any).status = 429;
    throw e;
  }
  if (!r.ok) throw new Error(`GT HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}) as any);
  const map = j?.data?.attributes?.token_prices || {};
  const val = map[ca] ?? Object.values(map)[0];
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/* ------------------ DB helpers ------------------ */
async function hasRecentPriceInWindow(ca: string, since: Date) {
  const rows = await db
    .select({ id: coinPrice.id })
    .from(coinPrice)
    .where(
      and(eq(coinPrice.contractAddress, ca), gte(coinPrice.priceAt, since)),
    )
    .limit(1);
  return rows.length > 0;
}

async function insertSnapshot(ca: string, usd: number) {
  await db
    .insert(coinPrice)
    .values({
      contractAddress: ca,
      source: "geckoterminal",
      priceUsd: String(usd),
      // priceAt 默认 now()
    })
    .onConflictDoNothing();
}

/* ------------------ Candidates ------------------ */
async function getCandidatesFromMentions(
  opts: Opts,
  since: Date,
): Promise<string[]> {
  const offset = (opts.page - 1) * opts.pageSize;
  const res = await db.execute(sql`
    select token_key as ca, max(created_at) as last_seen
    from ${tweetTokenMentions}
    where ${tweetTokenMentions.excluded} = false
      and ${tweetTokenMentions.createdAt} >= ${since}
      and ${tweetTokenMentions.tokenKey} is not null
    group by ${tweetTokenMentions.tokenKey}
    order by last_seen desc
    limit ${opts.pageSize} offset ${offset}
  `);
  const rows = ((res as any)?.rows ?? []) as any[];
  const arr = rows.map((r) => String(r.ca)).filter(Boolean);
  return Array.from(new Set(arr));
}

async function getCandidatesFromCatalog(opts: Opts): Promise<string[]> {
  const offset = (opts.page - 1) * opts.pageSize;
  const res = await db.execute(sql`
    select ${coinCaTicker.contractAddress} as ca
    from ${coinCaTicker}
    order by ${coinCaTicker.priority} desc nulls last, ${coinCaTicker.updatedAt} desc
    limit ${opts.pageSize} offset ${offset}
  `);
  const rows = ((res as any)?.rows ?? []) as any[];
  const arr = rows.map((r) => String(r.ca)).filter(Boolean);
  return Array.from(new Set(arr));
}

/* ------------------ Concurrency mapper ------------------ */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = [];
  let i = 0;
  const pool: Promise<void>[] = [];
  async function runOne() {
    const idx = i++;
    if (idx >= items.length) return;
    try {
      const v = await fn(items[idx]);
      ret.push(v as any);
    } finally {
      await runOne();
    }
  }
  for (let c = 0; c < Math.min(limit, items.length); c++) {
    pool.push(runOne());
  }
  await Promise.all(pool);
  return ret;
}

/* ------------------ Handler ------------------ */
export async function POST(req: NextRequest) {
  try {
    ensureAuth(req);

    const url = new URL(req.url);
    const qsStream = bool(url.searchParams.get("stream"));
    const raw = await req.json().catch(() => ({}));
    const opts = Body.parse(raw);

    const since = new Date(Date.now() - opts.days * 86_400_000);

    if (!qsStream) {
      const summary = await runOnce(opts, since);
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const stream = new ReadableStream({
      start: async (controller) => {
        const emit = makeEmitter(controller, opts.pretty);
        emit({ ok: true, startAt: nowIso(), opts: { ...opts, stream: true } });
        try {
          const ret = await runOnce(opts, since, emit);
          emit({ ...ret, endAt: nowIso() });
        } catch (e: any) {
          emit({ ok: false, error: e?.message || String(e) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  } catch (e: any) {
    const status = e?.status ?? 500;
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Internal error" }),
      {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }
}

/* ------------------ Core worker ------------------ */
async function runOnce(opts: Opts, since: Date, emit?: (x: any) => void) {
  const t0 = Date.now();

  const candidates =
    opts.source === "mentions"
      ? await getCandidatesFromMentions(opts, since)
      : await getCandidatesFromCatalog(opts);

  const limited =
    typeof opts.limit === "number"
      ? candidates.slice(0, opts.limit)
      : candidates;

  emit?.({
    kind: "candidates",
    count: limited.length,
    page: opts.page,
    pageSize: opts.pageSize,
    source: opts.source,
  });

  let seeded = 0;
  let skipped = 0;
  const errors: Array<{ ca: string; reason: string }> = [];
  const saw429: string[] = [];
  const fail429: string[] = [];

  await mapLimit(limited, opts.concurrency, async (ca) => {
    const exists = await hasRecentPriceInWindow(ca, since);
    if (exists) {
      skipped++;
      emit?.({ kind: "skip", ca, reason: "already_seeded_recent" });
      return;
    }

    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const price = await fetchSpotUsd("solana", ca, {
          headers: { accept: "application/json" },
        });
        if (price == null || !Number.isFinite(price)) {
          skipped++;
          emit?.({ kind: "skip", ca, reason: "no_price" });
          return;
        }
        await insertSnapshot(ca, price);
        seeded++;
        emit?.({
          kind: "fetch",
          ca,
          ok: true,
          priceUsd: price,
          source: "geckoterminal",
          priceAt: nowIso(),
        });
        return;
      } catch (err: any) {
        const is429 =
          err?.status === 429 || /429/.test(String(err?.message || err));
        if (is429) {
          if (!saw429.includes(ca)) saw429.push(ca);
          if (attempt <= opts.maxRetries) {
            const backoff = Math.min(15_000, 500 * 2 ** (attempt - 1));
            emit?.({ kind: "ratelimit", ca, attempt, backoffMs: backoff });
            await sleep(backoff);
            continue;
          }
          fail429.push(ca);
          skipped++;
          emit?.({ kind: "skip", ca, reason: "ratelimited_exhausted" });
          return;
        }
        errors.push({ ca, reason: err?.message || "fetch_failed" });
        emit?.({ kind: "error", ca, message: err?.message || String(err) });
        skipped++;
        return;
      }
    }
  });

  const dtMs = Date.now() - t0;
  return {
    ok: true,
    requested: typeof opts.limit === "number" ? opts.limit : opts.pageSize,
    seeded,
    skipped,
    errors,
    resolved: limited.length,
    saw429,
    fail429,
    page: opts.page,
    pageSize: opts.pageSize,
    source: opts.source,
    tookMs: dtMs,
  };
}
