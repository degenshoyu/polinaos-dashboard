BEGIN;

-- 1) searches: add updated_at
ALTER TABLE "searches"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

-- 2) ai_understandings: add updated_at
ALTER TABLE "ai_understandings"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

-- 3) kols: add created_at, updated_at
ALTER TABLE "kols"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

-- 4) kol_tweets: add created_at, updated_at
ALTER TABLE "kol_tweets"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

-- 5) tweet_token_mentions: 如果已存在则跳过（你已在 schema 里有 timestamps，则此处可选）
ALTER TABLE "tweet_token_mentions"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

COMMIT;
