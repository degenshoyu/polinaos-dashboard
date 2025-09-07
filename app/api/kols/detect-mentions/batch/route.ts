// app/api/kols/detect-mentions/batch/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions, mentionSource } from "@/lib/db/schema";
import { eq, and, gte, lt, inArray, desc, sql } from "drizzle-orm";
import { extractMentions, type Mention } from "@/lib/tokens/extract";
import { buildTriggerKeyWithText } from "@/lib/tokens/triggerKey";
import {
  resolveTickersToContracts,
  resolveContractsToMeta,
  resolveNamesToContracts,
} from "@/lib/markets/geckoterminal";
import { canonAddr } from "@/lib/chains/address";

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

/* ========================= Cursor helpers ========================= */
// keyset: (publishDate DESC, tweetId DESC)
type Cursor = { ts: string; id: string }; // ISO date + tweetId

function encodeCursor(c: Cursor | null): string | null {
  if (!c) return null;
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodeCursor(s?: string | null): Cursor | null {
  if (!s) return null;
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof j?.ts === "string" && typeof j?.id === "string") return j;
  } catch {}
  return null;
}

/* ========================= Body schema ========================= */
const Body = z.object({
  screen_name: z.string().min(1), // handle or "*" | "all"
  days: z.number().int().min(1).max(30).optional().default(7),
  missingOnly: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(500).optional().default(200),
  cursor: z.string().optional(), // base64url Cursor
});

/* ========================= Trigger helpers ========================= */
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

/* ========================= CA reconstruction (conservative) ========================= */
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

