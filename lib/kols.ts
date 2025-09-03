// lib/kols.ts

import type { CoinItem, KolRow, Totals } from "@/components/types";

/** Normalize @handle → "handle" (lowercase, trim) */
export function normalized(handle: string | undefined | null): string {
  const s = String(handle || "")
    .trim()
    .replace(/^@+/, "");
  return s.toLowerCase();
}

/** Safe number cast */
export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Pick first present numeric field from a list of keys */
export function pickNum<T extends Record<string, any>>(
  obj: T,
  keys: string[],
): number {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return toNum(obj[k]);
  }
  return 0;
}

/** Format ER (engagements/views) into "12.34%" */
export function fmtER(views: number, engs: number): string {
  const v = toNum(views);
  const e = toNum(engs);
  if (v <= 0) return "0%";
  return `${((e / v) * 100).toFixed(2)}%`;
}

/** Derive Totals from row with sensible fallbacks */
export function totalsFromRow(row: KolRow): Totals {
  const totalTweets = pickNum(row, [
    "totalTweets",
    "total_tweets",
    "last7dTweets",
    "weeklyTweets",
    "tweets",
  ]);
  const totalViews = pickNum(row, [
    "totalViews",
    "total_views",
    "last7dViews",
    "weeklyViews",
    "views",
  ]);
  const totalEngs = pickNum(row, [
    "totalEngagements",
    "total_engagements",
    "totalEngs",
    "last7dEngagements",
    "weeklyEngagements",
    "engagements",
  ]);
  return { totalTweets, totalViews, totalEngs };
}

/** Merge/normalize coins into unique `$TICKER` display items */
export function mergeDisplayCoins(
  raw: Array<Partial<CoinItem> & Record<string, any>>,
): CoinItem[] {
  // Accept shapes like { tokenDisplay, tokenKey, count }
  const mapByDisplay = new Map<string, { display: string; count: number }>();

  for (const it of raw || []) {
    let disp = String(it.tokenDisplay ?? it.tokenKey ?? "").trim();
    if (!disp) continue;
    disp = disp.replace(/^#/, "$");
    if (!disp.startsWith("$")) disp = `$${disp}`;
    const dkey = disp.toLowerCase().replace(/\s+/g, "");
    const prev = mapByDisplay.get(dkey);
    mapByDisplay.set(dkey, {
      display: (prev?.display ?? disp).toUpperCase(),
      count: (prev?.count ?? 0) + toNum((it as any).count ?? 1),
    });
  }

  return [...mapByDisplay.entries()].map(([dkey, v]) => ({
    tokenKey: dkey,
    tokenDisplay: v.display,
    count: v.count,
  }));
}
