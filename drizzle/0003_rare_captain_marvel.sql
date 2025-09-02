DROP INDEX "idx_kol_tweets_pub";--> statement-breakpoint
DROP INDEX "idx_kol_tweets_uid_pub";--> statement-breakpoint
DROP INDEX "idx_kols_followers";--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'kol_tweets'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "kol_tweets" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "kol_tweets" ALTER COLUMN "views" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "kol_tweets" ADD CONSTRAINT "pk_kol_tweets_tweet_id" PRIMARY KEY("tweet_id");--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_pub" ON "kol_tweets" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "idx_kol_tweets_uid_pub" ON "kol_tweets" USING btree ("twitter_uid","publish_date");--> statement-breakpoint
CREATE INDEX "idx_kols_followers" ON "kols" USING btree ("followers");