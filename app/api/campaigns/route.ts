// app/api/campaigns/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { Session } from "next-auth";

type Campaign = {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

// In-memory store
const _db: Record<string, Campaign[]> = {};
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function GET() {
  const session: Session | null = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId =
    (session.user as { id?: string; email?: string; name?: string }).id ||
    session.user.email ||
    session.user.name ||
    "anonymous";

  return NextResponse.json({ ok: true, campaigns: _db[userId] || [] });
}

export async function POST(req: Request) {
  const session: Session | null = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const draft = body?.draft;

  if (!draft?.projectName) {
    return NextResponse.json({ error: "Missing projectName" }, { status: 400 });
  }

  const userId =
    (session.user as { id?: string; email?: string; name?: string }).id ||
    session.user.email ||
    session.user.name ||
    "anonymous";

  const item: Campaign = {
    id: uid(),
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...draft,
  };

  if (!_db[userId]) _db[userId] = [];
  _db[userId].unshift(item);

  return NextResponse.json({ ok: true, id: item.id, campaign: item });
}
