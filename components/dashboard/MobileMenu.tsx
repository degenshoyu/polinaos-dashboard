"use client";

import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import navLinks from "./navLinks.config";

const WalletButton = dynamic(() => import("../SignInWithSolana"), { ssr: false });

export default function MobileMenu({ active = "" }: { active?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  // 锁滚动
  useEffect(() => {
    if (!isOpen) return;
    const { body } = document;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { body.style.overflow = prev; };
  }, [isOpen]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
        className="text-white hover:text-[#64e3a1] focus:outline-none"
      >
        <Menu size={26} />
      </button>

      <Transition show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[9999]" onClose={setIsOpen}>
          {/* 实色遮罩：不做透明过渡，避免“开场透光” */}
          <div className="fixed inset-0 bg-black" aria-hidden onClick={() => setIsOpen(false)} />

          {/* Drawer 只做位移动画 */}
          <Transition.Child
            as={Fragment}
            enter="transition-transform duration-300 ease-out"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transition-transform duration-200 ease-in"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <Dialog.Panel className="fixed inset-y-0 right-0 w-full max-w-sm bg-gray-950 p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <span className="text-white font-bold text-lg">Menu</span>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close menu"
                  className="text-white hover:text-[#64e3a1]"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="mb-5">
                <WalletButton />
              </div>

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
                      className={`text-white font-medium transition hover:text-[#64e3a1] ${active === href ? "text-[#64e3a1]" : ""}`}
                    >
                      {label}
                    </Link>
                  )
                )}
              </nav>
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>
    </>
  );
}

