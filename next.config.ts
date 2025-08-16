// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // ✅ Allow production builds to succeed even with ESLint errors
    ignoreDuringBuilds: true,
  },
  // Keep TS errors as blockers (recommended). If you *must* bypass temporarily:
  // typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
