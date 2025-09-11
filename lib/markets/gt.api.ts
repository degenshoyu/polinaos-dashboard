// lib/markets/gt.api.ts
// Low-level GT API wrappers + trending address discovery

import { fetchGTJson } from "@/lib/markets/gtFetch";
import { GT_BASE, dbg } from "./gt.util";
import { NETWORK } from "./gt.types";
import { canonAddr, isSolAddr } from "@/lib/chains/address";

export async function searchPools(query: string) {
  const url =
    `${GT_BASE}/search/pools?query=${encodeURIComponent(query)}` +
    `&filter[network]=${NETWORK}&include=base_token,quote_token,dex&per_page=50`;
  dbg("search/pools", { query, url });
  return (await fetchGTJson(url).catch(() => null)) as any;
}

export async function searchTokens(query: string) {
  const url =
    `${GT_BASE}/search/tokens?query=${encodeURIComponent(query)}` +
    `&filter[network]=${NETWORK}&per_page=50`;
  dbg("search/tokens", { query, url });
  return (await fetchGTJson(url).catch(() => null)) as any;
}

export async function fetchPoolsForToken(addr: string) {
  const url =
    `${GT_BASE}/networks/${NETWORK}/tokens/${addr}/pools` +
    `?include=base_token,quote_token,dex&per_page=50`;
  dbg("tokens/:addr/pools", { addr, url });
  return (await fetchGTJson(url).catch(() => null)) as any;
}

export async function fetchSolanaTrendingAddrs(): Promise<Set<string>> {
  const out = new Set<string>();
  const endpoints = [
    `${GT_BASE}/networks/${NETWORK}/trending_pools?include=base_token,quote_token`,
    `${GT_BASE}/trending_pools?network=${NETWORK}&include=base_token,quote_token`,
  ];
  const collect = (j: any) => {
    const included = Array.isArray(j?.included) ? j.included : [];
    for (const x of included) {
      const ty = String(x?.type || "");
      if (!ty.includes("token")) continue;
      const addr = canonAddr(String(x?.attributes?.address || ""));
      if (addr && isSolAddr(addr)) out.add(addr);
    }
  };
  for (const url of endpoints) {
    try {
      const j = await fetchGTJson(url).catch(() => null);
      if (j) collect(j);
      if (out.size > 0) break;
    } catch {
      /* ignore */
    }
  }
  return out;
}
