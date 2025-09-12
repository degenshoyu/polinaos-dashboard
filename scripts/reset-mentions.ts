// scripts/reset-mentions.ts
// Usage:
//   npx ts-node -P tsconfig.scripts.json -r tsconfig-paths/register scripts/reset-mentions.ts
//   npx ts-node -P tsconfig.scripts.json -r tsconfig-paths/register scripts/reset-mentions.ts --hard

import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const hard = process.argv.includes("--hard");

  console.log("⚠️  Resetting tweet_token_mentions …");
  await db.execute(sql`TRUNCATE TABLE tweet_token_mentions RESTART IDENTITY CASCADE;`);
  console.log("✅  tweet_token_mentions truncated");

  try {
    console.log("↩️  Reset kol_tweets.resolved = false …");
    await db.execute(sql`UPDATE kol_tweets SET resolved = FALSE;`);
    console.log("✅  kol_tweets resolved reset");
  } catch (e) {
    console.log("ℹ️  skip resetting kol_tweets.resolved (column may not exist)");
  }

  if (hard) {
    try {
      console.log("🧹 Hard reset coin_ca_ticker …");
      await db.execute(sql`TRUNCATE TABLE coin_ca_ticker RESTART IDENTITY CASCADE;`);
      console.log("✅  coin_ca_ticker truncated");
    } catch {
      console.log("ℹ️  coin_ca_ticker not found; skipped");
    }
  }

  console.log("🎉 Done.");
}

main().catch((e) => {
  console.error("❌ Reset failed:", e);
  process.exit(1);
});

