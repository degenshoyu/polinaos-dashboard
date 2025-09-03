"use client";

import { useRef, useState } from "react";
import { normalized, toNum } from "@/lib/kols";
import type { Totals, ShillAgg } from "@/components/types";

export function useScanTimeline(opts?: {
  days?: number;
  onTotals?: (handle: string, totals: Totals) => void; // write into useKolAggregations
  onShills?: (handle: string, sh: ShillAgg) => void; // write into useKolAggregations
  onAfterScan?: (handle: string) => Promise<void> | void; // parent reload
}) {
  const days = opts?.days ?? 7;
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [scanMsg, setScanMsg] = useState<Record<string, string | null>>({});
  const pollRef = useRef<Record<string, number | null>>({});

  async function pollTotalsOnce(handle: string) {
    try {
      const r = await fetch(
        `/api/kols/aggregate?screen_name=${encodeURIComponent(handle)}&days=${days}`,
        { cache: "no-store" },
      );
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok && opts?.onTotals) {
        opts.onTotals(handle, {
          totalTweets: toNum(j?.totals?.totalTweets),
          totalViews: toNum(j?.totals?.totalViews),
          totalEngs: toNum(j?.totals?.totalEngs),
        });
      }
    } catch {}
  }

  function startPolling(handle: string) {
    stopPolling(handle);
    pollRef.current[handle] = window.setInterval(
      () => pollTotalsOnce(handle),
      2000,
    );
  }
  function stopPolling(handle: string) {
    const id = pollRef.current[handle];
    if (id) window.clearInterval(id);
    pollRef.current[handle] = null;
  }

  /**
   * Scan timeline then:
   *  - detect mentions with missingOnly=true (server upserts by trigger_key)
   *  - aggregate shills
   */
  async function scan(rawHandle: string) {
    const h = normalized(rawHandle);
    if (!h) return;

    setScanning((m) => ({ ...m, [h]: true }));
    setScanMsg((m) => ({ ...m, [h]: null }));

    startPolling(h);
    await pollTotalsOnce(h);

    try {
      const res = await fetch("/api/kols/scan-tweets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screen_name: h }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok)
        throw new Error(data?.error ?? `Scan failed: ${res.status}`);

      // After scan: only detect missing mentions, then aggregate shills
      try {
        await fetch("/api/kols/detect-mentions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screen_name: h, days, missingOnly: true }),
        });

        const aggRes = await fetch(
          `/api/kols/aggregate-shills?screen_name=${encodeURIComponent(h)}&days=${days}`,
          { cache: "no-store" },
        );
        const aggJson = await aggRes.json().catch(() => ({}));
        if (aggRes.ok && aggJson?.ok && opts?.onShills) {
          opts.onShills(h, {
            totalShills: toNum(aggJson?.totals?.totalShills),
            shillsViews: toNum(aggJson?.totals?.shillsViews),
            shillsEngs: toNum(aggJson?.totals?.shillsEngs),
            coins: Array.isArray(aggJson?.coins) ? aggJson.coins : [],
          });
        }
      } catch {}

      const inserted = toNum(data?.inserted);
      const updated = toNum(data?.updated);
      const scanned = toNum(data?.scanned);
      setScanMsg((m) => ({
        ...m,
        [h]: `✅ scanned=${scanned}; inserted=${inserted}; updated=${updated}`,
      }));

      await opts?.onAfterScan?.(h);
    } catch (e: any) {
      setScanMsg((m) => ({ ...m, [h]: `❌ ${e?.message ?? String(e)}` }));
    } finally {
      stopPolling(h);
      setScanning((m) => ({ ...m, [h]: false }));
    }
  }

  // expose
  return {
    scanning,
    scanMsg,
    scan,
    _stopAll: () => Object.keys(pollRef.current).forEach(stopPolling),
  };
}
