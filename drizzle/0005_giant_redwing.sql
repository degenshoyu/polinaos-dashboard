CREATE TABLE "coin_ca_ticker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_ticker" text NOT NULL,
	"contract_address" text NOT NULL,
	"token_name" text,
	"primary_pool_address" text,
	"mint_authority" text,
	"mint_at" timestamp with time zone,
	"creator_address" text,
	"token_metadata" jsonb,
	"website_url" text,
	"telegram_url" text,
	"twitter_url" text,
	"priority" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kol_tweets" ADD COLUMN "resolved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_coin_ca_ticker_ca" ON "coin_ca_ticker" USING btree ("contract_address");--> statement-breakpoint
CREATE INDEX "idx_coin_ca_ticker_ticker" ON "coin_ca_ticker" USING btree ("token_ticker");--> statement-breakpoint
CREATE INDEX "idx_coin_ca_ticker_priority" ON "coin_ca_ticker" USING btree ("priority");