/* ========================= Core of a single page ========================= */
async function runDetectPage(
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    limit: number;
    cursor?: string | null;
    url: URL;
  },
  log: (e: any) => void,
) {
  const { screen_name, days, missingOnly, limit, cursor, url } = params;
  const handleRaw = screen_name.trim().replace(/^@+/, "");
  const handle = handleRaw.toLowerCase();
  const isAll = handle === "*" || handle === "all";

  log({
    event: "start",
    handle: isAll ? "*" : handle,
    days,
    missingOnly,
    limit,
  });

  // Time window [since, until)
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - (days - 1));
  const until = new Date(now);
  until.setDate(now.getDate() + 1);

  // Keyset pagination cursor
  const cur = decodeCursor(cursor || url.searchParams.get("cursor"));

  // Base where
  const baseWhere = isAll
    ? and(gte(kolTweets.publishDate, since), lt(kolTweets.publishDate, until))
    : and(
        eq(kolTweets.twitterUsername, handle),
        gte(kolTweets.publishDate, since),
        lt(kolTweets.publishDate, until),
      );

  // Add keyset predicate: (publish_date, tweet_id) < (cursor.ts, cursor.id) in DESC order
  const where = cur
    ? and(
        baseWhere,
        sql`(${kolTweets.publishDate}, ${kolTweets.tweetId}) < (${new Date(cur.ts)}, ${cur.id})`,
      )
    : baseWhere;

  // Load one page
  const tweets = await db
    .select({
      tweetId: kolTweets.tweetId,
      textContent: kolTweets.textContent,
      published: kolTweets.publishDate,
    })
    .from(kolTweets)
    .where(where)
    .orderBy(desc(kolTweets.publishDate), desc(kolTweets.tweetId))
    .limit(limit);

  log({ event: "loaded", tweets: tweets.length });

  if (!tweets.length) {
    const end = {
      ok: true,
      handle: isAll ? "*" : handle,
      pageCount: 0,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
      nextCursor: null as string | null,
    };
    log({ event: "done", ...end });
    return end;
  }

  // If missingOnly: filter out tweets that already have mentions
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

  // Aggregate mentions
  const all: {
    tweetId: string;
    m: Mention;
    triggerKey: string;
    triggerText: string;
  }[] = [];
  const uniqueTickers = new Set<string>();
  const phraseNames = new Set<string>();
  const caSet = new Set<string>();

  let processed = 0;
  const PROGRESS_EVERY = 200;

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
      let trigKey = "";
      let trigText = "";

      if (m.source === "ca") {
        const addr = String(m.tokenKey || "");
        trigKey = makeDeterministicTriggerKey(m); // "ca:<base58>"
        trigText = addr || input;
      } else {
        const built = buildTriggerKeyWithText({
          source: m.source as any,
          value: input,
        });
        trigKey = (built as any)?.key || makeDeterministicTriggerKey(m);
        trigText = (built as any)?.text || input;
      }

      all.push({
        tweetId: t.tweetId,
        m,
        triggerKey: trigKey,
        triggerText: trigText,
      });

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

    processed++;
    if (processed % PROGRESS_EVERY === 0) {
      log({ event: "extract_progress", processed, of: candidates.length });
    }
  }

  log({
    event: "extracted",
    tickers: uniqueTickers.size,
    names: phraseNames.size,
    cas: caSet.size,
  });

  // Resolve symbols / names / CA
  let resolved = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  let resolvedNames = new Map<
    string,
    { tokenKey: string; tokenDisplay: string; boostedConf: number }
  >();
  try {
    if (uniqueTickers.size)
      log({ event: "resolve_tickers_begin", count: uniqueTickers.size });
    resolved = await resolveTickersToContracts([...uniqueTickers]);
    if (uniqueTickers.size) log({ event: "resolve_tickers_done" });
  } catch (e) {
    log({ event: "resolve_tickers_failed", error: String(e) });
  }
  try {
    if (phraseNames.size)
      log({ event: "resolve_names_begin", count: phraseNames.size });
    resolvedNames = await resolveNamesToContracts([...phraseNames]);
    if (phraseNames.size) log({ event: "resolve_names_done" });
  } catch (e) {
    log({ event: "resolve_names_failed", error: String(e) });
  }

  const byContract = new Map<
    string,
    { tokenDisplay: string; boostedConf: number }
  >();
  for (const [, r] of resolved.entries()) {
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
      log({ event: "resolve_ca_done", hit: byContract.size });
    } catch (e) {
      log({ event: "resolve_ca_failed", error: String(e) });
    }
  }

  // Build rows
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
  const seenPair = new Set<string>();

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
        const short = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "????";
        tokenDisplay = `$${short}`;
      }
    } else if (m.source === "ticker") {
      const disp = m.tokenDisplay?.startsWith("$")
        ? m.tokenDisplay
        : `$${String(m.tokenKey || "").toUpperCase()}`;
      const r = resolved.get(disp.replace(/^\$+/, "").toLowerCase());
      if (r) {
        tokenKey = r.tokenKey;
        tokenDisplay = r.tokenDisplay;
        confidence = Math.max(confidence, r.boostedConf);
      }
    } else if (m.source === "phrase") {
      const q = (m.tokenDisplay || m.tokenKey || "").trim().toLowerCase();
      const r = resolvedNames.get(q);
      if (!r) continue; // keep table clean
      tokenKey = r.tokenKey;
      tokenDisplay = r.tokenDisplay;
      confidence = Math.max(confidence, r.boostedConf);
    }

    const pair = `${tweetId}___${triggerKey}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);

    rows.push({
      tweetId,
      tokenKey: canonAddr(String(tokenKey || "")),
      tokenDisplay: tokenDisplay ?? (m.tokenDisplay || m.tokenKey),
      confidence: Math.min(100, Math.max(0, Math.round(confidence))),
      source: m.source as any as Row["source"],
      triggerKey,
      triggerText,
    });
  }

  if (!rows.length) {
    const next = tweets[tweets.length - 1];
    const nextCursor = encodeCursor({
      ts: next.published.toISOString(),
      id: next.tweetId,
    });
    const end = {
      ok: true,
      handle: isAll ? "*" : handle,
      pageCount: candidates.length,
      mentionsDetected: 0,
      inserted: 0,
      updated: 0,
      nextCursor,
    };
    log({ event: "done", ...end });
    return end;
  }

  // Upsert
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

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
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

  const last = tweets[tweets.length - 1];
  const nextCursor = encodeCursor({
    ts: last.published.toISOString(),
    id: last.tweetId,
  });

  const end = {
    ok: true,
    handle: isAll ? "*" : handle,
    pageCount: candidates.length,
    mentionsDetected: rows.length,
    inserted: willInsert,
    updated: willUpdate,
    nextCursor,
  };
  log({ event: "done", ...end });
  return end;
}

/* ========================= Route ========================= */
export async function POST(req: Request) {
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

  const { screen_name, days, missingOnly, limit, cursor } = Body.parse(
    await req.json().catch(() => ({})),
  );

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          (async () => {
            try {
              const result = await runDetectPage(
                { screen_name, days, missingOnly, limit, cursor, url },
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
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  const result = await runDetectPage(
    { screen_name, days, missingOnly, limit, cursor, url },
    () => {},
  );
  return NextResponse.json(result);
}
