import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.union([
  z.object({ text: z.string().min(1) }),
  z.object({ handles: z.array(z.string().min(1)) }),
]);

const norm = (h: string) => h.trim().replace(/^@+/, "").toLowerCase();
const parseLines = (t: string) =>
  t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const body = BodySchema.parse(raw);

    const rawHandles =
      "text" in body ? parseLines(body.text) : body.handles;

    const handles = Array.from(new Set(rawHandles.map(norm))).filter(Boolean);
    if (!handles.length) {
      return NextResponse.json({ ok: true, inserted: 0, updated: 0, total: 0 });
    }

    const existing = await db
      .select({ u: kols.twitterUsername })
      .from(kols)
      .where(inArray(kols.twitterUsername, handles));

    const existSet = new Set(existing.map(r => r.u));
    let inserted = 0, updated = 0;

    for (const handle of handles) {
      const isExisting = existSet.has(handle);
      await db.insert(kols).values({
        twitterUid: handle,
        twitterUsername: handle,
        active: true,
      }).onConflictDoUpdate({
        target: kols.twitterUsername,
        set: {
          active: true,
          // twitterUid: sql`COALESCE(${kols.twitterUid}, ${handle})`
        },
      });
      if (isExisting) updated++; else inserted++;
    }

    return NextResponse.json({
      ok: true,
      inserted,
      updated,
      total: handles.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 400 });
  }
}

