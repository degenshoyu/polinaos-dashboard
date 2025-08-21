"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { AnalysisInput } from "./types";

/** Safe string helper */
const ensureString = (v: unknown): string | undefined => {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : undefined;
  }
  return undefined;
};

/** Accepts @handle or https://x.com/handle and returns the plain handle */
const handleFromUrlOrAt = (s?: string): string | undefined => {
  if (!s) return undefined;
  const raw = s.trim();
  if (!raw) return undefined;
  if (!raw.includes("://")) return raw.replace(/^@/, "");
  try {
    const u = new URL(raw);
    const seg = u.pathname.split("/").filter(Boolean)[0] || "";
    return seg.replace(/^@/, "") || raw.replace(/^@/, "");
  } catch {
    return raw.replace(/^@/, "");
  }
};

/** Parse localStorage JSON, swallow errors */
const parseSafe = (key: string) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

type Mode = "edit" | "summary";

export const InputCard: React.FC<{
  onRun: (input: AnalysisInput) => void;
}> = ({ onRun }) => {
  const [form, setForm] = useState<AnalysisInput>({
    projectName: "",
    website: "",
    xProfile: "",
    xCommunity: "",
    telegram: "",
    tokenAddress: "",
  });

  /** UI mode: input editor vs. summary view */
  const [mode, setMode] = useState<Mode>("edit");

  /** Simple confirm dialog toggles */
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Merge URL params + localStorage on mount
  useEffect(() => {
    const url = new URL(window.location.href);
    const qp: AnalysisInput = {
      projectName: ensureString(url.searchParams.get("projectName")),
      website: ensureString(url.searchParams.get("website")),
      xProfile: handleFromUrlOrAt(ensureString(url.searchParams.get("xProfile"))),
      xCommunity: ensureString(url.searchParams.get("xCommunity")),
      telegram: ensureString(url.searchParams.get("telegram")),
      tokenAddress: ensureString(url.searchParams.get("tokenAddress")),
    } as any;

    const stored = (parseSafe("campaignDraft") ?? {}) as Partial<AnalysisInput>;
    const merged: AnalysisInput = {
      projectName: qp.projectName ?? ensureString(stored.projectName),
      website: qp.website ?? ensureString(stored.website),
      xProfile: qp.xProfile ?? handleFromUrlOrAt(ensureString(stored.xProfile)),
      xCommunity: qp.xCommunity ?? ensureString(stored.xCommunity),
      telegram: qp.telegram ?? ensureString(stored.telegram),
      tokenAddress: qp.tokenAddress ?? ensureString(stored.tokenAddress),
    } as any;

    setForm((f) => ({ ...f, ...merged }));
  }, []);

  // Autosave to localStorage on form change
  useEffect(() => {
    localStorage.setItem("campaignDraft", JSON.stringify(form));
  }, [form]);

  // Minimal “can analyze” gating
  const canAnalyze = useMemo(() => {
    return Boolean(
      (form.projectName && form.projectName.trim()) ||
        (form.xProfile && form.xProfile.trim()) ||
        (form.tokenAddress && form.tokenAddress.trim())
    );
  }, [form]);

  /** Trigger analysis then switch to summary mode */
  const handleAnalyze = () => {
    if (!canAnalyze) return;
    onRun(form);
    setMode("summary");
  };

  /** Summary “Rescan” button */
  const handleRescanClick = () => {
    setConfirmOpen(true);
  };

  /** Confirm dialog actions */
  const confirmRescan = () => {
    setConfirmOpen(false);
    setMode("edit"); // go back to editable inputs
  };
  const cancelRescan = () => {
    setConfirmOpen(false);
  };

  /** Small presenter to render each non-empty field as a chip */
  const Chip = ({ label, value }: { label: string; value?: string | null }) => {
    if (!value) return null;
    const v = String(value).trim();
    if (!v) return null;
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-gray-200">
        <span className="text-white/70">{label}:</span>
        <span className="font-medium">{v}</span>
      </div>
    );
  };

  return (
    <div className="p-6 w-full rounded-2xl shadow-2xl bg-gradient-to-br from-[#101c1b] via-[#0c1111] to-[#0a0f0e] border border-white/5 relative">
      <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-[#2fd480] via-[#3ef2ac] to-[#27a567] text-transparent bg-clip-text">
        Campaign · Input
      </h2>

      {/* ====== EDIT MODE ====== */}
      {mode === "edit" && (
        <>
          <div className="space-y-3">
            <input
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
              placeholder="Project name (e.g. PolinaOS)"
              value={form.projectName || ""}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            />
            <input
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
              placeholder="X profile (e.g. @PolinaAIOS or https://x.com/PolinaAIOS)"
              value={form.xProfile || ""}
              onChange={(e) =>
                setForm({ ...form, xProfile: handleFromUrlOrAt(e.target.value) || "" })
              }
            />
            <input
              className="w-full px-3 py-2 bg-[#0d0d0d] border border-[#333] focus:ring-2 focus:ring-[#64e3a1] rounded-md text-white placeholder:text-gray-500 text-sm"
              placeholder="Token contract address"
              value={form.tokenAddress || ""}
              onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })}
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#27a567] to-[#2fd480] hover:from-[#239e5d] hover:to-[#38ec9c] text-white rounded-md text-sm font-semibold transition shadow disabled:opacity-50"
          >
            {canAnalyze ? "✨ Analyze" : "Fill one of: Project / X / Token"}
          </button>
        </>
      )}

      {/* ====== SUMMARY MODE ====== */}
      {mode === "summary" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            You are viewing a brief summary of the inputs used for this analysis.
          </p>

          <div className="flex flex-wrap gap-2">
            <Chip label="Project" value={form.projectName} />
            <Chip label="X Profile" value={form.xProfile ? `@${form.xProfile.replace(/^@/, "")}` : ""} />
            <Chip label="Token" value={form.tokenAddress} />
            {form.website && <Chip label="Website" value={form.website} />}
            {form.xCommunity && <Chip label="X Community" value={form.xCommunity} />}
            {form.telegram && <Chip label="Telegram" value={form.telegram} />}
          </div>

          <button
            onClick={handleRescanClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-sm font-medium"
          >
            ↻ Rescan
          </button>
        </div>
      )}

      {/* ====== CONFIRM DIALOG (inline) ====== */}
      {confirmOpen && (
        <div
          className="
            absolute inset-0 z-10 flex items-center justify-center
            bg-black/50 backdrop-blur-sm
          "
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1413] p-5 shadow-xl">
            <h3 className="text-base font-semibold text-white mb-2">Rescan confirmation</h3>
            <p className="text-sm text-gray-300">
              Do you really want to rescan? You will return to the editable input form.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={cancelRescan}
                className="px-3 py-1.5 rounded-md border border-white/15 bg-white/5 hover:bg-white/10 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmRescan}
                className="px-3 py-1.5 rounded-md bg-gradient-to-r from-[#27a567] to-[#2fd480] hover:from-[#239e5d] hover:to-[#38ec9c] text-sm text-white rounded-md"
              >
                Yes, rescan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

