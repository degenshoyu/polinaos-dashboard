// app/api/kols/list/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  // Optional: only active accounts
  activeOnly: z.coerce.boolean().optional().default(true),
  // Optional: min followers threshold for options
  minFollowers: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = Query.parse({
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      activeOnly: url.searchParams.get("activeOnly") ?? undefined,
      minFollowers: url.searchParams.get("minFollowers") ?? undefined,
    });

    const conds: any[] = [];
    if (parsed.activeOnly) conds.push(eq(kols.active, true));
    if (parsed.minFollowers > 0)
      conds.push(sql`${kols.followers} >= ${parsed.minFollowers}`);

    if (parsed.q && parsed.q.trim()) {
      const like = `%${parsed.q.trim()}%`;
      conds.push(
        or(ilike(kols.twitterUsername, like), ilike(kols.displayName, like)),
      );
    }

    const rows = await db
      .select({
        uid: kols.twitterUid,
        username: kols.twitterUsername,
        displayName: kols.displayName,
        followers: kols.followers,
        profileImgUrl: kols.profileImgUrl,
      })
      .from(kols)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(kols.followers))
      .limit(parsed.limit);

    return NextResponse.json({
      ok: true,
      items: rows.map((r) => ({
        uid: r.uid,
        username: r.username,
        displayName: r.displayName,
        followers: r.followers,
        avatar: r.profileImgUrl,
        label: r.displayName
          ? `${r.displayName} (@${r.username})`
          : `@${r.username}`,
        value: r.username, // convenient for a <Select> value
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown" },
      { status: 400 },
    );
  }
}
