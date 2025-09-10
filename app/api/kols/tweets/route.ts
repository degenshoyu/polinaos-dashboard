// app/api/kols/tweets/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kols, kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

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
  filter: z.enum(["all", "coins"]).default("all"),
  sort: z
    .enum(["createdAt", "views", "replies", "retweets", "likes"])
    .default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  mode: z.enum(["content", "stats"]).default("content"),
});

type CoinSnap = {
  tokenKey: string;
  tokenDisplay: string;
  // 返回字符串更稳，前端自行 Number() + toFixed(6)
  priceUsdAt: string | null;
};
type TweetItem = {
  id: string;
  text: string;
  url: string;
  createdAt: string; // ISO
  views: number;
  replies: number;
  retweets: number;
  likes: number;
  detectedCoins: CoinSnap[];
};
type ApiResp = {
  kol?: {
    username: string;
    followers?: number;
    bio?: string | null;
    avatar?: string | null;
  };
  items: TweetItem[];
  page: number;
  pageSize: number;
  total: number;
};

export async function GET(req: Request) {
  try {
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
    const { days, page, pageSize, filter, sort, dir } = parsed.data;

    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 取 KOL 基本信息（followers, bio, avatar）供前端头部显示
    const kolRow = await db.query.kols.findFirst({
      columns: {
        twitterUsername: true,
        followers: true,
        bio: true,
        profileImgUrl: true,
      },
      where: eq(kols.twitterUsername, handle),
    });

    // coins 过滤的 SQL 片段
    const coinsOnlyWhere =
      filter === "coins"
        ? sql`exists (select 1 from ${tweetTokenMentions} mm where mm.tweet_id = ${kolTweets.tweetId})`
        : sql`true`;

    // 统计总数（含 coins 过滤 & 时间窗口 & handle）
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)` })
      .from(kolTweets)
      .where(
        and(
          eq(kolTweets.twitterUsername, handle),
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, now),
          coinsOnlyWhere,
        ),
      );

    const total = Number(cnt || 0);
    if (total === 0) {
      const empty: ApiResp = {
        kol: kolRow
          ? {
              username: kolRow.twitterUsername,
              followers: kolRow.followers ?? undefined,
              bio: kolRow.bio ?? null,
              avatar: kolRow.profileImgUrl ?? null,
            }
          : undefined,
        items: [],
        page,
        pageSize,
        total,
      };
      return NextResponse.json(empty);
    }

    // 排序映射
    const sortMap: Record<
      "createdAt" | "views" | "replies" | "retweets" | "likes",
      any
    > = {
      createdAt: kolTweets.publishDate,
      views: kolTweets.views,
      replies: kolTweets.replies,
      retweets: kolTweets.retweets,
      likes: kolTweets.likes,
    };
    const sortCol = sortMap[sort];
    const orderByExpr = dir === "asc" ? asc(sortCol) : desc(sortCol);

    // 主查询：分页 + 排序
    const rows = await db
      .select({
        id: kolTweets.tweetId,
        text: kolTweets.textContent,
        url: kolTweets.statusLink,
        createdAt: kolTweets.publishDate,
        views: kolTweets.views,
        replies: kolTweets.replies,
        retweets: kolTweets.retweets,
        likes: kolTweets.likes,
      })
      .from(kolTweets)
      .where(
        and(
          eq(kolTweets.twitterUsername, handle),
          gte(kolTweets.publishDate, since),
          lt(kolTweets.publishDate, now),
          coinsOnlyWhere,
        ),
      )
      .orderBy(orderByExpr)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const tweetIds = rows.map((r) => r.id);
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

    const mByTweet = new Map<string, Map<string, CoinSnap>>();

    for (const m of mentions) {
      const priceStr = m.priceUsdAtRaw as string | null;
      const tokenDisplay = m.tokenDisplay ?? shortAddr(m.tokenKey);

      let coinMap = mByTweet.get(m.tweetId);
      if (!coinMap) {
        coinMap = new Map<string, CoinSnap>();
        mByTweet.set(m.tweetId, coinMap);
      }

      const existing = coinMap.get(m.tokenKey);
      if (!existing) {
        coinMap.set(m.tokenKey, {
          tokenKey: m.tokenKey,
          tokenDisplay,
          priceUsdAt: priceStr,
        });
      } else {
        if (existing.priceUsdAt == null && priceStr != null) {
          coinMap.set(m.tokenKey, {
            ...existing,
            priceUsdAt: priceStr,
          });
        }
      }
    }

    const items: TweetItem[] = rows.map((r) => {
      const createdIso =
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt as unknown as string).toISOString();

      const viewsNum =
        typeof (r.views as unknown) === "bigint"
          ? Number(r.views as unknown as bigint)
          : Number(r.views ?? 0);

      return {
        id: String(r.id),
        text: r.text ?? "",
        url: r.url ?? `https://x.com/${handle}/status/${r.id}`,
        createdAt: createdIso,
        views: Number.isFinite(viewsNum) ? viewsNum : 0,
        replies: Number(r.replies ?? 0),
        retweets: Number(r.retweets ?? 0),
        likes: Number(r.likes ?? 0),
        detectedCoins: Array.from(mByTweet.get(String(r.id))?.values() ?? []),
      };
    });

    const resp: ApiResp = {
      kol: kolRow
        ? {
            username: kolRow.twitterUsername,
            followers: kolRow.followers ?? undefined,
            bio: kolRow.bio ?? null,
            avatar: kolRow.profileImgUrl ?? null,
          }
        : undefined,
      items,
      page,
      pageSize,
      total,
    };
    return NextResponse.json(resp);
  } catch (err: any) {
    console.error("[/api/kols/tweets] ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal Server Error" },
      { status: 500 },
    );
  }
}
