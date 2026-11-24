package retrieval

import (
	"context"
	"testing"
)

// cacheFixture builds a small article source plus a shared-mode embedder.
func cacheFixture(t *testing.T) (*fakeSource, *fakeEmbedder, Snapshot) {
	t.Helper()
	snap := Snapshot{
		ContentID: "fixture:cache",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks: []Block{
			{Index: 0, Kind: "paragraph", Text: "第一段：香港特別行政區的基本法規定居民的權利和義務。居民的權利和自由受法律保障，任何機關不得侵犯。"},
			{Index: 1, Kind: "paragraph", Text: "第二段：香港特別行政區享有獨立的司法權和終審權。法院獨立進行審判，不受任何干涉，司法人員履行審判職責的行為不受法律追究。"},
			{Index: 2, Kind: "paragraph", Text: "第三段：香港特別行政區的行政機關必須遵守法律，對香港特別行政區負責。行政長官由中央人民政府任命，任期五年。"},
		},
	}
	return &fakeSource{snap: snap}, newFakeEmbedder(BatchingShared), snap
}

// documentTextsSent counts the passage texts sent as documents (the question is
// excluded), so a cache hit is provable at the provider boundary.
func documentTextsSent(emb *fakeEmbedder) int {
	total := 0
	for _, call := range emb.calls {
		for _, text := range call.Texts {
			if text != emb.questionText {
				total++
			}
		}
	}
	return total
}

// TestSelectorVectorCacheSkipsReembedding: with a persistent cache the same
// passages are never sent to the provider twice, and the scores are identical
// to the cold run (a cached vector must be the vector, not an approximation).
func TestSelectorVectorCacheSkipsReembedding(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cache := NewProcessVectorCache()
	cfg := defaultSelectorConfig()
	cfg.Cache = cache
	const question = "居民的權利如何受保障"

	cold := NewSelector(src, emb, cfg)
	first, err := cold.Select(context.Background(), snap.ContentID, question, 0)
	if err != nil {
		t.Fatal(err)
	}
	coldDocs := documentTextsSent(emb)
	if coldDocs == 0 {
		t.Fatal("cold run embedded no passages")
	}
	if first.CacheHits != 0 || first.CacheMisses == 0 {
		t.Fatalf("cold accounting: hits=%d misses=%d", first.CacheHits, first.CacheMisses)
	}

	warm := newFakeEmbedder(BatchingShared)
	warmRun := NewSelector(src, warm, cfg)
	second, err := warmRun.Select(context.Background(), snap.ContentID, question, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := documentTextsSent(warm); got != 0 {
		t.Fatalf("warm run re-embedded %d passages", got)
	}
	if second.CacheMisses != 0 || second.CacheHits == 0 {
		t.Fatalf("warm accounting: hits=%d misses=%d", second.CacheHits, second.CacheMisses)
	}

	// Identical evidence: same passages, order and scores.
	if len(first.Passages) != len(second.Passages) {
		t.Fatalf("passage count changed: %d vs %d", len(first.Passages), len(second.Passages))
	}
	for i := range first.Passages {
		if first.Passages[i].ID != second.Passages[i].ID {
			t.Fatalf("passage %d id changed", i)
		}
		if first.Passages[i].Score != second.Passages[i].Score {
			t.Fatalf("passage %d score changed: %v vs %v", i, first.Passages[i].Score, second.Passages[i].Score)
		}
		if first.Passages[i].CosineScore != second.Passages[i].CosineScore {
			t.Fatalf("passage %d cosine changed", i)
		}
	}
}

// TestSelectorVectorCacheIdentityChangeIsMiss: a different model identity must
// never reuse vectors produced by another model.
func TestSelectorVectorCacheIdentityChangeIsMiss(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cache := NewProcessVectorCache()
	cfg := defaultSelectorConfig()
	cfg.Cache = cache
	const question = "居民的權利如何受保障"

	if _, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, question, 0); err != nil {
		t.Fatal(err)
	}

	other := newFakeEmbedder(BatchingShared)
	other.model = "another-embedder"
	run := NewSelector(src, other, cfg)
	selection, err := run.Select(context.Background(), snap.ContentID, question, 0)
	if err != nil {
		t.Fatal(err)
	}
	if selection.CacheHits != 0 {
		t.Fatalf("vectors from another model were reused: hits=%d", selection.CacheHits)
	}
	if documentTextsSent(other) == 0 {
		t.Fatal("a model change must re-embed")
	}
}

