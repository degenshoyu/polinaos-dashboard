"use client";

import { useState } from "react";
import type { KolRow, Totals, ShillAgg } from "@/components/types";
import { normalized, toNum, totalsFromRow } from "@/lib/kols";

type TotalsMap = Record<string, Totals>;
type ShillMap = Record<string, ShillAgg>;

export function useKolAggregations() {
  const [refreshing, setRefreshing] = useState(false);
  const [overridesTotals, setOverridesTotals] = useState<TotalsMap>({});
  const [shillOverrides, setShillOverrides] = useState<ShillMap>({});

  /** Read merged totals (override -> row fallback) */
  function getTotals(rowOrHandle: KolRow | string, row?: KolRow): Totals {
    const handle =
      typeof rowOrHandle === "string"
        ? rowOrHandle
        : rowOrHandle.twitterUsername;
    const h = normalized(handle);
    const base =
      typeof rowOrHandle === "string"
        ? totalsFromRow(row!)
        : totalsFromRow(rowOrHandle);
    const o = overridesTotals[h];
    return {
      totalTweets: o?.totalTweets ?? base.totalTweets,
      totalViews: o?.totalViews ?? base.totalViews,
      totalEngs: o?.totalEngs ?? base.totalEngs,
    };
  }

  /** Read merged shill agg (override -> lightweight fallback from row) */
  function getShillAgg(handle: string, row?: KolRow): ShillAgg | null {
    const h = normalized(handle);
    const o = shillOverrides[h];
    if (o) return o;

    if (!row) return null;
    const sTotal = toNum(
      row.totalShills ?? (row as any).shills_total ?? (row as any).total_shills,
    );
    const sViews = toNum(
      row.shillViews ?? (row as any).shills_views ?? (row as any).shillsViews,
    );
    const sEngs = toNum(
      row.shillEngagements ??
        (row as any).shills_engagements ??
        (row as any).shillsEngagements,
    );

    return {
      totalShills: sTotal,
      shillsViews: sViews,
      shillsEngs: sEngs,
      coins: Array.isArray(row.coinsShilled)
        ? (row.coinsShilled as string[]).map((d) => ({
            tokenKey: d.toLowerCase(),
            tokenDisplay: String(d).toUpperCase(),
            count: 1,
          }))
        : [],
    };
  }

  /**
   * Refresh aggregations for visible handles (sequential, gentle on backend).
   * Order matters:
   *  1) detect-mentions (missingOnly) => avoid duplicate inserts
   *  2) aggregate totals
   *  3) aggregate shills (coins + shill counters)
   */
  async function refreshVisible(handles: string[], days = 7) {
    if (!handles?.length || refreshing) return;
    setRefreshing(true);

    try {
      for (const raw of handles) {
        const h = normalized(raw);
        if (!h) continue;

        // 1) detect mentions for missing tweets only (server will upsert by trigger_key)
        try {
          await fetch(`/api/kols/detect-mentions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ screen_name: h, days, missingOnly: true }),
          });
        } catch {}

        // 2) aggregate totals (tweets/views/engs do not depend on detection)
        try {
          const r = await fetch(
            `/api/kols/aggregate?screen_name=${encodeURIComponent(h)}&days=${days}`,
            { cache: "no-store" },
          );
          const j = await r.json().catch(() => ({}));
          if (r.ok && j?.ok) {
            setOverridesTotals((m) => ({
              ...m,
              [h]: {
                totalTweets: toNum(j?.totals?.totalTweets),
                totalViews: toNum(j?.totals?.totalViews),
                totalEngs: toNum(j?.totals?.totalEngs),
              },
            }));
          }
        } catch {}

        // 3) aggregate shills (depends on mentions; run after detection)
        try {
          const r2 = await fetch(
            `/api/kols/aggregate-shills?screen_name=${encodeURIComponent(h)}&days=${days}`,
            { cache: "no-store" },
          );
          const j2 = await r2.json().catch(() => ({}));
          if (r2.ok && j2?.ok) {
            setShillOverrides((m) => ({
              ...m,
              [h]: {
                totalShills: toNum(j2?.totals?.totalShills),
                shillsViews: toNum(j2?.totals?.shillsViews),
                shillsEngs: toNum(j2?.totals?.shillsEngs),
                coins: Array.isArray(j2?.coins) ? j2.coins : [],
              },
            }));
          }
        } catch {}
      }
    } finally {
      setRefreshing(false);
    }
  }

  /** Allow external write (used by scan hook) */
  function setTotalsOverride(handle: string, totals: Totals) {
    const h = normalized(handle);
    setOverridesTotals((m) => ({ ...m, [h]: totals }));
  }
  function setShillOverride(handle: string, sh: ShillAgg) {
    const h = normalized(handle);
    setShillOverrides((m) => ({ ...m, [h]: sh }));
  }

  return {
    refreshing,
    refreshVisible,
    getTotals,
    getShillAgg,
    setTotalsOverride,
    setShillOverride,
  };
}
