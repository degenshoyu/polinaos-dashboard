ALTER TABLE "kols" ADD COLUMN "account_creation_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kols" ADD COLUMN "followers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kols" ADD COLUMN "following" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kols" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "kols" ADD COLUMN "profile_img_url" text;--> statement-breakpoint
CREATE INDEX "idx_kols_followers" ON "kols" USING btree ("followers" DESC NULLS LAST);