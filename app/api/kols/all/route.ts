// app/api/kols/all/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db
      .select({
        twitterUid: kols.twitterUid,
        twitterUsername: kols.twitterUsername,
        displayName: kols.displayName,
        followers: kols.followers,
        following: kols.following,
        bio: kols.bio,
        profileImgUrl: kols.profileImgUrl,
        accountCreationDate: kols.accountCreationDate,
        active: kols.active,
        notes: kols.notes,
      })
      .from(kols)
      .orderBy(desc(sql<number>`COALESCE(${kols.followers}, 0)`));
    return NextResponse.json({ ok: true, items: rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "failed" },
      { status: 500 },
    );
  }
}
