ALTER TABLE "events" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "content_fingerprint" text;