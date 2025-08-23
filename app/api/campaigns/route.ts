// app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth"; // make sure this exists and exports your NextAuth options

import { db } from "@/lib/db/client";
import { users, searches } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

function walletFromSession(sess: any): string | null {
  const u = sess?.user || {};
  const w = u.address || u.id || u.name || null;
  return w ? String(w) : null;
}

function toRecentRow(r: typeof searches.$inferSelect) {
  const qj: any = r.queryJson ?? {};
  const input: any = qj.input ?? qj; // be tolerant if some old rows were flat

  const projectName: string | null =
    input.projectName?.trim?.() ||
    input.twitterHandle?.trim?.() ||
    input.contractAddress?.trim?.() ||
    null;

  const tokenAddress: string | null =
    input.contractAddress?.trim?.() ||
    qj.contractAddress?.trim?.() ||
    qj.tokenAddress?.trim?.() ||
    null;

  return {
    id: r.id,
    jobId: r.jobId,
    projectName,
    tokenAddress,
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : (r.createdAt as any),
  };
}

/* ===================== GET /api/campaigns =====================

- /api/campaigns?mine=1  → current user's recent searches (latest 50)

*/
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine");

  if (mine !== "1") {
    return NextResponse.json({ error: "Unsupported query" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json([], { status: 200 });

  const wallet = walletFromSession(session);
  if (!wallet) return NextResponse.json([], { status: 200 });

  // find user by walletAddress (lowercased)
  const walletLc = wallet.toLowerCase();
  const userRow = await db.query.users.findFirst({
    where: eq(users.walletAddress, walletLc),
  });

  if (!userRow) {
    // no user row yet → nothing to show
    return NextResponse.json([]);
  }

  // get recent searches for this user
  const rows = await db.query.searches.findMany({
    where: eq(searches.userId, userRow.id),
    orderBy: [desc(searches.createdAt)],
    limit: 50,
  });

  return NextResponse.json(rows.map(toRecentRow));
}

/* ===================== POST /api/campaigns =====================

Called from the Analysis flow to persist a search.
Body:
{
  jobId: string,
  queryJson: {
    projectName?: string,
    twitterHandle?: string,
    contractAddress?: string,
    ...any other fields you keep
  },
  anonSessionId?: string,   // for guests (optional)
  source?: string           // default "ctsearch"
}

- We attach userId based on session wallet (creating the users row if missing).
- Insert is idempotent by jobId (ignore duplicates).

*/
const PostBody = z.object({
  jobId: z.string().min(1),
  queryJson: z.record(z.any()).default({}),
  anonSessionId: z.string().optional(),
  source: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const body = parsed.data;

  const session = await getServerSession(authOptions).catch(() => null);
  const wallet = walletFromSession(session);
  const walletLc = wallet ? wallet.toLowerCase() : null;

  let userId: string | null = null;

  if (walletLc) {
    // ensure user exists
    const existing = await db.query.users.findFirst({
      where: eq(users.walletAddress, walletLc),
    });
    if (!existing) {
      const [created] = await db
        .insert(users)
        .values({ walletAddress: walletLc })
        .returning();
      userId = created.id;
    } else {
      userId = existing.id;
    }
  }

  // idempotent insert by jobId
  // drizzle doesn't do "on conflict do nothing" with .findFirst() + conditional insert cleanly across all dbs,
  // so we do a quick existence check:
  const already = await db.query.searches.findFirst({
    where: eq(searches.jobId, body.jobId),
  });
  if (already) {
    return NextResponse.json(toRecentRow(already));
  }

  const [inserted] = await db
    .insert(searches)
    .values({
      userId: userId ?? null,
      anonSessionId: userId ? null : (body.anonSessionId ?? null),
      queryJson: body.queryJson,
      jobId: body.jobId,
      source: body.source ?? "ctsearch",
    })
    .returning();

  return NextResponse.json(toRecentRow(inserted));
}

// prevent caching of dynamic data during dev
export const dynamic = "force-dynamic";
