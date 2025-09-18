CREATE TYPE "public"."price_source" AS ENUM('geckoterminal', 'defillama', 'manual');--> statement-breakpoint
CREATE TABLE "coin_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_address" text NOT NULL,
	"pool_address" text,
	"source" "price_source" DEFAULT 'geckoterminal' NOT NULL,
	"price_usd" numeric(18, 8) NOT NULL,
	"price_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" numeric(6, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_coin_price_casrcat" ON "coin_price" USING btree ("contract_address","source","price_at");--> statement-breakpoint
CREATE INDEX "idx_coin_price_ca_at" ON "coin_price" USING btree ("contract_address","price_at");--> statement-breakpoint
CREATE INDEX "idx_coin_price_at" ON "coin_price" USING btree ("price_at");--> statement-breakpoint
CREATE INDEX "idx_coin_price_source" ON "coin_price" USING btree ("source");