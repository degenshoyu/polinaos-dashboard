"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
        aria-expanded={open}
      >
        {icon}
        {label}
        <ChevronDown size={14} className="opacity-80" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#0b0f0e]/95 p-1 shadow-2xl backdrop-blur"
          role="menu"
        >
          {children}
        </div>
      )}
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
