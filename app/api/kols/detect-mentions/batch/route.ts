// app/api/kols/detect-mentions/batch/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { and, or, eq, lt, gte, desc, inArray, sql } from "drizzle-orm";
import { extractMentions, type Mention } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";
import {
  resolveTickersToContracts,
  resolveContractsToMeta,
  resolveNamesToContracts,
} from "@/lib/markets/geckoterminal";
import { canonAddr, isSolAddr } from "@/lib/chains/address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ========================= auth ========================= */
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

/* ========================= schema ========================= */
const Q = z.object({
  screen_name: z.string().min(1).default("*"),
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
  cursor: z.string().optional(), // base64url of {ts,id}
  stream: z.union([z.literal("1"), z.literal("true")]).optional(),
});

/* ========================= cursor helpers ========================= */
type Cursor = { ts: string; id: string }; // ts: ISO
function encCursor(c: Cursor) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
function decCursor(s?: string): Cursor | null {
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof j?.ts === "string" && typeof j?.id === "string") return j;
  } catch {}
  return null;
}

/* ========================= CA reconstruct (conservative) ========================= */
const SOL_CA_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
function collectFromPumpFun(text: string): string[] {
  const out: string[] = [];
  const RE = /pump\.fun\/coin\/([^\s]{1,90})/gi;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const tail = m[1] || "";
    const rest = text.slice(RE.lastIndex, RE.lastIndex + 160);
    const more = (rest.match(/[1-9A-HJ-NP-Za-km-z]{2,}/g) || []).join("");
    const candidate = (tail + more).replace(/[^1-9A-HJ-NP-Za-km-z]+/g, "");
    const clipped = candidate.slice(0, 64);
    for (let L = Math.min(44, clipped.length); L >= 32; L--) {
      const head = clipped.slice(0, L);
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(head)) {
        out.push(head);
        break;
      }
    }
  }
  return out;
}
function collectJoinedPairs(text: string): string[] {
  const out: string[] = [];
  const SPLIT2 =
    /\b([1-9A-HJ-NP-Za-km-z]{8,20})\s+([1-9A-HJ-NP-Za-km-z]{16,44})\b/g;
  let m: RegExpExecArray | null;
  while ((m = SPLIT2.exec(text)) !== null) {
    const joined = (m[1] + m[2]).trim();
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(joined)) out.push(joined);
  }
  return out;
}
function filterCAKeepMaximal(cas: string[]): Set<string> {
  const uniq = Array.from(new Set(cas));
  const keep = new Set<string>();
  for (const a of uniq) {
    let isSub = false;
    for (const b of uniq) {
      if (a === b) continue;
      if (b.includes(a)) {
        isSub = true;
        break;
      }
    }
    if (!isSub) keep.add(a);
  }
  return keep;
}
function reconstructCAsFromTweet(text: string): Set<string> {
  const plain = (text || "").match(SOL_CA_RE) ?? [];
  const fromPump = collectFromPumpFun(text || "");
  const joined = collectJoinedPairs(text || "");
  return filterCAKeepMaximal([...plain, ...fromPump, ...joined]);
}

/* ========================= trigger helpers ========================= */
function triggerInputFor(m: Mention) {
  if (m.source === "phrase") return m.tokenDisplay || m.tokenKey || "";
  if (m.source === "ca") return m.tokenKey || "";
  if (m.tokenDisplay?.startsWith("$")) return m.tokenDisplay;
  return `$${String(m.tokenKey || "").toUpperCase()}`;
}
function makeDeterministicTriggerKey(m: Mention): string {
  if (m.source === "ca") {
    const addr = canonAddr(String(m.tokenKey || ""));
    return addr ? `ca:${addr}` : "ca:unknown";
  }
  if (m.source === "ticker")
    return `tk:${String(m.tokenKey || "").toLowerCase()}`;
  if (m.source === "phrase")
    return `ph:${String(m.tokenKey || "").toLowerCase()}`;
  return `uk:${String(m.tokenKey || "").toLowerCase()}`;
}

