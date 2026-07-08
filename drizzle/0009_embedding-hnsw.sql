-- Custom SQL migration file, put your code below! --
CREATE INDEX IF NOT EXISTS events_embedding_hnsw_idx ON "events" USING hnsw ("embedding" vector_cosine_ops);