"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import navLinks from "./navLinks.config";

// 钱包登录按钮
const WalletButton = dynamic(() => import("../SignInWithSolana"), { ssr: false });

export default function MobileMenu({ active = "" }: { active?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // 打开后聚焦，关闭后还原焦点
  useEffect(() => {
    if (isOpen) setTimeout(() => firstFocusRef.current?.focus(), 0);
    else setTimeout(() => openBtnRef.current?.focus(), 0);
  }, [isOpen]);

  return (
    <>
      <button
        ref={openBtnRef}
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        aria-expanded={isOpen}
        className="text-white hover:text-[#64e3a1] focus:outline-none"
      >
        <Menu size={26} />
      </button>

      {/* Overlay */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 z-[998] bg-black/80 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!isOpen}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal={isOpen}
        className={`fixed inset-y-0 right-0 z-[999] w-full max-w-sm bg-gray-950 p-6 shadow-xl
                    transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex justify-between items-center mb-6">
          <span className="text-white font-bold text-lg">Menu</span>
          <button
            ref={firstFocusRef}
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            className="text-white hover:text-[#64e3a1]"
          >
            <X size={24} />
          </button>
        </div>

        {/* 钱包登录 */}
        <div className="mb-5">
          <WalletButton />
        </div>

        {/* 链接（仅三项） */}
        <nav className="flex flex-col space-y-4">
          {navLinks.map(({ label, href, external }) =>
            external ? (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={() => setIsOpen(false)}
                className="text-white font-medium transition hover:text-[#64e3a1]"
              >
                {label}
              </a>
            ) : (
              <Link
                key={label}
                href={href}
                onClick={() => setIsOpen(false)}
                className={`text-white font-medium transition hover:text-[#64e3a1] ${
                  active === href ? "text-[#64e3a1]" : ""
                }`}
              >
                {label}
              </Link>
            )
          )}
        </nav>
      </aside>
    </>
  );
}

