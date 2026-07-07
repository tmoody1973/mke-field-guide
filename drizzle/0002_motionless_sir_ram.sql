ALTER TABLE "sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_fetched_count" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_published_count" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_skipped_count" integer;