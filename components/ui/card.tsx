// components/ui/card.tsx
import * as React from "react";

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-white/5 bg-gradient-to-br from-[#0f1514] to-[#0b1110] ${className}`}>
      {children}
    </div>
  );
}

