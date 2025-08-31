CREATE TYPE "public"."mention_source" AS ENUM('ca', 'ticker', 'phrase', 'hashtag', 'upper', 'llm');--> statement-breakpoint
CREATE TYPE "public"."tweet_type" AS ENUM('tweet', 'retweet', 'quote', 'reply');--> statement-breakpoint
CREATE TABLE "kol_tweets" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"twitter_uid" text NOT NULL,
	"twitter_username" text NOT NULL,
	"type" "tweet_type" DEFAULT 'tweet' NOT NULL,
	"text_content" text,
	"views" bigint DEFAULT '0' NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"retweets" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"publish_date" timestamp with time zone NOT NULL,
	"status_link" text,
	"author_is_verified" boolean,
	"lang" text,
	"reply_to_tweet_id" text,
	"quoted_tweet_id" text,
	"retweeted_tweet_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "kols" (
	"twitter_uid" text PRIMARY KEY NOT NULL,
	"twitter_username" text NOT NULL,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	CONSTRAINT "kols_twitter_username_unique" UNIQUE("twitter_username")
);
--> statement-breakpoint
CREATE TABLE "tweet_token_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tweet_id" text NOT NULL,
	"token_key" text NOT NULL,
	"token_display" text,
	"confidence" integer DEFAULT 100 NOT NULL,
	"source" "mention_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kol_tweets" ADD CONSTRAINT "kol_tweets_twitter_uid_kols_twitter_uid_fk" FOREIGN KEY ("twitter_uid") REFERENCES "public"."kols"("twitter_uid") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tweet_token_mentions" ADD CONSTRAINT "tweet_token_mentions_tweet_id_kol_tweets_tweet_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."kol_tweets"("tweet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_pub" ON "kol_tweets" USING btree ("publish_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_uid_pub" ON "kol_tweets" USING btree ("twitter_uid","publish_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tweet_token" ON "tweet_token_mentions" USING btree ("tweet_id","token_key");--> statement-breakpoint
CREATE INDEX "idx_mentions_token" ON "tweet_token_mentions" USING btree ("token_key");