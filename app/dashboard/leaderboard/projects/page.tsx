// app/dashboard/leaderboard/projects/page.tsx
// Server Component entry for Project Leaderboard (clean: no KOL header).
// Next.js 15: `searchParams` is a Promise — await it before use.

import { Suspense } from "react";
import ProjectsLeaderboardClient, {
  type ProjectLeaderboardItem,
} from "@/components/leaderboard/ProjectsLeaderboardClient";

// Helper to read search params with defaults
function getParam(sp: URLSearchParams, key: string, fallback: string) {
  const v = sp.get(key);
  return (v && v.trim()) || fallback;
}

// Mock generator for SSR fallback (keeps the page usable before API is ready)
function mockItems(count = 10): ProjectLeaderboardItem[] {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  const types = ["meme", "utility"] as const;
  const shillers = [
    { handle: "runitbackghost", views: 48000, avatar: null, followers: 26800 },
    { handle: "ihateoop", views: 32000, avatar: null, followers: 33000 },
    { handle: "bagcalls", views: 21000, avatar: null, followers: 68200 },
    { handle: "satsbuyer", views: 17000, avatar: null, followers: 9600 },
  ];
  return Array.from({ length: count }).map((_, i) => {
    const ca =
      "So11111111111111111111111111111111111111112".slice(0, 6) +
      String(i).padStart(2, "0") +
      "ABCDEFFEDCBA987654321";
    return {
      rank: i + 1,
      ticker: `TOK${i}`,
      ca,
      image: null,
      price_usd: Number((Math.random() * 0.5 + 0.01).toFixed(5)),
      mcap_usd: Math.floor(Math.random() * 50_000_000) + 1_000_000,
      social_score: Number((Math.random() * 0.8 + 0.1).toFixed(2)),
      type: pick(types),
      attention_score: Number((Math.random() * 0.6 + 0.3).toFixed(2)),
      top_shillers: [pick(shillers), pick(shillers), pick(shillers)],
    };
  });
}

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  // Next.js 15 App Router: `searchParams` comes in as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Await the Promise to get the plain object
  const spObj = await searchParams;

  // Normalize into URLSearchParams for convenient parsing
  const sp = new URLSearchParams(
    Object.entries(spObj).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]],
    ),
  );

  // Narrow all URL-derived values to literal unions expected by the client component.
 const q = getParam(sp, "q", "");

 // preset: "7d" | "30d"
 const presetRaw = getParam(sp, "preset", "7d");
 const preset: "7d" | "30d" = presetRaw === "30d" ? "30d" : "7d";

 // type: "all" | "meme" | "utility"
 const typeRaw = getParam(sp, "type", "all");
 const type: "all" | "meme" | "utility" =
   typeRaw === "meme" ? "meme" : typeRaw === "utility" ? "utility" : "all";

 // sort: "attention" | "views" | "shillers" | "social" | "mcap" | "price"
 const sortRaw = getParam(sp, "sort", "attention");
 const allowedSort = ["attention", "views", "shillers", "social", "mcap", "price"] as const;
 const sort: "attention" | "views" | "shillers" | "social" | "mcap" | "price" =
   (allowedSort as readonly string[]).includes(sortRaw) ? (sortRaw as any) : "attention";

 // order: "asc" | "desc"
 const orderRaw = getParam(sp, "order", "desc");
 const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
  const page = Number(getParam(sp, "page", "1"));
  const pageSize = Number(getParam(sp, "pageSize", "10"));

  let initialItems: ProjectLeaderboardItem[] = [];
  let total = 0;

  try {
    const url = new URL(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/projects/leaderboard`,
      "http://localhost:3000",
    );
    url.searchParams.set("preset", preset);
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("type", type);
    url.searchParams.set("sort", sort);
    url.searchParams.set("order", order);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));

    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { "content-type": "application/json" },
    });

    if (!res.ok) throw new Error(`Leaderboard API ${res.status}`);
    const data = (await res.json()) as {
      page: number;
      pageSize: number;
      total: number;
      items: ProjectLeaderboardItem[];
    };
    initialItems = data.items ?? [];
    total = data.total ?? initialItems.length;
  } catch {
    // Graceful fallback to mock data (keeps the page usable during backend dev)
    initialItems = mockItems(pageSize);
    total = 200;
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={<div className="text-white/70">Loading…</div>}>
        <ProjectsLeaderboardClient
          initialItems={initialItems}
          initialTotal={total}
          initialQuery={{ preset, q, type, sort, order, page, pageSize }}
        />
      </Suspense>
    </div>
  );
}
