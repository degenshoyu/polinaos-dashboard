CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS coin_ca_ticker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_ticker text NOT NULL,
  contract_address text NOT NULL,
  token_name text,
  primary_pool_address text,
  mint_authority text,
  mint_at timestamptz,
  creator_address text,
  token_metadata jsonb,
  website_url text,
  telegram_url text,
  twitter_url text,
  priority int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_coin_ca_ticker_ticker_ca
ON coin_ca_ticker (token_ticker, contract_address);

CREATE INDEX IF NOT EXISTS idx_coin_ca_ticker_ticker
ON coin_ca_ticker (token_ticker);

CREATE INDEX IF NOT EXISTS idx_coin_ca_ticker_ca
ON coin_ca_ticker (contract_address);

CREATE INDEX IF NOT EXISTS idx_coin_ca_ticker_priority
ON coin_ca_ticker (priority);

