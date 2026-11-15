package sqlite

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

// TestBT30_PersistentCache: the SQLite cache hits on the exact key and misses
// on any identity change (model/source/dimension/passage); no cross-identity
// vector is returned; dimension mismatch on Put is rejected.
func TestBT30_PersistentCache(t *testing.T) {
	store := openTestStore(t)
	c := NewPersistentVectorCache(store)
	key := retrieval.VectorCacheKey{ContentID: "c1", SourceVersion: "content-revision:1", PassageID: "p1", ModelID: "bge-m3", Dimensions: 3}
	c.Put(key, []float32{1, 2, 3})
	got, ok := c.Get(key)
	if !ok || len(got) != 3 || got[0] != 1 || got[2] != 3 {
		t.Fatalf("hit: %v %v", got, ok)
	}
	// Identity changes miss.
	for _, mut := range []retrieval.VectorCacheKey{
		{ContentID: "c2", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: "content-revision:2", PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: "p2", ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: "other", Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 4},
	} {
		if _, ok := c.Get(mut); ok {
			t.Fatalf("identity change must miss: %+v", mut)
		}
	}
	// Dimension mismatch rejected.
	c.Put(retrieval.VectorCacheKey{ContentID: "c1", PassageID: "bad", ModelID: "bge-m3", Dimensions: 3}, []float32{1, 2})
	if _, ok := c.Get(retrieval.VectorCacheKey{ContentID: "c1", PassageID: "bad", ModelID: "bge-m3", Dimensions: 3}); ok {
		t.Fatal("wrong-dimension vector must not be stored")
	}
	// Overwrite same key.
	c.Put(key, []float32{4, 5, 6})
	got2, _ := c.Get(key)
	if got2[0] != 4 {
		t.Fatal("overwrite failed")
	}
}

// TestBT35_SettingsPersistence: provider/baseURL/masked key/model/dimensions/
// batch/weights/rerank/budgets survive save/reload; no key in the masked
// response; unsaved load returns the labelled default.
func TestBT35_SettingsPersistence(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	// Unsaved → labelled default.
	def, err := store.LoadRetrievalSettings(ctx)
	if err != nil || def.ProviderKind != retrieval.ProviderLocal || def.Model != "bge-m3" {
		t.Fatalf("default load: %+v %v", def, err)
	}
	// Save a customized config.
	s := retrieval.DefaultEmbeddingSettings()
	s.ProviderKind = retrieval.ProviderBailian
	s.Surface = retrieval.SurfaceDashScope
	s.BaseURL = "https://workspace.example.com/compatible-mode/v1"
	s.APIKey = "persisted-secret-key"
	s.Model = "text-embedding-v4"
	s.Dimensions = 1024
	s.BatchSize = 10
	s.TextType = "document"
	s.Instruct = "instruct text"
	s.EncodingFormat = retrieval.EncodingFloat
	s.TimeoutMs = 20000
	s.TopK = 100
	s.LexicalWeight, s.EmbeddingWeight, s.RerankWeight = 0.25, 0.55, 0.20
	s.MaxEmbeddingRequests = 25
	s.MaxEmbeddingChars = 100000
	s.MaxRerankRequests = 2
	s.RerankProvider = "bailian"
	s.RerankModel = "gte-rerank-v2"
	s.RerankAPIKey = "rerank-secret"
	s.RerankTopN = 5
	if err := store.SaveRetrievalSettings(ctx, s, 123); err != nil {
		t.Fatal(err)
	}
	// Reload preserves every field.
	got, err := store.LoadRetrievalSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProviderKind != s.ProviderKind || got.BaseURL != s.BaseURL || got.Model != s.Model ||
		got.Dimensions != 1024 || got.BatchSize != 10 || got.APIKey != s.APIKey ||
		got.LexicalWeight != 0.25 || got.EmbeddingWeight != 0.55 || got.RerankWeight != 0.20 ||
		got.MaxEmbeddingRequests != 25 || got.MaxRerankRequests != 2 || got.RerankModel != "gte-rerank-v2" ||
		got.RerankTopN != 5 || got.Instruct != "instruct text" {
		t.Fatalf("reload lost fields: %+v", got)
	}
	// Masked response carries hasKey, never the key.
	m := got.Mask()
	if !m.HasKey || !m.HasRerankKey {
		t.Fatal("hasKey/hasRerankKey must be true")
	}
	raw, _ := json.Marshal(m)
	if strings.Contains(string(raw), "persisted-secret-key") || strings.Contains(string(raw), "rerank-secret") {
		t.Fatalf("secret leaked: %s", raw)
	}
	// Invalid settings are rejected on save.
	bad := s
	bad.Dimensions = 0
	if err := store.SaveRetrievalSettings(ctx, bad, 124); err == nil {
		t.Fatal("invalid settings must be rejected")
	}
}
