ALTER TABLE "events" ADD COLUMN "search_tsv" tsvector;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_events_search_tsv() RETURNS TRIGGER AS $$
BEGIN
  NEW."search_tsv" := setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english',
      coalesce(NEW."category", '') || ' ' ||
      coalesce(array_to_string(NEW."vibe_tags", ' '), '') || ' ' ||
      coalesce(array_to_string(NEW."audience_tags", ' '), '')
    ), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER update_events_search_tsv_trigger BEFORE INSERT OR UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION update_events_search_tsv();
--> statement-breakpoint
UPDATE "events" SET "search_tsv" = setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english',
    coalesce("category", '') || ' ' ||
    coalesce(array_to_string("vibe_tags", ' '), '') || ' ' ||
    coalesce(array_to_string("audience_tags", ' '), '')
  ), 'B') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'C');
--> statement-breakpoint
CREATE INDEX "events_search_tsv_idx" ON "events" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "events_normalized_title_trgm_idx" ON "events" USING gin ("normalized_title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "events_vibe_tags_idx" ON "events" USING gin ("vibe_tags");
--> statement-breakpoint
CREATE INDEX "events_audience_tags_idx" ON "events" USING gin ("audience_tags");