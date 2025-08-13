"use client";

import SignInWithSolana from "@/components/SignInWithSolana";
import { useSession, signOut } from "next-auth/react";

export default function HomePage() {
  const { data: session } = useSession();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-6">
      <h1 className="text-2xl font-bold">PolinaOS Demo - Wallet Login Test</h1>

      {session?.user ? (
        <div className="flex flex-col items-center gap-4">
          <p>✅ Logged in as:</p>
          <p className="font-mono break-all">{session?.user?.id}</p>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg"
          >
            Sign Out
          </button>
        </div>
      ) : (
        <SignInWithSolana />
      )}
    </main>
  );
}
