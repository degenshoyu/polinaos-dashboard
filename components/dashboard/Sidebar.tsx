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

// Simple item type for nav rendering
type NavItem = {
  href: string;
  label: string;
  locked?: boolean;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

// Existing Campaign items
const campaignItems: NavItem[] = [
  { href: "/dashboard/campaign/analysis", label: "Analysis", locked: false, Icon: LineChart },
  { href: "/dashboard/campaign/plan",     label: "Plan",     locked: true,  Icon: Lightbulb },
  { href: "/dashboard/campaign/execute",  label: "Execute",  locked: true,  Icon: Rocket },
  { href: "/dashboard/campaign/evaluate", label: "Evaluate", locked: true,  Icon: BarChart3 },
];

// New Leaderboard items
const leaderboardItems: NavItem[] = [
  { href: "/dashboard/leaderboard/kols",     label: "KOLs",     locked: false, Icon: Users },
  { href: "/dashboard/leaderboard/projects", label: "Projects", locked: true,  Icon: Folder },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapsed state in localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sidebar:collapsed");
    if (saved) setCollapsed(saved === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("sidebar:collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Render a single nav item (link or disabled div)
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
      <Link key={href} href={href} className={className} title={collapsed ? label : undefined}>
        {content}
      </Link>
    );
  };

  return (
    <aside
      className={[
        "shrink-0 border-r border-white/10 bg-white/[0.02] transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-[68px]" : "w-[220px]",
      ].join(" ")}
    >
      {/* Campaign section header with collapse button */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="text-xs uppercase tracking-wider text-gray-400">
          {!collapsed ? "Campaign" : <span className="sr-only">Campaign</span>}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-white/10 text-gray-300 hover:text-white hover:border-white/20"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Campaign nav */}
      <nav className="px-2 pb-2 space-y-1">
        {campaignItems.map(renderItem)}
      </nav>

      {/* Leaderboard section header (no collapse button here) */}
      <div className="px-3 pt-3 pb-2">
        <div className="text-xs uppercase tracking-wider text-gray-400">
          {!collapsed ? "Leaderboard" : <span className="sr-only">Leaderboard</span>}
        </div>
      </div>

      {/* Leaderboard nav */}
      <nav className="px-2 pb-4 space-y-1">
        {leaderboardItems.map(renderItem)}
      </nav>
    </aside>
  );
}
