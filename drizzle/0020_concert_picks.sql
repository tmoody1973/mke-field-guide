CREATE TABLE "concert_picks_imports" (
	"source_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"week_of" date NOT NULL,
	"matched_count" integer NOT NULL,
	"unmatched" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_picks" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_picks_source_event_idx" ON "staff_picks" USING btree ("source_id","event_id");