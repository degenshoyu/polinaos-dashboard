"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import NavLinks from "./NavLinks";
import MobileMenu from "./MobileMenu";
import { useSession, signOut } from "next-auth/react";

const WalletButton = dynamic(() => import("../SignInWithSolana"), { ssr: false });

function pickWalletFromSession(session: any): string {
  const u = session?.user || {};
  return String(u.address);
  // return String(u.id || u.address || u.name || "");
}

function shorten(addr?: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const sessionWallet = pickWalletFromSession(session);
  const isLoggedIn = !!sessionWallet;

  const WalletPill = (
    <Link
      href="/dashboard/profile"
      className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-sm font-medium hover:bg-white/10 transition-colors"
      title={sessionWallet}
      aria-label="Open profile"
      prefetch={false}
    >
      {shorten(sessionWallet)}
    </Link>
  );

  return (
    <header className="sticky top-0 z-50 flex justify-center px-3 py-4 md:px-4">
      <div
        className="
          w-full max-w-6xl rounded-full
          bg-white/[0.06] border border-white/10 backdrop-blur-xl
          shadow-[0_8px_30px_rgba(0,0,0,0.12)]
          px-4 md:px-6 py-2 md:py-2.5
          flex items-center justify-between
        "
      >
        {/* Logo */}
        <Link href="https://www.polinaos.com/" prefetch={false} className="flex items-center gap-2">
          <Image
            src="/logo-polina.png"
            alt="PolinaOS"
            width={32}
            height={32}
            className="rounded-full"
            priority
          />
          <span className="hidden sm:inline-block text-white font-bold text-base md:text-lg">
            PolinaOS
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <NavLinks active={pathname || ""} />
        </nav>

        {/* Right actions (desktop) */}
        <div className="hidden md:flex items-center gap-2">
          {isLoggedIn ? (
            <>
              {WalletPill}
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-sm font-medium"
              >
                Sign out
              </button>
            </>
          ) : (
            <WalletButton />
          )}
        </div>

        {/* Mobile */}
        <div className="md:hidden flex items-center gap-2">
          {isLoggedIn ? (
            <>
              {WalletPill}
              <button
                onClick={() => signOut()}
                className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-sm font-medium"
              >
                Sign out
              </button>
            </>
          ) : (
            <WalletButton />
          )}
          <MobileMenu active={pathname || ""} />
        </div>
      </div>
    </header>
  );
}
