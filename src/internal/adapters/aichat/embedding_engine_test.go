package aichat

import (
	"context"
	"encoding/json"
	"testing"

	"tangentry/internal/retrieval"
)

// engineArticleSource serves a fixed article snapshot through the real
// retrieval port (exact re-reads included).
type engineArticleSource struct{ snap retrieval.Snapshot }

func (s *engineArticleSource) Snapshot(ctx context.Context, contentID string) (retrieval.Snapshot, error) {
	if contentID != s.snap.ContentID {
		return retrieval.Snapshot{}, retrieval.ErrSourceNotFound
	}
	return s.snap, nil
}

func (s *engineArticleSource) ReadRange(ctx context.Context, contentID, locator string, start, end int) (string, string, error) {
	return retrieval.SnapshotRange(s.snap, locator, start, end)
}

// engineArticleFixture builds an article with enough matching blocks that a
// hybrid run needs several embedding batches (batch size 8, question rides
// the first shared batch).
func engineArticleFixture(blocks int) retrieval.Snapshot {
	snap := retrieval.Snapshot{
		ContentID: "fixture:engine-adapter",
		Kind:      retrieval.SourceArticle,
		Version:   "content-revision:1",
	}
	for i := 0; i < blocks; i++ {
		snap.Blocks = append(snap.Blocks, retrieval.Block{Index: i, Kind: "paragraph", Text: "答案证据文本段落编号" + string(rune('A'+i)) + "。"})
	}
	return snap
}

func engineBudgetRequest(t *testing.T, body string) retrieval.Request {
	t.Helper()
	var req retrieval.Request
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatal(err)
	}
	return req
}

// TestEngineAdapterMissingUsageStopsBatches: the production combination
// (engine wrapper + adapter constructed with a nil budget) must stop after
// the first batch when a valid-vector response lacks usage: observed work is
// retained, the budget reports unknown, and no later batch starts. A second
// invocation gets a fresh tracker (no shared state).
func TestEngineAdapterMissingUsageStopsBatches(t *testing.T) {
	et := newEmbedTransport(t, 4, "bge-m3")
	et.omitUsage = true
	adapter := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	engine := &retrieval.Engine{Source: &engineArticleSource{snap: engineArticleFixture(16)}, Embedder: adapter, Assembler: retrieval.NewContextAssembler()}
	req := engineBudgetRequest(t, `{"schemaVersion":1,"enabled":true,"mode":"hybrid","embeddingBudget":{"maxRequests":24}}`)
	in := retrieval.RunInput{ContentID: "fixture:engine-adapter", Question: "答案证据", Request: req}

	result, err := engine.Run(context.Background(), in)
	if err != nil {
		t.Fatalf("missing usage must retain work via lexical fallback: %v", err)
	}
	if et.count() != 1 {
		t.Fatalf("missing usage started %d POSTs, want exactly 1 (no later batch)", et.count())
	}
	if result.Response.Embedding.BudgetStatus != retrieval.BudgetEmbeddingUsageUnknown {
		t.Fatalf("budget status = %s, want embedding_usage_unknown", result.Response.Embedding.BudgetStatus)
	}
	if result.Response.Embedding.Requests != 1 {
		t.Fatalf("observed requests = %d, want 1", result.Response.Embedding.Requests)
	}
	if len(result.Response.Passages) == 0 {
		t.Fatal("observed work must be retained (lexical fallback passages)")
	}

	// A new invocation is independent: the unknown state of the previous
	// invocation neither leaks nor blocks the fresh first batch.
	result2, err := engine.Run(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if et.count() != 2 {
		t.Fatalf("second invocation POSTs = %d, want 2 total (fresh tracker)", et.count())
	}
	if result2.Response.Embedding.BudgetStatus != retrieval.BudgetEmbeddingUsageUnknown || result2.Response.Embedding.Requests != 1 {
		t.Fatalf("second invocation summary: %+v", result2.Response.Embedding)
	}
}

// TestEngineAdapterUsagePresentBatches: with valid usage the same fixture
// runs all shared batches (17 texts / 8 = 3 POSTs) and reports completed.
func TestEngineAdapterUsagePresentBatches(t *testing.T) {
	et := newEmbedTransport(t, 4, "bge-m3")
	adapter := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	engine := &retrieval.Engine{Source: &engineArticleSource{snap: engineArticleFixture(16)}, Embedder: adapter, Assembler: retrieval.NewContextAssembler()}
	req := engineBudgetRequest(t, `{"schemaVersion":1,"enabled":true,"mode":"hybrid","embeddingBudget":{"maxRequests":24}}`)
	result, err := engine.Run(context.Background(), retrieval.RunInput{ContentID: "fixture:engine-adapter", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatal(err)
	}
	if et.count() != 3 {
		t.Fatalf("POSTs = %d, want 3 shared batches", et.count())
	}
	if result.Response.Embedding.BudgetStatus != retrieval.BudgetCompleted || result.Response.Embedding.Requests != 3 {
		t.Fatalf("summary: %+v", result.Response.Embedding)
	}
	if result.Response.Mode != "hybrid" {
		t.Fatalf("mode = %s, want hybrid", result.Response.Mode)
	}
}

// TestEngineAdapterExplicitZeroNoPOST: the HTTP-path zero contract — an
// explicit embeddingBudget.maxRequests=0 starts zero embedding POSTs through
// the real engine/adapter combination (selector-only tests cannot see this).
func TestEngineAdapterExplicitZeroNoPOST(t *testing.T) {
	et := newEmbedTransport(t, 4, "bge-m3")
	adapter := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	engine := &retrieval.Engine{Source: &engineArticleSource{snap: engineArticleFixture(16)}, Embedder: adapter, Assembler: retrieval.NewContextAssembler()}
	req := engineBudgetRequest(t, `{"schemaVersion":1,"enabled":true,"mode":"hybrid","embeddingBudget":{"maxRequests":0}}`)
	result, err := engine.Run(context.Background(), retrieval.RunInput{ContentID: "fixture:engine-adapter", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatalf("zero budget must fall back to lexical: %v", err)
	}
	if et.count() != 0 {
		t.Fatalf("explicit zero started %d embedding POSTs, want 0", et.count())
	}
	if result.Response.Embedding.BudgetStatus != retrieval.BudgetDisabled || result.Response.Embedding.Requests != 0 {
		t.Fatalf("summary: %+v", result.Response.Embedding)
	}
	if len(result.Response.Passages) == 0 {
		t.Fatal("lexical fallback must retain passages")
	}
}
