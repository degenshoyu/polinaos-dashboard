// app/api/jobProxy/route.ts
import { NextRequest, NextResponse } from "next/server";

const BASE_URL = process.env.TWITTER_SCANNER_API_URL!;
const SECRET = process.env.TWITTER_SCANNER_SECRET!;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const job_id = searchParams.get("job_id");

  if (!job_id) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }

  try {
    const upstreamRes = await fetch(`${BASE_URL}/job/${job_id}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
      cache: "no-store",
    });

    const data = await upstreamRes.json();
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error("🔴 Job fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch job result" },
      { status: 500 }
    );
  }
}

