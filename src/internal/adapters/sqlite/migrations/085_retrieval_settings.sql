-- B-owned retrieval settings persistence (plan "Embedding/rerank settings UI
-- contract"; B-T35). One singleton row holds the embedding/rerank config.
-- The API key is stored locally here (or read from env) and is NEVER returned
-- by the settings API — only hasKey/hasRerankKey. Additive; B-owned.
CREATE TABLE IF NOT EXISTS retrieval_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);