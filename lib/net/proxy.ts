// lib/net/proxy.ts
// Enable global HTTP(S) proxy for all fetch() via undici ProxyAgent.

import { ProxyAgent, setGlobalDispatcher } from "undici";

declare global {
  // Prevent double-initialization in hot-reload/dev
  // eslint-disable-next-line no-var
  var __DECODO_PROXY_SET: boolean | undefined;
}

const proxyUrl =
  process.env.DECODO_PROXY_URL ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "";

if (proxyUrl && !globalThis.__DECODO_PROXY_SET) {
  try {
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    globalThis.__DECODO_PROXY_SET = true;
    if (process.env.NODE_ENV !== "production") {
      // Optional dev log — remove if you prefer silence
      console.log(`[proxy] using forward proxy: ${proxyUrl}`);
    }
  } catch (e) {
    console.error("[proxy] failed to initialize ProxyAgent:", e);
  }
}
