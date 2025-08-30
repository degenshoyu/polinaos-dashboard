// app/api/dexscreener/info/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs"; // 避免 edge 下第三方阻断
export const revalidate = 60;

const Q = z.object({
  chain: z.string().min(1),
  address: z.string().min(3),
});

// 常见链名归一化
const normalizeChain = (raw: string) => {
  const x = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    sol: "solana",
    solana: "solana",
    eth: "ethereum",
    ethereum: "ethereum",
    bsc: "bsc",
    "bnb smart chain": "bsc",
    base: "base",
    polygon: "polygon",
    matic: "polygon",
    arbitrum: "arbitrum",
    optimism: "optimism",
    avalanche: "avalanche",
  };
  return map[x] || x;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({
      chain: searchParams.get("chain") || "",
      address: searchParams.get("address") || "",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const chain = normalizeChain(parsed.data.chain);
    const address = parsed.data.address;

    // Dexscreener: 根据 token 地址拉所有 pair
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(
      address,
    )}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Dexscreener upstream failed" },
        { status: 502 },
      );
    }
    const json = await res.json();

    type Social = { type?: string; url?: string };
    type Website = { label?: string; url?: string };
    type Pair = {
      chainId?: string;
      url?: string; // pair 页面地址
      info?: {
        websites?: Website[];
        socials?: Social[];
      };
      // 不同返回里可能是 ms 或 s，这里都兜底
      pairCreatedAt?: number; // ms 或 s（某些返回）
      pairCreatedAtMs?: number;
    };

    const pairs: Pair[] = Array.isArray(json?.pairs) ? json.pairs : [];

    // 先找链名匹配；没有就选“信息最丰富”的一条
    const candidates = pairs.filter(
      (p) => normalizeChain(p.chainId || "") === chain,
    );
    const list = candidates.length ? candidates : pairs;
    const best =
      list.slice().sort((a, b) => {
        const as =
          (a.info?.socials?.length || 0) + (a.info?.websites?.length || 0);
        const bs =
          (b.info?.socials?.length || 0) + (b.info?.websites?.length || 0);
        return bs - as;
      })[0] || null;

    const socials: Social[] = best?.info?.socials ?? [];
    const websites: Website[] = best?.info?.websites ?? [];

    const find = (t: string) =>
      socials.find((s) => (s.type || "").toLowerCase() === t)?.url || null;

    const createdMs =
      (typeof best?.pairCreatedAtMs === "number" && best?.pairCreatedAtMs) ||
      (typeof best?.pairCreatedAt === "number" &&
        (best!.pairCreatedAt > 10 ** 12
          ? best!.pairCreatedAt
          : best!.pairCreatedAt * 1000)) ||
      undefined;

    const createdAt =
      typeof createdMs === "number"
        ? new Date(createdMs).toISOString()
        : undefined;

    const dexUrl =
      best?.url ||
      `https://dexscreener.com/${chain}/${encodeURIComponent(address)}`;

    return NextResponse.json({
      dexUrl,
      createdAt,
      twitter: find("twitter"),
      telegram: find("telegram"),
      website: websites?.[0]?.url || null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Unexpected" }, { status: 500 });
  }
}
