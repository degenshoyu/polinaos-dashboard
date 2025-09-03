"use client";

import { memo } from "react";
import type { CoinItem } from "@/components/types";

type Props = {
  coins: CoinItem[];
  max?: number;
};

function CoinsChipListImpl({ coins, max = 6 }: Props) {
  const shown = coins.slice(0, max);
  const rest = Math.max(0, coins.length - shown.length);

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <span
          key={c.tokenKey}
          className="px-2 py-0.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-200 text-xs"
        >
          {c.tokenDisplay}
          {c.count > 1 ? <span className="opacity-70">×{c.count}</span> : null}
        </span>
      ))}
      {rest > 0 && (
        <span className="px-2 py-0.5 rounded-full border border-white/10 text-white/70 text-xs">
          +{rest} more
        </span>
      )}
    </div>
  );
}

const CoinsChipList = memo(CoinsChipListImpl);
export default CoinsChipList;
