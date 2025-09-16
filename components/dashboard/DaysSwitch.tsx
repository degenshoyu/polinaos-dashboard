"use client";

/**
 * DaysSwitch: 7d / 30d segmented control with inline loading
 * - Updates ?days=7|30 via router.push
 * - Shows a small spinner while navigation is pending
 */

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Loader2 } from "lucide-react";

export default function DaysSwitch({ days }: { days: 7 | 30 }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const setDays = (d: 7 | 30) => {
    const p = new URLSearchParams(sp?.toString() || "");
    p.set("days", String(d));
    startTransition(() => {
      router.push(`?${p.toString()}`);
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
        {[7, 30].map((d) => {
          const active = days === (d as 7 | 30);
          return (
            <button
              key={d}
              onClick={() => setDays(d as 7 | 30)}
              className={[
                "px-3 py-1.5 text-xs md:text-sm rounded-full transition",
                active
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/20"
                  : "text-gray-300 hover:text-white",
              ].join(" ")}
              aria-pressed={active}
            >
              {d}d
            </button>
          );
        })}
      </div>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-300" /> : null}
    </div>
  );
}

