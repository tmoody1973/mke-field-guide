CREATE TABLE "subscription_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "subscription_attempts_ip_idx" ON "subscription_attempts" USING btree ("ip_hash","created_at");