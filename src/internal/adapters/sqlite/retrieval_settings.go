package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"tangentry/internal/retrieval"
)

// SaveRetrievalSettings persists the embedding/rerank configuration locally
// (singleton row). The key is stored here but never returned by the API.
// updatedAt is caller-supplied (deterministic tests).
func (s *Store) SaveRetrievalSettings(ctx context.Context, settings retrieval.EmbeddingSettings, updatedAt int64) error {
	if err := retrieval.ValidateEmbeddingSettings(settings); err != nil {
		return err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO retrieval_settings(id,payload,updated_at) VALUES(1,?,?)
		ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`, string(payload), updatedAt)
	return err
}

// LoadRetrievalSettings reloads the persisted configuration. When nothing is
// saved it returns the labelled local-first default (never an unlabelled zero).
func (s *Store) LoadRetrievalSettings(ctx context.Context) (retrieval.EmbeddingSettings, error) {
	var payload string
	err := s.db.QueryRowContext(ctx, `SELECT payload FROM retrieval_settings WHERE id=1`).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return retrieval.DefaultEmbeddingSettings(), nil
	}
	if err != nil {
		return retrieval.EmbeddingSettings{}, err
	}
	var settings retrieval.EmbeddingSettings
	if err := json.Unmarshal([]byte(payload), &settings); err != nil {
		return retrieval.EmbeddingSettings{}, err
	}
	return settings, nil
}
