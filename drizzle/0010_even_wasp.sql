ALTER TABLE "events" ADD COLUMN "vibe_tags" text[];--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience_tags" text[];--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "price_min" numeric;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "price_max" numeric;