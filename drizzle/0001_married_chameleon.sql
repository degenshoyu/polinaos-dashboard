ALTER TABLE "tweet_token_mentions" ADD COLUMN "trigger_text" text;--> statement-breakpoint
CREATE INDEX "idx_mentions_trigger_text" ON "tweet_token_mentions" USING btree ("trigger_text");