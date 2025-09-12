CREATE TABLE "token_resolution_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "mention_source" NOT NULL,
	"norm_key" text NOT NULL,
	"sample" text,
	"last_reason" text,
	"last_error" text,
	"last_tweet_id" text,
	"last_trigger_key" text,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"candidates" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "res_issue_kind_key_uniq" ON "token_resolution_issues" USING btree ("kind","norm_key");--> statement-breakpoint
CREATE INDEX "res_issue_updated_idx" ON "token_resolution_issues" USING btree ("updated_at");