/* ========================= one-page runner ========================= */
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
  const isAll = screen_name === "*" || screen_name.toLowerCase() === "all";
  const handle = isAll
    ? null
    : screen_name.trim().replace(/^@+/, "").toLowerCase();

  log({
    event: "start",
    handle: handle ?? "*",
    days,
    missingOnly,
    limit,
    cursor: cursor ?? null,
  });

  // time window
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // paging cursor
  const c = decCursor(cursor || undefined);
  const cursorTs = c ? new Date(c.ts) : null;
  const cursorId = c?.id ?? null;

  // base where
  const baseWhere = isAll
    ? and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until))
    : and(
        eq(kolTweets.twitterUsername, handle!),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      );

  // cursor where (order: publishDate DESC, tweetId DESC)
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

  // fetch one page
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

  // missingOnly: drop tweets that already have mentions
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

  // collect mentions
  type Tuple = {
    tweetId: string;
    m: Mention;
    triggerKey: string;
    triggerText: string;
  };
  const all: Tuple[] = [];
  const uniqueTickers = new Set<string>();
  const phraseNames = new Set<string>();
  const caSet = new Set<string>();

  for (const t of candidates) {
    const rebuiltCAs = reconstructCAsFromTweet(t.textContent ?? "");
    let ext = extractMentions(t.textContent ?? "");
    if (rebuiltCAs.size) {
      ext = ext.filter((x) => x.source !== "ca");
      for (const addr of rebuiltCAs) {
        ext.push({
          tokenKey: addr,
          tokenDisplay: addr,
          source: "ca",
          confidence: 100,
        } as Mention);
      }
    }
    for (const m of ext) {
      const input = triggerInputFor(m);
      let triggerKey = "";
      let triggerText = "";

      if (m.source === "ca") {
        const addr = String(m.tokenKey || "");
        triggerKey = makeDeterministicTriggerKey(m);
        triggerText = addr || input;
      } else {
        const built = buildTriggerKeyWithText({
          source: m.source as any,
          value: input,
        });
        triggerKey = (built as any)?.key || makeDeterministicTriggerKey(m);
        triggerText = (built as any)?.text || input;
      }

      all.push({ tweetId: t.tweetId, m, triggerKey, triggerText });

      if (m.source === "ca") {
        const addr = canonAddr(String(m.tokenKey || ""));
        if (addr) caSet.add(addr);
      } else if (m.source === "ticker") {
        const tk = m.tokenDisplay?.startsWith("$")
          ? m.tokenDisplay
          : `$${String(m.tokenKey || "").toUpperCase()}`;
        uniqueTickers.add(tk);
      } else if (m.source === "phrase") {
        const name = (m.tokenDisplay || m.tokenKey || "").trim();
        if (name) phraseNames.add(name);
      }
    }
  }

  log({
    event: "extracted",
    tickers: uniqueTickers.size,
    names: phraseNames.size,
    cas: caSet.size,
  });

  // resolve
  let byTicker = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  let byName = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();

  try {
    log({ event: "resolve_tickers_begin", count: uniqueTickers.size });
    byTicker = await resolveTickersToContracts([...uniqueTickers]);
    log({ event: "resolve_tickers_done" });
  } catch (e) {
    log({ event: "resolve_tickers_failed", error: String(e) });
  }
  try {
    log({ event: "resolve_names_begin", count: phraseNames.size });
    byName = await resolveNamesToContracts([...phraseNames]);
    log({ event: "resolve_names_done" });
  } catch (e) {
    log({ event: "resolve_names_failed", error: String(e) });
  }

  const byContract = new Map<
    string,
    { tokenDisplay: string; boostedConf: number }
  >();
  for (const [, r] of byTicker.entries()) {
    const addr = canonAddr(String(r.tokenKey || ""));
    if (addr)
      byContract.set(addr, {
        tokenDisplay: r.tokenDisplay,
        boostedConf: r.boostedConf,
      });
  }

  const missingCA = Array.from(caSet).filter((a) => !byContract.has(a));
  if (missingCA.length) {
    log({ event: "resolve_ca_begin", count: missingCA.length });
    try {
      const caMeta = await resolveContractsToMeta(missingCA);
      for (const [addr, meta] of caMeta.entries()) {
        byContract.set(addr, {
          tokenDisplay: meta.tokenDisplay,
          boostedConf: meta.boostedConf,
        });
      }
      log({ event: "resolve_ca_done", hit: Array.from(caMeta.keys()).length });
    } catch (e) {
      log({ event: "resolve_ca_failed", error: String(e) });
    }
  }

  // build rows
  type Row = {
    tweetId: string;
    tokenKey: string;
    tokenDisplay: string | null;
    confidence: number;
    source: (typeof mentionSource.enumValues)[number];
    triggerKey: string;
    triggerText: string | null;
  };
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const { tweetId, m, triggerKey, triggerText } of all) {
    let tokenKey = m.tokenKey;
    let tokenDisplay = m.tokenDisplay;
    let confidence = m.confidence;

    if (m.source === "ca") {
      const addr = canonAddr(String(m.tokenKey || ""));
      tokenKey = addr;
      const meta = addr ? byContract.get(addr) : undefined;
      if (meta?.tokenDisplay) {
        tokenDisplay = meta.tokenDisplay;
        confidence = Math.max(confidence, meta.boostedConf ?? 0);
      } else {
        tokenDisplay = `$${addr?.slice(0, 4)}…${addr?.slice(-4)}`;
      }
    } else if (m.source === "ticker") {
      const disp = m.tokenDisplay?.startsWith("$")
        ? m.tokenDisplay
        : `$${String(m.tokenKey || "").toUpperCase()}`;
      const r = byTicker.get(disp.replace(/^\$+/, "").toLowerCase());
      if (r) {
        tokenKey = r.tokenKey;
        tokenDisplay = r.tokenDisplay;
        confidence = Math.max(confidence, r.boostedConf);
      }
    } else if (m.source === "phrase") {
      const q = (m.tokenDisplay || m.tokenKey || "").trim().toLowerCase();
      const r = byName.get(q) ?? byName.get(`${q} coin`); // 容错
      if (!r) continue; // 不落库未命中 phrase
      tokenKey = r.tokenKey;
      tokenDisplay = r.tokenDisplay;
      confidence = Math.max(confidence, r.boostedConf);
    }

    const key = `${tweetId}___${triggerKey}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      tweetId,
      tokenKey: canonAddr(String(tokenKey || "")),
      tokenDisplay: tokenDisplay ?? (m.tokenDisplay || m.tokenKey),
      confidence: Math.min(100, Math.max(0, Math.round(confidence))),
      source: m.source as any,
      triggerKey,
      triggerText,
    });
  }

  if (!rows.length) {
    // next cursor
    const last = page[page.length - 1];
    const nextCursor = last
      ? encCursor({ ts: last.published.toISOString(), id: last.tweetId })
      : null;
    log({ event: "done", rows: 0, inserted: 0, updated: 0, nextCursor });
    return {
      ok: true,
      handle: handle ?? "*",
      days,
      scannedTweets: candidates.length,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
      nextCursor,
    };
  }

  // pre-check for counts
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

  // upsert chunked
  const CH = 200;
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH);
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

  // next cursor by整个 page 的最后一条（与排序一致）
  const last = page[page.length - 1];
  const nextCursor = last
    ? encCursor({ ts: last.published.toISOString(), id: last.tweetId })
    : null;

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
    scannedTweets: candidates.length,
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
          // 立刻吐一行，避免 Vercel 空闲超时
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

/* ========================= POST （可选，同 GET） ========================= */
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

  // body 支持 JSON；若无 body，走 query fallback
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
