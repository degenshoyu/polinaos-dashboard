// app/api/kols/tweets/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Query validation */
const QuerySchema = z.object({
  handle: z.string().min(1, "handle is required"),
  days: z
    .preprocess((v) => Number(v), z.union([z.literal(7), z.literal(30)]))
    .default(7),
  page: z.preprocess((v) => Number(v ?? 1), z.number().int().min(1)).default(1),
  pageSize: z
    .preprocess((v) => Number(v ?? 10), z.number().int().min(1).max(50))
    .default(10),
});

type CoinSnap = {
  tokenKey: string;
  tokenDisplay: string;
  priceUsdAt: number | null;
};
type TweetItem = {
  id: string;
  text: string;
  url: string;
  createdAt: string;
  detectedCoins: CoinSnap[];
};
type ApiResp = {
  items: TweetItem[];
  page: number;
  pageSize: number;
  total: number;
};

export async function GET(req: Request) {
  try {
    // helper: shorten a base58 address for display
    const shortAddr = (addr: string) =>
      addr && addr.length > 8
        ? `${addr.slice(0, 4)}…${addr.slice(-4)}`
        : addr || "UNKNOWN";
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }

    // 接受 "@alice" 或 "alice"
    const handle = parsed.data.handle.trim().replace(/^@/, "");
    const { days, page, pageSize } = parsed.data;

    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 先 COUNT 用于分页
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(kolTweets)
      .where(
        and(
          eq(kolTweets.twitterUsername, handle),
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, now),
        ),
      );

    const total = Number(count || 0);
    if (total === 0) {
      const empty: ApiResp = { items: [], page, pageSize, total };
      return NextResponse.json(empty);
    }

    // 分页数据（最新在前）
    const rows = await db
      .select({
        id: kolTweets.tweetId,
        text: kolTweets.textContent, // ← 你的 schema 用 text_content
        url: kolTweets.statusLink, // ← 你的 schema 用 status_link
        createdAt: kolTweets.publishDate, // ← 时间维度用 publish_date
      })
      .from(kolTweets)
      .where(
        and(
          eq(kolTweets.twitterUsername, handle),
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, now),
        ),
      )
      .orderBy(desc(kolTweets.publishDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const tweetIds = rows.map((r) => r.id);

    // 一次性把 mentions 拉出来
    const mentions = tweetIds.length
      ? await db
          .select({
            tweetId: tweetTokenMentions.tweetId,
            tokenKey: tweetTokenMentions.tokenKey,
            tokenDisplay: tweetTokenMentions.tokenDisplay,
            priceUsdAtRaw: tweetTokenMentions.priceUsdAt, // numeric -> string|null
          })
          .from(tweetTokenMentions)
          .where(inArray(tweetTokenMentions.tweetId, tweetIds))
      : [];

    const mByTweet = new Map<string, CoinSnap[]>();
    for (const m of mentions) {
      const arr = mByTweet.get(m.tweetId) || [];
      arr.push({
        tokenKey: m.tokenKey,
        tokenDisplay: m.tokenDisplay ?? shortAddr(m.tokenKey),
        priceUsdAt: m.priceUsdAtRaw == null ? null : Number(m.priceUsdAtRaw),
      });
      mByTweet.set(m.tweetId, arr);
    }

    const items: TweetItem[] = rows.map((r) => {
      const createdIso =
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt as unknown as string).toISOString();

      return {
        id: String(r.id),
        text: r.text ?? "",
        url: r.url ?? `https://x.com/${handle}/status/${r.id}`,
        createdAt: createdIso, // 用 publish_date
        detectedCoins: mByTweet.get(String(r.id)) ?? [],
      };
    });

    const resp: ApiResp = { items, page, pageSize, total };
    return NextResponse.json(resp);
  } catch (err: any) {
    console.error("[/api/kols/tweets] ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal Server Error" },
      { status: 500 },
    );
  }
}
