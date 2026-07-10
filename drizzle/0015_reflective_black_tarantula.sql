CREATE TABLE "event_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"edited_by" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "locked_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_run_id" text;--> statement-breakpoint
ALTER TABLE "event_edits" ADD CONSTRAINT "event_edits_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_edits_event_idx" ON "event_edits" USING btree ("event_id","created_at");