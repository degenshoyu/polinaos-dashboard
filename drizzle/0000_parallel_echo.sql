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
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_searches_user_created" ON "searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_searches_anon_created" ON "searches" USING btree ("anon_session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_searches_job" ON "searches" USING btree ("job_id");