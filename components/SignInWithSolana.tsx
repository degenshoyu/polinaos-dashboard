"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";

export default function SignInWithSolana() {
  const { publicKey, signMessage, connected, select } = useWallet();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignIn = async () => {
    try {
      if (!connected) {
        const phantom = new PhantomWalletAdapter();
        select(phantom.name);
        return;
      }

      if (!publicKey || !signMessage) {
        alert("Please connect your wallet first.");
        return;
      }

      setLoading(true);

      const message = `Sign this message to authenticate with PolinaOS Demo.\nWallet: ${publicKey.toBase58()}\nTime: ${new Date().toISOString()}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signature = await signMessage(encodedMessage);

      const res = await signIn("credentials", {
        publicKey: publicKey.toBase58(),
        message,
        signature: bs58.encode(signature),
        redirect: false,
      });

      if (res?.error) {
        alert(`Login failed: ${res.error}`);
        return;
      }

      alert("Login successful!");
      router.push("/dashboard"); // ✅ 登录成功跳转
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("User rejected the request")) {
        alert("You rejected the signature request.");
        return;
      }
      console.error("Wallet login failed:", err);
      alert("Login failed. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleSignIn}
      disabled={loading}
      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
    >
      {loading ? "Signing in..." : connected ? "Sign in with Solana" : "Connect Wallet"}
    </button>
  );
}
