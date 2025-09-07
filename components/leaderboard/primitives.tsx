"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";

export function Tooltip({
  children,
  text,
  side = "top",
}: {
  children: React.ReactNode;
  text: React.ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        className={[
          "pointer-events-none absolute z-40 hidden w-[300px] rounded-xl border border-white/10 bg-[#0b0f0e]/95 p-3 text-[12px] text-gray-200 shadow-2xl backdrop-blur",
          "group-hover:block",
          side === "top"
            ? "bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2"
            : "top-[calc(100%+10px)] left-1/2 -translate-x-1/2",
        ].join(" ")}
        role="tooltip"
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 border border-white/10 bg-[#0b0f0e]/95"
          style={side === "top" ? { bottom: -4 } : { top: -4 }}
        />
        {text}
      </span>
    </span>
  );
}

export function Dropdown({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Compute portal menu position (align-right) when open / on resize / on scroll
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const GAP = 8;
      const MENU_W = 224; // w-56
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // align-right to trigger, clamp within viewport with 8px padding
      const prefLeft = rect.right - MENU_W;
      const left = Math.max(8, Math.min(prefLeft, vw - 8 - MENU_W));
      const top = Math.max(8, Math.min(rect.bottom + GAP, vh - 8)); // let height auto
      setCoords({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative z-[70]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
        aria-expanded={open}
      >
        {icon}
        {label}
        <ChevronDown size={14} className="opacity-80" />
      </button>

      {open && coords &&
        createPortal(
          <div
            role="menu"
            // fixed to viewport; portal avoids ancestor overflow/stacking traps
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[9999] w-56 max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-[#0b0f0e]/95 p-1 shadow-2xl backdrop-blur"
          >
            {children}
          </div>,
          document.body
        )
      }
    </div>
  );
}

export function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm",
        active ? "bg-emerald-400/15 text-emerald-200" : "text-gray-200 hover:bg-white/5",
      ].join(" ")}
      role="menuitem"
    >
      <span>{children}</span>
      {active ? <span className="h-2 w-2 rounded-full bg-emerald-300" /> : null}
    </button>
  );
}
