DROP INDEX "uq_coin_ca_ticker_ca";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_coin_ca_ticker_ticker_ca" ON "coin_ca_ticker" USING btree ("token_ticker","contract_address");--> statement-breakpoint
CREATE INDEX "idx_coin_ca_ticker_ca" ON "coin_ca_ticker" USING btree ("contract_address");