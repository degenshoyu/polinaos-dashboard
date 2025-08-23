// app/api/ai-understanding/route.ts
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { searches, aiUnderstandings } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("job_id") || searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }

  try {
    const s = await db
      .select({ id: searches.id })
      .from(searches)
      .where(eq(searches.jobId, jobId))
      .limit(1);

    if (!s.length) {
      return NextResponse.json({ found: false }, { status: 200 });
    }

    const u = await db
      .select({
        id: aiUnderstandings.id,
        summaryText: aiUnderstandings.summaryText,
        resultJson: aiUnderstandings.resultJson,
        createdAt: aiUnderstandings.createdAt,
      })
      .from(aiUnderstandings)
      .where(eq(aiUnderstandings.searchId, s[0].id))
      .orderBy(desc(aiUnderstandings.createdAt))
      .limit(1);

    if (!u.length) {
      return NextResponse.json({ found: false }, { status: 200 });
    }

    return NextResponse.json({
      found: true,
      summaryText: u[0].summaryText ?? "",
      resultJson: u[0].resultJson ?? null,
      createdAt: u[0].createdAt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "DB error" },
      { status: 500 },
    );
  }
}
