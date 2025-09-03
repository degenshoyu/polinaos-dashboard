// components/admin/ImportCard.tsx

"use client";

import { useState } from "react";

export default function ImportCard({
  onImported,
  toast,
}: {
  onImported: () => Promise<void>;
  toast?: string | null;
}) {
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
      await onImported();
    } catch (e: any) {
      setImportMsg(`❌ ${e?.message ?? e}`);
    } finally {
      setImportLoading(false);
    }
  };

  return (
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
  );
}
