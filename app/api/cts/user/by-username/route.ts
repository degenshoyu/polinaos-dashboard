// app/api/cts/user/by-username/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ screen_name: z.string().min(1) });

export async function POST(req: Request) {
  const { screen_name } = Body.parse(await req.json());

  const base = process.env.TWITTER_SCANNER_API_URL?.replace(/\/+$/, "");
  const token = process.env.TWITTER_SCANNER_SECRET?.trim();
  if (!base || !token) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing TWITTER_SCANNER_API_URL or TWITTER_SCANNER_SECRET",
      },
      { status: 500 },
    );
  }

  const r = await fetch(`${base}/user/by-username`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ screen_name }),
  });

  const data = await r.json().catch(() => ({}) as any);
  if (!r.ok || !data?.success || !data?.user_job_id) {
    return NextResponse.json(
      { ok: false, status: r.status, error: data?.message ?? "scanner failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    screen_name,
    job_id: data.user_job_id as string,
    message: data.message ?? "User scan started",
  });
}
