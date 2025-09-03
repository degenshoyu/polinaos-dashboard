CREATE TYPE "public"."mention_source" AS ENUM('ca', 'ticker', 'phrase', 'hashtag', 'upper', 'llm');--> statement-breakpoint
CREATE TYPE "public"."tweet_type" AS ENUM('tweet', 'retweet', 'quote', 'reply');--> statement-breakpoint
CREATE TABLE "ai_understandings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"model" text DEFAULT 'gemini-1.5-pro',
	"result_json" jsonb NOT NULL,
	"summary_text" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kol_tweets" (
	"tweet_id" text NOT NULL,
	"twitter_uid" text NOT NULL,
	"twitter_username" text NOT NULL,
	"type" "tweet_type" DEFAULT 'tweet' NOT NULL,
	"text_content" text,
	"views" bigint DEFAULT 0 NOT NULL,
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
	"raw_json" jsonb,
	CONSTRAINT "pk_kol_tweets_tweet_id" PRIMARY KEY("tweet_id")
);
--> statement-breakpoint
CREATE TABLE "kols" (
	"twitter_uid" text PRIMARY KEY NOT NULL,
	"twitter_username" text NOT NULL,
	"display_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"account_creation_date" timestamp with time zone,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"bio" text,
	"profile_img_url" text,
	CONSTRAINT "kols_twitter_username_unique" UNIQUE("twitter_username")
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_session_id" text,
	"query_json" jsonb NOT NULL,
	"job_id" text NOT NULL,
	"source" text DEFAULT 'ctsearch',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweet_token_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tweet_id" text NOT NULL,
	"token_key" text NOT NULL,
	"token_display" text,
	"confidence" integer DEFAULT 100 NOT NULL,
	"source" "mention_source" NOT NULL,
	"trigger_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "ai_understandings" ADD CONSTRAINT "ai_understandings_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kol_tweets" ADD CONSTRAINT "kol_tweets_twitter_uid_kols_twitter_uid_fk" FOREIGN KEY ("twitter_uid") REFERENCES "public"."kols"("twitter_uid") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_token_mentions" ADD CONSTRAINT "tweet_token_mentions_tweet_id_kol_tweets_tweet_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."kol_tweets"("tweet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_pub" ON "kol_tweets" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_uid_pub" ON "kol_tweets" USING btree ("twitter_uid","publish_date");--> statement-breakpoint
CREATE INDEX "idx_kols_followers" ON "kols" USING btree ("followers");--> statement-breakpoint
CREATE INDEX "idx_searches_user_created" ON "searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_searches_anon_created" ON "searches" USING btree ("anon_session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_searches_job" ON "searches" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tweet_trigger" ON "tweet_token_mentions" USING btree ("tweet_id","trigger_key");--> statement-breakpoint
CREATE INDEX "idx_mentions_token" ON "tweet_token_mentions" USING btree ("token_key");--> statement-breakpoint
CREATE INDEX "idx_mentions_trigger" ON "tweet_token_mentions" USING btree ("trigger_key");