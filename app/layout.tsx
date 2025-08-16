// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import Providers from "./providers"; 

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "PolinaOS Demo · Community Growth Dashboard",
  description:
    "AI + on-chain dashboard for community growth. Connect Phantom, set up your project, collect data, analyze trends, and plan campaigns.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  openGraph: {
    title: "PolinaOS Demo · Community Growth Dashboard",
    description: "AI + on-chain dashboard for community growth. Connect Phantom and start.",
    url: process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
    siteName: "PolinaOS Demo",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PolinaOS Demo",
    description: "AI + on-chain dashboard for community growth. Connect Phantom and start.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.ico" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased min-h-screen bg-black text-white selection:bg-white/10 font-sora">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
