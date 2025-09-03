"use client";

import { useEffect, useState } from "react";
import KolTable from "@/components/admin/KolTable";
import type { KolRow } from "@/components/types";

import ImportCard from "@/components/admin/ImportCard";


export default function KolsImportPage() {
  /** ========== KOL list data ========== */
  const [rows, setRows] = useState<KolRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const reload = async () => {
    setLoadingList(true);
    setErrorList(null);
    try {
      const r = await fetch("/api/kols/all", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "load failed");
      setRows((data.items ?? []) as KolRow[]);
    } catch (e: any) {
      setErrorList(e?.message ?? "failed to load");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const updateOne = async (handle: string) => {
    const h = handle.replace(/^@+/, "").toLowerCase();
    setUpdating((m) => ({ ...m, [h]: true }));
    setToast(null);
    try {
      const res = await fetch("/api/kols/resolve-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screen_name: h }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "resolve failed");
      setToast(`✅ Updated @${h} (followers: ${data?.user?.followers ?? "?"})`);
      await reload();
    } catch (e: any) {
      setToast(`❌ @${h}: ${e?.message ?? e}`);
    } finally {
      setUpdating((m) => ({ ...m, [h]: false }));
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">KOL Registry</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:max-w-md">
          <ImportCard onImported={reload} toast={toast} />
        </div>
        <div className="hidden lg:block flex-1" />
      </div>

      {errorList ? (
        <div className="text-sm text-red-300">{errorList}</div>
      ) : (
        <KolTable
          rows={rows}
          loading={loadingList}
          onRefresh={reload}
          onUpdateOne={updateOne}
          updatingMap={updating}
        />
      )}
    </div>
  );
}
