// components/SignInWithSolana.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import bs58 from "bs58";
import Image from "next/image";

// 小工具：按钮样式（与 Navbar 一致的玻璃拟态）
const baseBtn =
  "inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-sm font-medium transition";

export default function SignInWithSolana() {
  const { publicKey, signMessage, connected, select } = useWallet();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false); // 控制弹窗
  const [step, setStep] = useState<"idle" | "connect" | "sign" | "success">("idle");
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开弹窗时，根据是否已连接来设定步骤
  useEffect(() => {
    if (!open) return;
    setStep(connected ? "sign" : "connect");
  }, [open, connected]);

  // 点击外部区域关闭弹窗
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handlePrimary = async () => {
    try {
      if (step === "connect") {
        const phantom = new PhantomWalletAdapter();
        select(phantom.name);
        return; // 连接由扩展完成，成功后 UI 会跳到 sign
      }

      if (step === "sign") {
        if (!publicKey || !signMessage) return;
        setLoading(true);

        const message = `Sign this message to authenticate with PolinaOS Demo.
Wallet: ${publicKey.toBase58()}
Time: ${new Date().toISOString()}`;

        const encoded = new TextEncoder().encode(message);
        const signature = await signMessage(encoded);

        const res = await signIn("credentials", {
          publicKey: publicKey.toBase58(),
          message,
          signature: bs58.encode(signature),
          redirect: false,
        });

        if (res?.error) {
          setStep("idle");
          // 轻量错误提示（与样式统一）
          toast("Login failed: " + res.error, "error");
          return;
        }

        setStep("success");
        toast("Login successful!", "success");
        // 立即刷新会话，让 Navbar 立刻变短地址
        router.refresh();
        // 给用户 800ms 成功反馈再跳转（可按需改）
        setTimeout(() => {
          setOpen(false);
          router.push("/dashboard");
        }, 800);
      }
    } catch (err: any) {
      if (err?.message?.includes("User rejected")) {
        toast("You rejected the signature request.", "warn");
      } else {
        console.error(err);
        toast("Login failed. Check console for details.", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  // 迷你 Toast（与全站玻璃风统一）
  function toast(text: string, type: "success" | "warn" | "error" = "success") {
    const color =
      type === "success"
        ? "from-[#27a567] to-[#2fd480]"
        : type === "warn"
        ? "from-yellow-600 to-yellow-500"
        : "from-red-600 to-red-500";
    const el = document.createElement("div");
    el.className =
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-full text-sm text-white shadow-lg " +
      `bg-gradient-to-r ${color}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translate(-50%, 10px)";
      el.style.transition = "all .25s ease";
    }, 1600);
    setTimeout(() => el.remove(), 2000);
  }

  const label = loading
    ? "Signing in..."
    : connected
    ? "Sign in with Solana"
    : "Connect";

  return (
    <div className="relative">
      {/* 入口按钮：与 Navbar 风格一致 */}
      <button
        className={baseBtn}
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
      >
        {/* Phantom 图标（可换成本地 /public/phantom.svg） */}
        <Image
          src="/phantom.svg"
          alt="Phantom"
          width={16}
          height={16}
          className="opacity-90"
        />
        {label}
        {loading && (
          <span className="ml-1 inline-block w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
        )}
      </button>

      {/* 玻璃弹窗（不使用下拉 Hover，点击按钮显隐） */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-[280px] rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl shadow-2xl p-4 z-50"
        >
          {/* 头部 */}
          <div className="flex items-center gap-2 mb-3">
            <Image src="/logo-polina.png" width={20} height={20} alt="PolinaOS" className="rounded" />
            <div className="text-sm text-white/90 font-semibold">Wallet Login</div>
          </div>

          {/* 步骤进度 */}
          <ol className="flex items-center gap-2 mb-4 text-[11px] text-gray-400">
            <li className={`px-2 py-1 rounded-full border ${!connected ? "border-[#27a567]/40 text-[#2fd480]" : "border-white/10 text-white/70"}`}>1. Connect</li>
            <li className={`px-2 py-1 rounded-full border ${connected ? "border-[#27a567]/40 text-[#2fd480]" : "border-white/10"}`}>2. Sign</li>
          </ol>

          {/* 内容区 */}
          {step === "connect" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-300">
                Connect your <span className="text-white">Phantom</span> wallet to continue.
              </p>
              <button
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-[#27a567] to-[#2fd480] hover:from-[#239e5d] hover:to-[#38ec9c] transition shadow"
                onClick={handlePrimary}
              >
                <Image src="/phantom.svg" alt="Phantom" width={16} height={16} />
                Connect Phantom
              </button>
            </div>
          )}

          {step === "sign" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-300">
                Connected. Please sign a message to authenticate.
              </p>
              <button
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-[#27a567] to-[#2fd480] hover:from-[#239e5d] hover:to-[#38ec9c] transition shadow disabled:opacity-70"
                onClick={handlePrimary}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                    Signing…
                  </>
                ) : (
                  "Sign in with Solana"
                )}
              </button>
            </div>
          )}

          {step === "success" && (
            <div className="space-y-3 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-[#2fd480]/15 border border-[#2fd480]/40 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-[#2fd480]">
                  <path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5z"></path>
                </svg>
              </div>
              <div className="text-sm text-white">Login successful</div>
              <div className="text-xs text-gray-400">Redirecting…</div>
            </div>
          )}

          {/* 底部次要操作 */}
          <div className="mt-4 flex justify-end">
            <button
              className="text-xs text-gray-400 hover:text-white/80"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

