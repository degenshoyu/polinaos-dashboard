"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  UserCog,       // KOLs
  MessageSquare, // Tweets
  Coins,         // Coins mentioned
  Lock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  locked?: boolean;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

const adminItems: NavItem[] = [
  { href: "/admin/kols",         label: "KOLs",          locked: false, Icon: UserCog },
  { href: "/admin/kols/tweets",  label: "Tweets",        locked: false, Icon: MessageSquare },
  { href: "/admin/kols/coins",   label: "Coins Mentioned", locked: true,  Icon: Coins }, // 先锁定
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // 持久化折叠状态
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("admin:sidebar:collapsed");
    if (saved) setCollapsed(saved === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("admin:sidebar:collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const renderItem = ({ href, label, locked, Icon }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + "/");
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

        {/* 折叠时悬浮提示 */}
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
      {/* Desktop sidebar */}
      <aside
        className={[
          "hidden md:block shrink-0 border-r border-white/10 bg-white/[0.02] transition-[width] duration-200 overflow-hidden",
          collapsed ? "w-[68px]" : "w-[220px]",
        ].join(" ")}
      >
        {/* Header + collapse button */}
        <div className="flex items-center justify-between px-3 py-3">
          <div className="text-xs uppercase tracking-wider text-gray-400">
            {!collapsed ? "Admin" : <span className="sr-only">Admin</span>}
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

        {/* Nav */}
        <nav className="px-2 pb-4 space-y-1">
          {adminItems.map(renderItem)}
        </nav>
      </aside>

      {/* 为了不遮挡内容区域的底部导航占位（仅移动端） */}
      <div className="h-16 md:hidden" aria-hidden />

      {/* Mobile bottom nav（隐藏 locked） */}
      <nav
        className="
          md:hidden fixed bottom-0 inset-x-0 z-40
          border-t border-white/10
          bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40
          px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2
        "
        role="navigation"
        aria-label="Admin bottom navigation"
      >
        <ul className="flex gap-1 overflow-x-auto no-scrollbar">
          {adminItems
            .filter((i) => !i.locked)
            .map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              const base =
                "flex flex-col items-center justify-center rounded-xl px-2 py-2 text-xs min-w-[100px]";
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

