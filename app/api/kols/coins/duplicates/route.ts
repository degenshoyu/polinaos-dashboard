import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kolTweets, tweetTokenMentions } from "@/lib/db/schema";
import { and, eq, gte, lte, sql, isNotNull } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Q = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

type Row = { ticker: string | null; ca: string | null; mentions: number };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = Q.parse({
      from: url.searchParams.get("from") ?? new Date(0).toISOString(),
      to: url.searchParams.get("to") ?? new Date().toISOString(),
    });

    const timeFilter = and(
      gte(kolTweets.publishDate, new Date(q.from)),
      lte(kolTweets.publishDate, new Date(q.to)),
    );

    // Normalize ticker: strip leading '$', uppercase; null if empty
    const normTickerExpr = sql<string>`
      nullif(
        upper(regexp_replace(${tweetTokenMentions.tokenDisplay}, '^\\$+', '', 'g')),
        ''
      )
    `;

    const rows = await db
      .select({
        ticker: normTickerExpr,
        ca: tweetTokenMentions.tokenKey,
        mentions: sql<number>`count(*)`,
      })
      .from(tweetTokenMentions)
      .innerJoin(kolTweets, eq(tweetTokenMentions.tweetId, kolTweets.tweetId))
      .where(
        and(
          timeFilter,
          isNotNull(tweetTokenMentions.tokenDisplay),
          isNotNull(tweetTokenMentions.tokenKey),
        ),
      )
      .groupBy(normTickerExpr, tweetTokenMentions.tokenKey);

    const perTicker = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();

    for (const r of rows as Row[]) {
      const t = (r.ticker ?? "").trim();
      const ca = (r.ca ?? "").trim();
      if (!t || !ca) continue;

      if (!perTicker.has(t)) perTicker.set(t, new Map());
      const m = perTicker.get(t)!;
      m.set(ca, (m.get(ca) ?? 0) + Number(r.mentions || 0));
      totals.set(t, (totals.get(t) ?? 0) + Number(r.mentions || 0));
    }

    const items = Array.from(perTicker.entries())
      .filter(([_, m]) => m.size > 1)
      .map(([t, m]) => {
        const cas = Array.from(m.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([ca, mentions]) => ({ ca, mentions }));
        return { ticker: t, totalMentions: totals.get(t) ?? 0, cas };
      })
      .sort((a, b) => {
        const d1 = b.cas.length - a.cas.length;
        if (d1 !== 0) return d1;
        return b.totalMentions - a.totalMentions;
      });

    return NextResponse.json({ ok: true, items, total: items.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 400 },
    );
  }
}
