CREATE TABLE "venue_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"address" text,
	"locality" text,
	"lon" numeric NOT NULL,
	"lat" numeric NOT NULL,
	"confidence" numeric,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_merge_suggestions" ADD COLUMN "source" text DEFAULT 'llm' NOT NULL;--> statement-breakpoint
ALTER TABLE "venue_merge_suggestions" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "registry_id" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "registry_matched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "venue_registry_name_trgm_idx" ON "venue_registry" USING gin (lower("name") gin_trgm_ops);