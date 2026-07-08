-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX IF NOT EXISTS venues_slug_unique_idx ON "venues" ("slug") WHERE slug IS NOT NULL;
