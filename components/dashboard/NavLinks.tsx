// components/NavLinks.tsx
"use client";

import Link from "next/link";
import clsx from "clsx";
// 兼容你现有的 JS 配置：[{ label, href, disabled?, external? }]
// 如果是 TS 配置文件，改成 "./navLinks.config"
import navLinks from "./navLinks.config";

type NavItem = {
  label: string;
  href: string;
  disabled?: boolean;
  external?: boolean;
};

export default function NavLinks({
  active = "",
  className = "",
  onItemClick,
}: {
  /** 当前路径，用于高亮。示例：usePathname() */
  active?: string;
  /** 外层容器 className（一般用于 gap 控制） */
  className?: string;
  /** 点击任意链接后的回调（移动端用于收起抽屉） */
  onItemClick?: (href: string) => void;
}) {
  const items = (navLinks as NavItem[]).filter(Boolean);

  return (
    <ul className={clsx("flex items-center gap-6", className)}>
      {items.map((item) => {
        const { href, label, disabled, external } = item;
        const isExternal = external || isExternalHref(href);

        const isActive =
          !isExternal &&
          (active === href ||
            (href !== "/" && (active.startsWith(href + "/") || active === href)));

        const base =
          "group relative inline-flex items-center text-sm font-medium transition-colors";
        const color = disabled
          ? "text-white/50 cursor-not-allowed"
          : isActive
          ? "text-white"
          : "text-white/80 hover:text-white";
        const underline =
          "after:absolute after:left-1/2 after:-translate-x-1/2 after:-bottom-1 " +
          "after:h-[2px] after:w-0 after:bg-[#64e3a1] after:rounded-full " +
          "group-hover:after:w-full " +
          (isActive ? "after:w-full" : "after:w-0") +
          " after:transition-all";

        const content = (
          <span className={clsx(base, color, underline)}>
            {label}
            {disabled && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">
                soon
              </span>
            )}
          </span>
        );

        if (disabled) {
          return (
            <li key={href} aria-disabled className="opacity-70">
              <span className="inline-flex items-center">{content}</span>
            </li>
          );
        }

        return (
          <li key={href}>
            {isExternal ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={() => onItemClick?.(href)}
                className="inline-flex items-center"
                aria-label={label}
              >
                {content}
                {/* 外链小箭头 */}
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  aria-hidden="true"
                  className="ml-1 opacity-70 group-hover:opacity-100 transition"
                >
                  <path
                    d="M7 17L17 7M17 7H9M17 7v8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ) : (
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onItemClick?.(href)}
                className="inline-flex items-center"
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- utils ---------- */
function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
}