// TestSelectorVectorCacheDimensionChangeIsMiss: dimensions are part of the
// identity, so a narrower vector configuration re-embeds.
func TestSelectorVectorCacheDimensionChangeIsMiss(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cache := NewProcessVectorCache()
	cfg := defaultSelectorConfig()
	cfg.Cache = cache

	if _, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "問題一", 0); err != nil {
		t.Fatal(err)
	}

	narrow := newFakeEmbedder(BatchingShared)
	narrow.dim = 8
	selection, err := NewSelector(src, narrow, cfg).Select(context.Background(), snap.ContentID, "問題一", 0)
	if err != nil {
		t.Fatal(err)
	}
	if selection.CacheHits != 0 {
		t.Fatalf("vectors with different dimensions were reused: hits=%d", selection.CacheHits)
	}
}

// TestSelectorVectorCacheVersionChangeIsMiss: a content update invalidates the
// stored vectors, so stale semantics can never be reused.
func TestSelectorVectorCacheVersionChangeIsMiss(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cache := NewProcessVectorCache()
	cfg := defaultSelectorConfig()
	cfg.Cache = cache
	const question = "居民的權利如何受保障"

	if _, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, question, 0); err != nil {
		t.Fatal(err)
	}

	updated := snap
	updated.Version = "content-revision:2"
	src2 := &fakeSource{snap: updated}
	selection, err := NewSelector(src2, newFakeEmbedder(BatchingShared), cfg).Select(context.Background(), updated.ContentID, question, 0)
	if err != nil {
		t.Fatal(err)
	}
	if selection.CacheHits != 0 {
		t.Fatalf("vectors from an older content version were reused: hits=%d", selection.CacheHits)
	}
}

// TestSelectorWithoutCacheIsUnchanged: the cache is optional, and omitting it
// must keep the previous request pattern exactly.
func TestSelectorWithoutCacheIsUnchanged(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cfg := defaultSelectorConfig() // no Cache
	selection, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "居民的權利如何受保障", 0)
	if err != nil {
		t.Fatal(err)
	}
	if selection.CacheHits != 0 || selection.CacheMisses != 0 {
		t.Fatalf("nil cache reported accounting: hits=%d misses=%d", selection.CacheHits, selection.CacheMisses)
	}
	if documentTextsSent(emb) == 0 {
		t.Fatal("nil cache must embed as before")
	}
}

// TestSelectorCacheRejectsWrongDimension: a stored vector of the wrong length is
// never used (the cache itself validates the key dimension).
func TestSelectorCacheRejectsWrongDimension(t *testing.T) {
	cache := NewProcessVectorCache()
	key := VectorCacheKey{ContentID: "c", SourceVersion: "v", PassageID: "p", ModelID: "m", Dimensions: 16}
	cache.Put(key, make([]float32, 8))
	if _, ok := cache.Get(key); ok {
		t.Fatal("a vector whose length differs from the key dimension was cached")
	}
	cache.Put(key, make([]float32, 16))
	if _, ok := cache.Get(key); !ok {
		t.Fatal("a matching vector was not cached")
	}
}

// TestEngineReportsCacheHits: the wire summary exposes cache usage so the UI can
// show that a repeat question did not re-embed.
func TestEngineReportsCacheHits(t *testing.T) {
	src, emb, snap := cacheFixture(t)
	cache := NewProcessVectorCache()
	engine := &Engine{Source: src, Embedder: emb, VectorCache: cache, Assembler: NewContextAssembler()}
	in := RunInput{ContentID: snap.ContentID, Question: "居民的權利如何受保障", Request: Request{Enabled: true, Mode: ModeHybrid, MaxChars: DefaultBudgetRunes}}

	first, err := engine.Run(context.Background(), in)
	if err != nil {
		t.Fatalf("cold run: %v", err)
	}
	if first.Response.Embedding.CacheHits != 0 || first.Response.Embedding.Requests == 0 {
		t.Fatalf("cold summary: %+v", first.Response.Embedding)
	}

	// A fresh embedder proves the vectors come from the cache, not from an
	// adapter that happens to be warm.
	warm := newFakeEmbedder(BatchingShared)
	engine.Embedder = warm
	second, err := engine.Run(context.Background(), in)
	if err != nil {
		t.Fatalf("warm run: %v", err)
	}
	if second.Response.Embedding.CacheHits == 0 {
		t.Fatalf("warm summary reported no cache hits: %+v", second.Response.Embedding)
	}
	// The warm run may still need one request for the question itself, but it
	// must not send a single passage text to the provider.
	if got := documentTextsSent(warm); got != 0 {
		t.Fatalf("warm run re-embedded %d passages", got)
	}
}
