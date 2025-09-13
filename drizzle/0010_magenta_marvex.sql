ALTER TABLE "coin_ca_ticker" ADD COLUMN "update_authority" text;--> statement-breakpoint
CREATE INDEX "idx_coin_ca_ticker_update_authority" ON "coin_ca_ticker" USING btree ("update_authority");