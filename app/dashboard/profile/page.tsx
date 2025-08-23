// app/dashboard/profile/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

type Row = {
  id?: string;
  job: string; // unified field
  projectName?: string | null;
  tokenAddress?: string | null;
  createdAt?: string | null;
};

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const wallet = useMemo(() => {
    const u: any = session?.user || {};
    return String(u?.id || u?.address || u?.name || "");
  }, [session]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    (async () => {
      try {
        setErr(null);
        setRows(null);

        const res = await fetch("/api/campaigns?mine=1", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const listRaw: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        const list: Row[] = listRaw
          .map((r) => ({
            id: r.id ?? r._id ?? undefined,
            job: r.job ?? r.jobId ?? "", // <-- normalize here
            projectName: r.projectName ?? null,
            tokenAddress: r.tokenAddress ?? null,
            createdAt: r.createdAt ?? r.created_at ?? null,
          }))
          .filter((r) => r.job); // drop malformed records

        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load recent analyses");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  const title = "Profile · Recent Analysis";

  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        {title}
      </h1>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm text-gray-400">Username (wallet)</div>
        <div className="text-lg font-semibold text-white break-all">{wallet || "—"}</div>
      </div>

      {status === "loading" && (
        <div className="mt-6 text-sm text-gray-400">Loading session…</div>
      )}

      {status === "unauthenticated" && (
        <div className="mt-6 text-sm text-yellow-300">
          Please sign in with your wallet to view your profile and recent analyses.
        </div>
      )}

      {status === "authenticated" && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold text-white mb-3">Recent Analyses</h2>

          {!rows && !err && (
            <div className="text-sm text-gray-400">Fetching your recent analyses…</div>
          )}

          {err && (
            <div className="text-sm text-red-300">Failed to load: {err}</div>
          )}

          {rows && rows.length === 0 && (
            <div className="text-sm text-gray-400">
              No analyses yet. Run your first one in{" "}
              <Link
                href="/dashboard/campaign/analysis"
                className="underline underline-offset-2 text-emerald-300 hover:text-emerald-200"
              >
                Campaign · Analysis
              </Link>.
            </div>
          )}

          {rows && rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((it, idx) => {
                const job = it.job;
                const createdAt = it.createdAt ? new Date(it.createdAt) : null;
                const when = createdAt ? createdAt.toLocaleString() : "—";
                const label =
                  it.projectName?.trim() ||
                  (it.tokenAddress ? `${it.tokenAddress.slice(0, 6)}…${it.tokenAddress.slice(-4)}` : "Untitled");

                return (
                  <li
                    key={it.id || job || idx}
                    className="p-4 rounded-xl border border-white/10 bg-black/20 hover:bg-black/30 transition"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{label}</div>
                        <div className="text-xs text-gray-400">Job: {job}</div>
                        <div className="text-xs text-gray-500">{when}</div>
                      </div>
                      <Link
                        href={`/dashboard/campaign/analysis?job=${encodeURIComponent(job)}`} // <-- correct param
                        className="shrink-0 px-3 py-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 text-sm hover:bg-emerald-400/20"
                        prefetch={false}
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
