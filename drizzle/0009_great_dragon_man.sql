ALTER TABLE "kol_tweets" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tweet_token_mentions" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_excluded" ON "kol_tweets" USING btree ("excluded","publish_date");--> statement-breakpoint
CREATE INDEX "idx_mentions_excluded" ON "tweet_token_mentions" USING btree ("excluded","created_at");