// components/dashboard/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LineChart,       // Analysis
  Lightbulb,       // Plan
  Rocket,          // Execute
  BarChart3,       // Evaluate
  Lock,
  ChevronLeft,
  ChevronRight,
  Users,           // Leaderboard: KOLs
  Folder,          // Leaderboard: Projects
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  locked?: boolean;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

const campaignItems: NavItem[] = [
  { href: "/dashboard/campaign/analysis", label: "Analysis", locked: false, Icon: LineChart },
  { href: "/dashboard/campaign/plan",     label: "Plan",     locked: true,  Icon: Lightbulb },
  { href: "/dashboard/campaign/execute",  label: "Execute",  locked: true,  Icon: Rocket },
  { href: "/dashboard/campaign/evaluate", label: "Evaluate", locked: true,  Icon: BarChart3 },
];

const leaderboardItems: NavItem[] = [
  { href: "/dashboard/leaderboard/kols",     label: "KOLs",     locked: false, Icon: Users },
  { href: "/dashboard/leaderboard/projects", label: "Projects", locked: true,  Icon: Folder },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // persist collapsed state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("sidebar:collapsed");
    if (saved) setCollapsed(saved === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("sidebar:collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const renderItem = ({ href, label, locked, Icon }: NavItem) => {
    const active = pathname.startsWith(href);
    const disabled = Boolean(locked);

    const baseClass =
      "group relative flex items-center rounded-md px-2 py-2 text-sm focus:outline-none";
    const activeClass = active
      ? "bg-[#0f1b17] text-white border border-white/10"
      : "text-gray-300 hover:bg-white/5";
    const disabledClass = disabled ? "opacity-60 cursor-not-allowed" : "";
    const className = [
      baseClass,
      activeClass,
      disabledClass,
      collapsed ? "justify-center" : "",
    ].join(" ");

    const content = (
      <>
        <span className="inline-flex items-center justify-center w-8">
          <Icon size={18} className={active ? "text-emerald-300" : "text-gray-300"} />
        </span>

        {!collapsed && <span className="ml-2 truncate">{label}</span>}

        {locked && (
          <span className="ml-auto">
            <Lock size={14} className="text-gray-400" />
          </span>
        )}

        {collapsed && (
          <span
            className="pointer-events-none absolute left-[64px] top-1/2 -translate-y-1/2 whitespace-nowrap
                       rounded-md bg-black/80 text-white text-[11px] px-2 py-1 opacity-0
                       group-hover:opacity-100 transition-opacity border border-white/10"
            role="tooltip"
          >
            {label} {locked ? " (Locked)" : ""}
          </span>
        )}
      </>
    );

    return disabled ? (
      <div key={href} aria-disabled className={className} title={collapsed ? label : undefined}>
        {content}
      </div>
    ) : (
      <Link
        key={href}
        href={href}
        className={className}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
      >
        {content}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar (Leaderboard section first) */}
      <aside
        className={[
          "hidden md:block shrink-0 border-r border-white/10 bg-white/[0.02] transition-[width] duration-200 overflow-hidden",
          collapsed ? "w-[68px]" : "w-[220px]",
        ].join(" ")}
      >
        {/* Leaderboard header + collapse */}
        <div className="flex items-center justify-between px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gray-400">
            {!collapsed ? "Leaderboard" : <span className="sr-only">Leaderboard</span>}
          </div>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-white/10 text-gray-300 hover:text-white hover:border-white/20"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            type="button"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Leaderboard nav */}
        <nav className="px-2 pb-2 space-y-1">
          {leaderboardItems.map(renderItem)}
        </nav>

        {/* Campaign header */}
        <div className="px-3 pt-3 pb-2">
          <div className="text-xs uppercase tracking-wider text-gray-400">
            {!collapsed ? "Campaign" : <span className="sr-only">Campaign</span>}
          </div>
        </div>

        {/* Campaign nav */}
        <nav className="px-2 pb-4 space-y-1">
          {campaignItems.map(renderItem)}
        </nav>
      </aside>

      {/* Spacer so content isn't covered by mobile bar */}
      <div className="h-16 md:hidden" aria-hidden />

      {/* Mobile bottom nav (hide locked items) */}
      <nav
        className="
          md:hidden fixed bottom-0 inset-x-0 z-40
          border-t border-white/10
          bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40
          px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2
        "
        role="navigation"
        aria-label="Bottom navigation"
      >
        <ul className="flex gap-1 overflow-x-auto no-scrollbar">
          {[...leaderboardItems, ...campaignItems]
            .filter((i) => !i.locked) // mobile: hide locked tabs
            .map(({ href, label, Icon }) => {
              const active = pathname.startsWith(href);
              const base =
                "flex flex-col items-center justify-center rounded-xl px-2 py-2 text-xs min-w-[80px]";
              const activeCls = active
                ? "bg-[#0f1b17] text-white border border-white/10"
                : "text-gray-300 hover:bg-white/5";
              return (
                <li key={href} className="flex-1">
                  <Link
                    href={href}
                    className={`${base} ${activeCls}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={18} className={active ? "text-emerald-300" : "text-gray-300"} />
                    <span className="mt-1 truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </>
  );
}
