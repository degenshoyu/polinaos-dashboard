// scripts/smoke-detect.ts
import { processTweetsToRows } from "@/lib/kols/detectEngine";

// 伪造三条推文：ticker / 直接CA / phrase 名称
const tweets = [
  { tweetId: "T1", textContent: "I love $POPCAT. bonk to the moon!" },
  { tweetId: "T2", textContent: "New gem at pump.fun/coin/xxxx ... $USDUC" },
  { tweetId: "T3", textContent: "that unstable coin is everywhere" },
  { tweetId: "T4", textContent: "here is $homeless" },
];

(async () => {
  const out = await processTweetsToRows(tweets, console.log);
  console.log("\n=== RESULT ===");
  console.dir(out, { depth: null });
})();
