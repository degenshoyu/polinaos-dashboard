//app/dashboard/kols/page.tsx

"use client";

import { useEffect, useMemo, useState } from "react";

type KolRow = {
  twitterUid: string | null;
  twitterUsername: string;
  displayName?: string | null;
  followers?: number | null;
  following?: number | null;
  bio?: string | null;
  profileImgUrl?: string | null;
  accountCreationDate?: string | null;
  active?: boolean | null;
  notes?: string | null;
};

export default function KolsImportPage() {
  // ===== 左侧：导入 handle =====
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
      await reload(); // 导入后刷新右侧列表
    } catch (e: any) {
      setImportMsg(`❌ ${e?.message ?? e}`);
    } finally {
      setImportLoading(false);
    }
  };

  // ===== 右侧：KOL 列表 =====
  const [rows, setRows] = useState<KolRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.twitterUsername.toLowerCase().includes(q) ||
      (r.displayName ?? "").toLowerCase().includes(q) ||
      (r.bio ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  const reload = async () => {
    setLoadingList(true);
    setErrorList(null);
    try {
      const r = await fetch("/api/kols/all", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error ?? "load failed");
      setRows(data.items ?? []);
    } catch (e: any) {
      setErrorList(e?.message ?? "failed to load");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // 每行的更新状态
  const [updating, setUpdating] = useState<Record<string, boolean>>({}); // key = handle
  const [toast, setToast] = useState<string | null>(null);

  const updateOne = async (handle: string) => {
    const h = handle.replace(/^@+/, "").toLowerCase();
    setUpdating((m) => ({ ...m, [h]: true }));
    setToast(null);
    try {
      // 后端封装：内部用 /api/cts/user/by-username + /api/jobProxy 轮询并入库
      const res = await fetch("/api/kols/resolve-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screen_name: h }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "resolve failed");
      setToast(`✅ Updated @${h} (followers: ${data?.user?.followers ?? "?"})`);
      await reload(); // 刷新列表
    } catch (e: any) {
      setToast(`❌ @${h}: ${e?.message ?? e}`);
    } finally {
      setUpdating((m) => ({ ...m, [h]: false }));
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">KOL Registry</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Import */}
        <div className="lg:col-span-1 space-y-4 rounded-2xl p-4 bg-white/5 backdrop-blur border border-white/10">
          <div className="space-y-2">
            <div className="text-sm opacity-70">
              Paste <b>one handle per line</b>. “@” is optional (we’ll normalize).
            </div>
            <textarea
              className="w-full h-56 rounded-2xl p-3 bg-white/5 border border-white/10 outline-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="@handle\nanother_handle\nthirdhandle"
            />
            <button
              onClick={submit}
              disabled={importLoading}
              className="w-full rounded-xl px-4 py-2 border border-white/10 hover:bg-white/10"
            >
              {importLoading ? "Importing…" : "Import"}
            </button>
            {importMsg && <div className="text-xs">{importMsg}</div>}
          </div>

          {toast && <div className="text-xs mt-2">{toast}</div>}
        </div>

        {/* Right: List */}
        <div className="lg:col-span-3 rounded-2xl p-4 bg-white/5 backdrop-blur border border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <input
              className="w-64 max-w-full bg-transparent border rounded px-3 py-2"
              placeholder="Search handle / name / bio"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              onClick={reload}
              disabled={loadingList}
              className="rounded-xl px-3 py-2 border border-white/10 hover:bg-white/10"
            >
              {loadingList ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {errorList ? (
            <div className="text-sm text-red-300">{errorList}</div>
          ) : !rows.length && !loadingList ? (
            <div className="text-sm opacity-60">No KOLs yet. Import some on the left.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="py-2 pr-4">KOL</th>
                    <th className="py-2 pr-4">Followers</th>
                    <th className="py-2 pr-4">Following</th>
                    <th className="py-2 pr-4">Bio</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const handle = r.twitterUsername;
                    const isLoading = !!updating[handle];
                    return (
                      <tr key={handle} className="border-t border-white/10 align-top">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex items-center justify-center">
                              {r.profileImgUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.profileImgUrl} alt={handle} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs">@</span>
                              )}
                            </div>
                            <div>
                              <div className="font-medium">@{handle}</div>
                              {r.displayName && (
                                <div className="text-xs opacity-70">{r.displayName}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-4">{r.followers?.toLocaleString?.() ?? "—"}</td>
                        <td className="py-2 pr-4">{r.following?.toLocaleString?.() ?? "—"}</td>
                        <td className="py-2 pr-4 max-w-[28rem]">
                          <div className="line-clamp-2 opacity-80">{r.bio ?? "—"}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <button
                            onClick={() => updateOne(handle)}
                            disabled={isLoading}
                            className="rounded-xl px-3 py-2 border border-white/10 hover:bg-white/10"
                            aria-label={`Update ${handle}`}
                          >
                            {isLoading ? "Updating…" : "Update"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {loadingList && <div className="text-xs opacity-60 mt-3">Loading…</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
