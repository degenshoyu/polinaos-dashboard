// app/api/dexscreener/info/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Q = z.object({
  chain: z.string().min(1),
  address: z.string().min(3),
});

const normalize = (x: string) => x?.toLowerCase()?.trim();

const QUOTE_WHITELIST = ["sol", "solana", "eth", "ethereum", "usdc"];

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

    const { chain, address } = parsed.data;

    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Dexscreener upstream failed" },
        { status: 502 },
      );
    }

    const json = await res.json();
    const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];

    // 1. 过滤掉非主流 quote 池子
    const filtered = pairs.filter((p) => {
      const quoteSym = normalize(p?.quoteToken?.symbol || "");
      return QUOTE_WHITELIST.includes(quoteSym);
    });

    if (filtered.length === 0) {
      return NextResponse.json(
        { error: "No eligible pools (need SOL/ETH/USDC)" },
        { status: 404 },
      );
    }

    // 2. 按 liquidity.usd 排序，取最大
    const best = filtered.sort((a, b) => {
      const la = a?.liquidity?.usd || 0;
      const lb = b?.liquidity?.usd || 0;
      return lb - la;
    })[0];

    const socials = best?.info?.socials ?? [];
    const websites = best?.info?.websites ?? [];

    const find = (t: string) =>
      socials.find((s: any) => (s.type || "").toLowerCase() === t)?.url || null;

    const dexUrl = best?.url || `https://dexscreener.com/${chain}/${address}`;

    const createdMs =
      best?.pairCreatedAtMs ||
      (best?.pairCreatedAt ? best.pairCreatedAt * 1000 : undefined);

    return NextResponse.json({
      dexUrl,
      createdAt: createdMs ? new Date(createdMs).toISOString() : undefined,
      twitter: find("twitter"),
      telegram: find("telegram"),
      website: websites?.[0]?.url || null,
      liquidity: best?.liquidity?.usd || null,
      quoteToken: best?.quoteToken?.symbol || null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Unexpected" }, { status: 500 });
  }
}
