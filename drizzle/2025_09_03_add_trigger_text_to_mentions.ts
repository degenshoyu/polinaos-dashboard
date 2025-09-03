// drizzle/2025_09_03_add_trigger_text_to_mentions.ts
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

export async function up() {
  const client = new Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const db = drizzle(client);

  // add nullable column
  await db.execute(sql`
    ALTER TABLE tweet_token_mentions
    ADD COLUMN IF NOT EXISTS trigger_text text;
  `);

  // optional backfill from trigger_key where possible
  await db.execute(sql`
    UPDATE tweet_token_mentions
    SET trigger_text = regexp_replace(trigger_key, '^ticker:', '')
    WHERE trigger_text IS NULL AND trigger_key LIKE 'ticker:%';
  `);
  await db.execute(sql`
    UPDATE tweet_token_mentions
    SET trigger_text = regexp_replace(trigger_key, '^ca:', '')
    WHERE trigger_text IS NULL AND trigger_key LIKE 'ca:%';
  `);
  // NOTE: phrase:* is hashed; cannot backfill original text.

  await client.end();
}

export async function down() {
  const client = new Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const db = drizzle(client);

  await db.execute(sql`
    ALTER TABLE tweet_token_mentions
    DROP COLUMN IF EXISTS trigger_text;
  `);

  await client.end();
}
