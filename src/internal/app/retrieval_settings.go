package app

import (
	"context"
	"strings"
	"time"

	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/retrieval"
)

// retrievalSettingsService persists B's embedding/rerank configuration and
// applies it to the live engine without a restart. Keys are write-only: an
// empty key on save keeps the stored one, and every response/log surface uses
// the masked shape (hasKey only), never the key itself.
type retrievalSettingsService struct {
	store  *sqlite.Store
	engine *retrieval.Engine // nil when language AI storage is unavailable
}

func newRetrievalSettingsService(store *sqlite.Store, engine *retrieval.Engine) *retrievalSettingsService {
	return &retrievalSettingsService{store: store, engine: engine}
}

// Get returns the persisted configuration, masked (labelled default when
// nothing has been saved).
func (s *retrievalSettingsService) Get(ctx context.Context) (retrieval.MaskedSettings, error) {
	settings, err := s.store.LoadRetrievalSettings(ctx)
	if err != nil {
		return retrieval.MaskedSettings{}, err
	}
	return settings.Mask(), nil
}

// Save validates and persists the configuration, then applies the operational
// settings (limits, batch size, topK, weights) and rebuilds the embedding
// adapter so the next retrieval invocation uses both. Invalid settings are
// rejected before anything is written or swapped.
func (s *retrievalSettingsService) Save(ctx context.Context, input retrieval.EmbeddingSettings) (retrieval.MaskedSettings, error) {
	stored, err := s.store.LoadRetrievalSettings(ctx)
	if err != nil {
		return retrieval.MaskedSettings{}, err
	}
	if strings.TrimSpace(input.APIKey) == "" {
		input.APIKey = stored.APIKey
	}
	if strings.TrimSpace(input.RerankAPIKey) == "" {
		input.RerankAPIKey = stored.RerankAPIKey
	}
	if err := s.store.SaveRetrievalSettings(ctx, input, time.Now().Unix()); err != nil {
		return retrieval.MaskedSettings{}, err
	}
	if s.engine != nil {
		s.engine.ApplySettings(&input, newEmbeddingAdapter(input))
	}
	return input.Mask(), nil
}
