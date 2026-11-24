package retrieval

import (
	"context"
	"errors"
	"testing"
)

type rerankCall struct {
	query string
	docs  []string
	topN  int
}

type fakeReranker struct {
	model string
	calls []rerankCall
	// score maps a document text to its relevance; missing texts score 0.
	score func(text string) float64
	err   error
	// indexShift lets a test return an out-of-range index.
	indexShift int
}

func (f *fakeReranker) ModelID() string { return f.model }

func (f *fakeReranker) Rerank(ctx context.Context, query string, documents []string, topN int) ([]RerankResult, error) {
	f.calls = append(f.calls, rerankCall{query: query, docs: append([]string(nil), documents...), topN: topN})
	if f.err != nil {
		return nil, f.err
	}
	out := make([]RerankResult, 0, len(documents))
	for i, doc := range documents {
		score := 0.0
		if f.score != nil {
			score = f.score(doc)
		}
		out = append(out, RerankResult{Index: i + f.indexShift, RelevanceScore: score})
	}
	return out, nil
}

func rerankFixture(t *testing.T) (*fakeSource, *fakeEmbedder, Snapshot) {
	return cacheFixture(t)
}

// TestSelectorRerankReorders: the rerank component must actually change the
// order and be folded into the hybrid score with the rerank weight.
func TestSelectorRerankReorders(t *testing.T) {
	src, emb, snap := rerankFixture(t)
	cfg := defaultSelectorConfig()
	cfg.Weights = DefaultRerankWeights()
	// The third paragraph gets the highest rerank relevance.
	reranker := &fakeReranker{model: "fake-rerank", score: func(text string) float64 {
		if text == snap.Blocks[2].Text {
			return 1
		}
		return 0
	}}
	cfg.Reranker = reranker

	selection, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "行政機關的責任", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !selection.RerankUsed || selection.RerankModel != "fake-rerank" || selection.RerankRequests != 1 {
		t.Fatalf("rerank not applied: %+v", selection)
	}
	if len(selection.Passages) == 0 {
		t.Fatal("no passages")
	}
	if selection.Passages[0].Text != snap.Blocks[2].Text {
		t.Fatalf("rerank did not move the top passage: %q", selection.Passages[0].Text[:20])
	}
	if selection.Passages[0].RerankScore != 1 {
		t.Fatalf("rerank score not recorded: %v", selection.Passages[0].RerankScore)
	}
	// The hybrid score must include the rerank weight.
	want := HybridScore(DefaultRerankWeights(), selection.Passages[0].LexicalNorm, selection.Passages[0].CosineScore, 1)
	if diff := selection.Passages[0].Score - want; diff > 1e-9 || diff < -1e-9 {
		t.Fatalf("score %v != expected %v", selection.Passages[0].Score, want)
	}
}

// TestSelectorRerankSendsBoundedDocuments: only RerankDocs passages (the current
// ranking) are sent, keeping the request small.
func TestSelectorRerankSendsBoundedDocuments(t *testing.T) {
	src, emb, snap := rerankFixture(t)
	cfg := defaultSelectorConfig()
	cfg.Weights = DefaultRerankWeights()
	cfg.RerankDocs = 2
	reranker := &fakeReranker{model: "fake-rerank"}
	cfg.Reranker = reranker

	if _, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "居民的權利", 0); err != nil {
		t.Fatal(err)
	}
	if len(reranker.calls) != 1 {
		t.Fatalf("rerank calls = %d", len(reranker.calls))
	}
	if got := len(reranker.calls[0].docs); got != 2 {
		t.Fatalf("sent %d documents, want 2", got)
	}
	if reranker.calls[0].query != "居民的權利" {
		t.Fatalf("query = %q", reranker.calls[0].query)
	}
}

// TestSelectorRerankFailureDegrades: a provider failure keeps the embedding
// ranking, reports the reason, and never returns an empty result or a false
// "reranked" claim.
func TestSelectorRerankFailureDegrades(t *testing.T) {
	src, emb, snap := rerankFixture(t)
	cfg := defaultSelectorConfig()
	cfg.Weights = DefaultRerankWeights()
	cfg.Reranker = &fakeReranker{err: errors.New("provider down")}

	selection, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "居民的權利", 0)
	if err != nil {
		t.Fatalf("a rerank failure must not fail the run: %v", err)
	}
	if selection.RerankUsed {
		t.Fatal("failed rerank claimed success")
	}
	if selection.RerankReason != RerankReasonUnavailable {
		t.Fatalf("reason = %q", selection.RerankReason)
	}
	if len(selection.Passages) == 0 {
		t.Fatal("rerank failure dropped the passages")
	}
	for _, p := range selection.Passages {
		if p.RerankScore != 0 {
			t.Fatalf("rerank score recorded after a failure: %v", p.RerankScore)
		}
	}
}

