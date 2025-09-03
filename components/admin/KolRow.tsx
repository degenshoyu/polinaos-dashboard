"use client";

import { memo } from "react";
import { ScanLine } from "lucide-react";
import type { KolRow as Row, Totals, ShillAgg } from "@/components/types";
import { fmtER } from "@/lib/kols";

type Props = {
  row: Row;
  totals: Totals;
  shills: ShillAgg | null;
  coinsEl: React.ReactNode;
  updating?: boolean;
  scanning?: boolean;
  scanMsg?: string | null;
  onScan: (handle: string) => void;
  onUpdate?: (handle: string) => void;
};

function KolRowImpl({ row, totals, shills, coinsEl, updating, scanning, scanMsg, onScan, onUpdate }: Props) {
  const h = row.twitterUsername;
  const views = totals.totalViews;
  const engs = totals.totalEngs;

  return (
    <tr className="[&>td]:px-3 [&>td]:py-2 align-top">
      {/* KOL */}
      <td className="min-w-[180px]">
        <div className="flex items-center gap-3">
          {row.profileImgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.profileImgUrl}
              alt={h}
              className="w-8 h-8 rounded-full object-cover border border-white/10"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-white/10" />
          )}
          <div>
            <div className="font-medium text-white leading-tight">@{h}</div>
            <div className="text-xs text-gray-400">
              {(row.displayName && <span>{row.displayName}</span>) || <span>—</span>} ·{" "}
              <span>{(row.followers ?? 0).toLocaleString()} followers</span>
            </div>
          </div>
        </div>
      </td>

      {/* Totals */}
      <td>
        <div className="text-gray-200">
          <div className="flex items-center gap-3">
            <span>Tweets: <b>{totals.totalTweets.toLocaleString()}</b></span>
            <span>Views: <b>{views.toLocaleString()}</b></span>
            <span>Engs: <b>{engs.toLocaleString()}</b></span>
          </div>
          <div className="text-xs text-emerald-300 mt-0.5">ER: {fmtER(views, engs)}</div>
        </div>
      </td>

      {/* Shills */}
      <td>
        {shills ? (
          <div className="text-gray-200">
            <div className="flex items-center gap-3">
              <span>Shills: <b>{(shills.totalShills || 0).toLocaleString()}</b></span>
              <span>Views: <b>{(shills.shillsViews || 0).toLocaleString()}</b></span>
              <span>Engs: <b>{(shills.shillsEngs || 0).toLocaleString()}</b></span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              ER: {fmtER(shills.shillsViews || 0, shills.shillsEngs || 0)}
            </div>
          </div>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </td>

      {/* Coins */}
      <td>{coinsEl}</td>

      {/* Actions */}
      <td>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onScan(h)}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-xs disabled:opacity-60"
            title="Scan Timeline (last 7d)"
          >
            <ScanLine className={`w-4 h-4 ${scanning ? "animate-pulse" : ""}`} />
            {scanning ? "Scanning…" : "Scan 7d"}
          </button>

          <button
            onClick={() => onUpdate?.(h)}
            disabled={updating}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 hover:bg-white/10 text-xs disabled:opacity-60"
          >
            {updating ? (
              <span className="inline-block w-3 h-3 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />
            ) : null}
            Update
          </button>
        </div>

        {scanMsg && <div className="text-[11px] text-gray-400 mt-1">{scanMsg}</div>}
      </td>
    </tr>
  );
}

// Prevent re-render unless these shallow bits change
const KolRow = memo(KolRowImpl, (prev, next) => {
  return (
    prev.row === next.row &&
    prev.totals.totalTweets === next.totals.totalTweets &&
    prev.totals.totalViews === next.totals.totalViews &&
    prev.totals.totalEngs === next.totals.totalEngs &&
    JSON.stringify(prev.shills) === JSON.stringify(next.shills) &&
    prev.updating === next.updating &&
    prev.scanning === next.scanning &&
    prev.scanMsg === next.scanMsg &&
    prev.coinsEl === next.coinsEl
  );
});

export default KolRow;
