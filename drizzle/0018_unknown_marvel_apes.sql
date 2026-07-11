CREATE TABLE "venue_merge_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keep_venue_id" uuid NOT NULL,
	"absorb_venue_id" uuid NOT NULL,
	"confidence" numeric NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "title_suggestion" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "title_suggested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venue_merge_suggestions" ADD CONSTRAINT "venue_merge_suggestions_keep_venue_id_venues_id_fk" FOREIGN KEY ("keep_venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_merge_suggestions" ADD CONSTRAINT "venue_merge_suggestions_absorb_venue_id_venues_id_fk" FOREIGN KEY ("absorb_venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_merge_suggestions_pair_idx" ON "venue_merge_suggestions" USING btree ("keep_venue_id","absorb_venue_id");