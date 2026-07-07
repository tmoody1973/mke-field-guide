-- Custom SQL migration file, put your code below! --
UPDATE "event_instances" i
SET "source_id" = l."source_id"
FROM "event_source_links" l
WHERE l."event_id" = i."event_id" AND i."source_id" IS NULL;
