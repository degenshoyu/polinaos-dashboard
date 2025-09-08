/* ============================================================================
   Migration: 003_add_price_to_tweet_token_mentions
   Purpose  : Add price snapshot column (USD) for each detected coin mention
              + helpful indexes for common query patterns.
   Notes    :
     - Column is nullable for now; you can backfill later.
     - Numeric(18,8) is used to avoid floating rounding issues.
     - Includes a non-negative CHECK constraint.
     - If you already have lots of traffic, consider creating indexes
       with CONCURRENTLY outside of a transaction (not inside this file).
   ============================================================================ */

/* 1) Add column: price_usd_at (nullable) */
ALTER TABLE tweet_token_mentions
  ADD COLUMN IF NOT EXISTS price_usd_at NUMERIC(18,8)
  CHECK (price_usd_at IS NULL OR price_usd_at >= 0);

/* 2) Optional: document the meaning of the column */
COMMENT ON COLUMN tweet_token_mentions.price_usd_at
IS 'USD price snapshot at tweet time for the mentioned token (nullable).';

/* 3) Helpful indexes
   - Most API reads fetch mentions by tweet_id (per-tweet aggregation).
   - Sometimes you might filter by token_key, or by (tweet_id, token_key).
   - Create IF NOT EXISTS to keep migration idempotent.
*/
CREATE INDEX IF NOT EXISTS idx_ttm_tweet_id
  ON tweet_token_mentions (tweet_id);

CREATE INDEX IF NOT EXISTS idx_ttm_token_key
  ON tweet_token_mentions (token_key);

/* Composite index helps exact pair lookups and speeds GROUP BY (tweet_id, token_key) */
CREATE INDEX IF NOT EXISTS idx_ttm_tweet_id_token_key
  ON tweet_token_mentions (tweet_id, token_key);

/* ============================================================================
   (Optional) Down migration (commented out)
   -- ALTER TABLE tweet_token_mentions DROP COLUMN IF EXISTS price_usd_at;
   -- DROP INDEX IF EXISTS idx_ttm_tweet_id_token_key;
   -- DROP INDEX IF EXISTS idx_ttm_token_key;
   -- DROP INDEX IF EXISTS idx_ttm_tweet_id;
   ============================================================================ */

