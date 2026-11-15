-- B-owned optional persistent vector cache (ADR-002 "Vector cache"; plan
-- open decision 4). The v1 default is a process-local cache; this table is
-- the opt-in persistent alternative. The key includes model and dimensions
-- so a model/dimension/source-version change is always a miss; vectors from
-- different identities are never mixed.
CREATE TABLE IF NOT EXISTS passage_embeddings (
  content_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (content_id, source_version, passage_id, model_id, dimensions)
);
CREATE INDEX IF NOT EXISTS passage_embeddings_by_content ON passage_embeddings(content_id);