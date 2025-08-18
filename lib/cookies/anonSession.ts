// lib/cookies/anonSession.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const ANON_COOKIE_NAME = "anon_session_id";
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(v?: string | null): v is string {
  return !!v && UUID_RE.test(v);
}

export async function readAnonSessionId(): Promise<string | null> {
  const store = await cookies(); // 👈 Next 15: await
  const v = store.get(ANON_COOKIE_NAME)?.value ?? null;
  return isValidUuid(v) ? v : null;
}

export async function ensureAnonSessionOn(res: NextResponse): Promise<string> {
  const store = await cookies(); // 👈 Next 15: await
  const existing = store.get(ANON_COOKIE_NAME)?.value;
  if (isValidUuid(existing)) return existing;

  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

  res.cookies.set({
    name: ANON_COOKIE_NAME,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ANON_COOKIE_MAX_AGE,
    path: "/",
  });

  return id;
}
