import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { kols } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  screen_name: z.string().min(1),
  pollIntervalMs: z.number().int().min(200).max(3000).optional().default(1000),
  maxWaitMs: z.number().int().min(1000).max(60000).optional().default(20000),
});

const norm = (h: string) => h.trim().replace(/^@+/, "").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getOrigin(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const { screen_name, pollIntervalMs, maxWaitMs } = Body.parse(
    await req.json(),
  );
  const handle = norm(screen_name);
  const origin = getOrigin(req);

  const startRes = await fetch(`${origin}/api/cts/user/by-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screen_name: handle }),
    cache: "no-store",
  });
  const startText = await startRes.text();
  let start: any = null;
  try {
    start = JSON.parse(startText);
  } catch {}
  if (!startRes.ok || !start?.job_id) {
    return NextResponse.json(
      {
        ok: false,
        error: "start scan failed",
        status: startRes.status,
        preview: startText.slice(0, 300),
      },
      { status: 502 },
    );
  }
  const jobId: string = start.job_id;

  const begin = Date.now();
  let last: any = null;
  while (Date.now() - begin < maxWaitMs) {
    const r = await fetch(
      `${origin}/api/jobProxy?job_id=${encodeURIComponent(jobId)}`,
      { cache: "no-store" },
    );
    const t = await r.text();
    try {
      last = JSON.parse(t);
    } catch {
      last = { error: "non-json", preview: t.slice(0, 300) };
    }
    const s = String(last?.status || "").toLowerCase();
    if (s === "completed" || s === "failed") break;
    await sleep(pollIntervalMs);
  }
  if (
    !last ||
    String(last?.status).toLowerCase() !== "completed" ||
    !last?.user
  ) {
    return NextResponse.json(
      { ok: false, error: "poll timeout or not completed", last },
      { status: 504 },
    );
  }

  const u = last.user as {
    twitter_id: string;
    screen_name: string;
    nick_name?: string;
    description?: string;
    followings?: number;
    followers?: number;
    tweets?: number;
    dateCreated?: string;
    last_scanned_at?: string;
    profile_image_url_https?: string;
  };

  const values = {
    twitterUid: u.twitter_id,
    twitterUsername: (u.screen_name || handle).toLowerCase(),
    displayName: u.nick_name,
    active: true,
    bio: u.description,
    followers: Number(u.followers ?? 0),
    following: Number(u.followings ?? 0),
    accountCreationDate: u.dateCreated ? new Date(u.dateCreated) : undefined,
    profileImgUrl: (u as any).profile_image_url_https || undefined,
  };

  await db
    .insert(kols)
    .values({
      twitterUid: values.twitterUid,
      twitterUsername: values.twitterUsername,
      displayName: values.displayName,
      active: values.active,
      bio: values.bio,
      followers: values.followers,
      following: values.following,
      accountCreationDate: values.accountCreationDate,
      profileImgUrl: values.profileImgUrl,
    })
    .onConflictDoUpdate({
      target: kols.twitterUsername,
      set: {
        twitterUid: values.twitterUid,
        displayName: values.displayName ?? sql`${kols.displayName}`,
        active: true,
        bio: values.bio ?? sql`${kols.bio}`,
        followers: values.followers ?? sql`${kols.followers}`,
        following: values.following ?? sql`${kols.following}`,
        accountCreationDate:
          values.accountCreationDate ?? sql`${kols.accountCreationDate}`,
        profileImgUrl: values.profileImgUrl ?? sql`${kols.profileImgUrl}`,
      },
    });

  return NextResponse.json({ ok: true, job_id: jobId, user: u });
}
