// app/api/geckoterminal/token/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

const Q = z.object({
  chain: z.string().min(2),
  address: z.string().min(4),
});

type GTTokenResp = {
  data?: {
    attributes?: {
      market_cap_usd?: number;
      fdv_usd?: number;
      // 兼容字段：不同文档/版本里可能叫法略有出入
      fully_diluted_valuation?: number;
      // 有些返回里也可能给 volume_usd = { h24: number }
      volume_usd?: { h24?: number };
      // 有些会给 listed_at / created_at（不稳定，池子更准）
      created_at?: string | number;
      listed_at?: string | number;
    };
  };
};

type GTPoolsResp = {
  data?: Array<{
    attributes?: {
      reserve_in_usd?: number;
      liquidity_usd?: number;
      created_at?: string | number;
      // 有的返回在 relationships / quote_token 里，可按需拓展
      quote_token_symbol?: string; // 兼容性字段（实际多在 included 结构里）
      volume_usd?: { h24?: number };
    };
    relationships?: any;
  }>;
  included?: any[];
};

const PREFERRED_QUOTES = new Set(["SOL", "WETH", "ETH", "USDC", "USDT"]);

// 从 pools 响应里选择“首选报价币 + 最大流动性”的池
function pickBestPool(pools: GTPoolsResp): any | undefined {
  const rows = Array.isArray(pools?.data) ? pools.data : [];
  if (!rows.length) return undefined;

  // 尝试从 included 里解析 quote token 的 symbol（不同版本结构会放 relationships + included）
  const included = Array.isArray(pools?.included) ? pools?.included : [];
  const idToSymbol = new Map<string, string>();
  for (const inc of included) {
    const t = (inc as any)?.type;
    const id = (inc as any)?.id;
    const sym =
      (inc as any)?.attributes?.symbol ||
      (inc as any)?.attributes?.symbol_name ||
      (inc as any)?.attributes?.name;
    if (t && id && typeof sym === "string") idToSymbol.set(id, sym.toUpperCase());
  }

  const enriched = rows.map((p) => {
    const liq =
      Number(p?.attributes?.reserve_in_usd) ||
      Number(p?.attributes?.liquidity_usd) ||
      0;

    // 优先从 relationships 解析 quote token symbol；否则用 attributes 的兼容字段
    let quote = (p?.attributes as any)?.quote_token_symbol as string | undefined;
    try {
      const q = (p as any)?.relationships?.quote_token?.data;
      const qid = q?.id;
      if (!quote && qid && idToSymbol.has(qid)) quote = idToSymbol.get(qid);
    } catch {}

    const isPref = quote ? PREFERRED_QUOTES.has(quote.toUpperCase()) : false;

    return { raw: p, liq, isPref };
  });

  enriched.sort((a, b) => (a.isPref !== b.isPref ? (a.isPref ? -1 : 1) : b.liq - a.liq));
  return enriched[0]?.raw;
}

function toNum(n: any): number | undefined {
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

function normalizeCreatedAt(
  v: unknown,
  opts: { allowFutureDays?: number } = {}
): string | undefined {
  if (v == null) return undefined;
  const allowFutureDays = opts.allowFutureDays ?? 3;
  let ms: number | null = null;

  if (typeof v === "number") {
    ms = v < 2_000_000_000 ? v * 1000 : v;
  } else if (typeof v === "string") {
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      ms = n < 2_000_000_000 ? n * 1000 : n;
    } else {
      const t = Date.parse(v);
      ms = Number.isNaN(t) ? null : t;
    }
  }

  if (ms == null || !Number.isFinite(ms)) return undefined;

  const now = Date.now();
  const maxFuture = now + allowFutureDays * 86400000;
  if (ms > maxFuture) return undefined;
  if (ms > now) ms = now;

  const min = Date.UTC(2013, 0, 1);
  if (ms < min) return undefined;

  return new Date(ms).toISOString();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = Q.safeParse({
      chain: searchParams.get("chain"),
      address: searchParams.get("address"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { chain, address } = parsed.data;

    // 1) Token 基本信息
    const tokenUrl = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
      chain
    )}/tokens/${encodeURIComponent(address)}`;
    const tokenRes = await fetch(tokenUrl, {
      headers: {
        accept: "application/json",
        // 如果你有密钥，可在 .env 里配置，下行按官方要求的 header key 替换
        ...(process.env.GECKOTERMINAL_API_KEY
          ? { "x-api-key": process.env.GECKOTERMINAL_API_KEY }
          : {}),
      },
      cache: "no-store",
    });

    let marketCapUsd: number | undefined;
    let volume24hUsd: number | undefined;
    let createdAt: string | undefined;

    if (tokenRes.ok) {
      const tokenJson = (await tokenRes.json()) as GTTokenResp;
      const a = tokenJson?.data?.attributes ?? {};
      marketCapUsd =
        toNum((a as any).market_cap_usd) ??
        toNum((a as any).fdv_usd) ??
        toNum((a as any).fully_diluted_valuation);
      volume24hUsd = toNum(a?.volume_usd?.h24);
      createdAt =
        normalizeCreatedAt(a?.created_at) ?? normalizeCreatedAt((a as any).listed_at);
    }

    // 2) Pooled 维度：用最佳池的 created_at 更靠谱；也能兜底 24H Vol
    const poolsUrl = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(
      chain
    )}/tokens/${encodeURIComponent(address)}/pools`;
    const poolsRes = await fetch(poolsUrl, {
      headers: {
        accept: "application/json",
        ...(process.env.GECKOTERMINAL_API_KEY
          ? { "x-api-key": process.env.GECKOTERMINAL_API_KEY }
          : {}),
      },
      cache: "no-store",
    });

    if (poolsRes.ok) {
      const poolsJson = (await poolsRes.json()) as GTPoolsResp;
      const best = pickBestPool(poolsJson);
      const created = best?.attributes?.created_at;
      const volH24 =
        toNum(best?.attributes?.volume_usd?.h24) ??
        toNum((best?.attributes as any)?.volume24h_usd);
      const fixedCreated = normalizeCreatedAt(created);
      createdAt = fixedCreated ?? createdAt;
      volume24hUsd = volH24 ?? volume24hUsd;
    }

    return NextResponse.json(
      {
        marketCapUsd: marketCapUsd ?? null,
        volume24hUsd: volume24hUsd ?? null,
        createdAt: createdAt ?? null,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "GeckoTerminal proxy failed" }, { status: 500 });
  }
}