// TestSelectorRerankInvalidIndexDegrades: a malformed provider response is a
// labelled degradation, not a panic and not a silent success.
func TestSelectorRerankInvalidIndexDegrades(t *testing.T) {
	src, emb, snap := rerankFixture(t)
	cfg := defaultSelectorConfig()
	cfg.Weights = DefaultRerankWeights()
	cfg.Reranker = &fakeReranker{indexShift: 99}

	selection, err := NewSelector(src, emb, cfg).Select(context.Background(), snap.ContentID, "居民的權利", 0)
	if err != nil {
		t.Fatal(err)
	}
	if selection.RerankUsed || selection.RerankReason != RerankReasonInvalid {
		t.Fatalf("invalid rerank response not reported: used=%v reason=%q", selection.RerankUsed, selection.RerankReason)
	}
}

// TestSelectorRerankSkippedWithoutEmbedding: a lexical-only run has no cosine
// component, so reranking is not applied (and the provider is not called).
func TestSelectorRerankSkippedWithoutEmbedding(t *testing.T) {
	src, _, snap := rerankFixture(t)
	cfg := defaultSelectorConfig()
	cfg.Weights = DefaultRerankWeights()
	reranker := &fakeReranker{model: "fake-rerank"}
	cfg.Reranker = reranker

	selection, err := NewSelector(src, nil, cfg).Select(context.Background(), snap.ContentID, "居民的權利", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(reranker.calls) != 0 {
		t.Fatalf("rerank called on a lexical-only run: %d calls", len(reranker.calls))
	}
	if selection.RerankUsed {
		t.Fatal("lexical-only run claimed rerank")
	}
}

// TestEngineRerankSummary: the wire summary distinguishes "ran", "failed" and
// "off", so the UI can label the answer honestly.
func TestEngineRerankSummary(t *testing.T) {
	base := func() RunInput {
		return RunInput{ContentID: "fixture:cache", Question: "居民的權利", Request: Request{Enabled: true, Mode: ModeHybrid, MaxChars: DefaultBudgetRunes}}
	}
	settings := DefaultRerankWeights()

	t.Run("ran", func(t *testing.T) {
		src, emb, _ := rerankFixture(t)
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(),
			Reranker: &fakeReranker{model: "qwen3.7-text-rerank"}}
		engine.Settings = &EmbeddingSettings{LexicalWeight: settings.Lexical, EmbeddingWeight: settings.Embedding, RerankWeight: settings.Rerank,
			TopK: 100, BatchSize: 8, MaxEmbeddingRequests: 24, MaxEmbeddingChars: 100000, MaxRerankRequests: 8}
		got, err := engine.Run(context.Background(), base())
		if err != nil {
			t.Fatal(err)
		}
		if !got.Response.Rerank.Enabled || got.Response.Rerank.Requests != 1 {
			t.Fatalf("rerank summary = %+v", got.Response.Rerank)
		}
		if got.Response.Rerank.Model != "qwen3.7-text-rerank" {
			t.Fatalf("model = %q", got.Response.Rerank.Model)
		}
	})

	t.Run("failed", func(t *testing.T) {
		src, emb, _ := rerankFixture(t)
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(),
			Reranker: &fakeReranker{model: "qr", err: errors.New("down")}}
		engine.Settings = &EmbeddingSettings{LexicalWeight: settings.Lexical, EmbeddingWeight: settings.Embedding, RerankWeight: settings.Rerank,
			TopK: 100, BatchSize: 8, MaxEmbeddingRequests: 24, MaxEmbeddingChars: 100000, MaxRerankRequests: 8}
		got, err := engine.Run(context.Background(), base())
		if err != nil {
			t.Fatal(err)
		}
		if got.Response.Rerank.BudgetStatus != RerankReasonUnavailable {
			t.Fatalf("budgetStatus = %q", got.Response.Rerank.BudgetStatus)
		}
	})

	t.Run("off", func(t *testing.T) {
		src, emb, _ := rerankFixture(t)
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler()}
		got, err := engine.Run(context.Background(), base())
		if err != nil {
			t.Fatal(err)
		}
		if got.Response.Rerank.Enabled || got.Response.Rerank.BudgetStatus != BudgetDisabled {
			t.Fatalf("rerank summary = %+v", got.Response.Rerank)
		}
	})
}
