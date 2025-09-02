// app/dashboard/kols/page.tsx
"use client";

import { useEffect, useState } from "react";
import KolTable, { type KolRow } from "@/components/dashboard/KolTable";

export default function KolsImportPage() {
  /** ========== Import card (top, narrow) ========== */
  const [text, setText] = useState("@slingdeez\npolinaaios\n@degenshoyu");
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const submit = async () => {
    setImportLoading(true);
    setImportMsg(null);
    try {
      const r = await fetch("/api/kols/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ? JSON.stringify(data.error) : "Import failed");
      setImportMsg(`✅ Imported: ${data.inserted}, Updated: ${data.updated}, Total: ${data.total}`);
      await reload();
    } catch (e: any) {
      setImportMsg(`❌ ${e?.message ?? e}`);
    } finally {
      setImportLoading(false);
    }
  };

  /** ========== KOL list data ========== */
  const [rows, setRows] = useState<KolRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);

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

  /** ========== per-row update ========== */
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

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

  /** ========== Render ========== */
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">KOL Registry</h1>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:max-w-md">
          <div className="space-y-4 rounded-2xl p-4 bg-white/5 backdrop-blur border border-white/10 text-[13px]">
            <div className="space-y-2">
              <div className="text-sm opacity-70">
                Paste <b>one handle per line</b>. “@” is optional (we’ll normalize).
              </div>
              <textarea
                className="w-full h-56 rounded-2xl p-2.5 bg-white/5 border border-white/10 outline-none"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="@handle\nanother_handle\nthirdhandle"
              />
              <button
                onClick={submit}
                disabled={importLoading}
                className="w-full rounded-xl px-4 py-1.5 border border-white/10 hover:bg-white/10"
              >
                {importLoading ? "Importing…" : "Import"}
              </button>
              {importMsg && <div className="text-xs">{importMsg}</div>}
            </div>

            {toast && <div className="text-[12px] mt-2">{toast}</div>}

          </div>
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
