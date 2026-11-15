package aichat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"tangentry/internal/retrieval"
)

type rerankTransport struct {
	server   *httptest.Server
	mu       sync.Mutex
	requests int
	fail     bool
	results  []map[string]any
}

func newRerankTransport(t *testing.T) *rerankTransport {
	t.Helper()
	rt := &rerankTransport{results: []map[string]any{
		{"index": 0, "relevance_score": 0.9},
		{"index": 1, "relevance_score": 0.2},
	}}
	mux := http.NewServeMux()
	handle := func(w http.ResponseWriter, r *http.Request) {
		rt.mu.Lock()
		rt.requests++
		rt.mu.Unlock()
		if rt.fail {
			w.WriteHeader(500)
			fmt.Fprint(w, `{"error":"secret-body"}`)
			return
		}
		// DashScope shape.
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{"results": rt.results},
			"usage":  map[string]any{"total_tokens": 5},
		})
	}
	mux.HandleFunc("/api/v1/services/rerank/text-rerank/text-rerank", handle)
	mux.HandleFunc("/compatible-api/v1/reranks", handle)
	rt.server = httptest.NewServer(mux)
	t.Cleanup(rt.server.Close)
	return rt
}

func (rt *rerankTransport) count() int {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return rt.requests
}

func rerankSettings(rt *rerankTransport, provider string) retrieval.EmbeddingSettings {
	s := retrieval.DefaultEmbeddingSettings()
	s.RerankProvider = provider
	s.RerankModel = "gte-rerank-v2"
	s.RerankBaseURL = rt.server.URL
	s.RerankAPIKey = "rerank-key"
	s.RerankTopN = 2
	s.MaxRerankRequests = 2
	return s
}

// TestBT36_Rerank: off → zero POST; bailian/custom → request-relative scores;
// failure → error (caller degrades to rerank_unavailable); requests counted
// by B budget; scores clamped to [0,1].
func TestBT36_Rerank(t *testing.T) {
	ctx := context.Background()
	// Off by default → zero POST.
	rt := newRerankTransport(t)
	off := NewRerankClient(retrieval.DefaultEmbeddingSettings(), retrieval.NewBudgetTracker(0, 0))
	if off.Enabled() {
		t.Fatal("rerank must be off by default")
	}
	if _, err := off.Rerank(ctx, "q", []string{"a", "b"}, 2); err == nil {
		t.Fatal("disabled rerank must refuse")
	}
	if rt.count() != 0 {
		t.Fatalf("off rerank made %d requests", rt.count())
	}

	// Bailian DashScope surface.
	bt := retrieval.NewBudgetTracker(2, 0)
	c := NewRerankClient(rerankSettings(rt, "bailian"), bt)
	if !c.Enabled() {
		t.Fatal("configured rerank must be enabled")
	}
	res, err := c.Rerank(ctx, "query", []string{"doc0", "doc1"}, 2)
	if err != nil || len(res) != 2 {
		t.Fatalf("rerank: %v %+v", err, res)
	}
	if res[0].Index != 0 || res[0].RelevanceScore != 0.9 {
		t.Fatalf("scores: %+v", res)
	}
	if bt.Requests() != 1 {
		t.Fatalf("budget requests = %d", bt.Requests())
	}

	// Custom compatible surface.
	rt2 := newRerankTransport(t)
	c2 := NewRerankClient(rerankSettings(rt2, "custom"), retrieval.NewBudgetTracker(2, 0))
	if _, err := c2.Rerank(ctx, "query", []string{"doc0", "doc1"}, 2); err != nil {
		t.Fatal(err)
	}
	if rt2.count() != 1 {
		t.Fatalf("custom rerank requests = %d", rt2.count())
	}

	// Failure → error, redacted.
	rt3 := newRerankTransport(t)
	rt3.fail = true
	c3 := NewRerankClient(rerankSettings(rt3, "bailian"), retrieval.NewBudgetTracker(2, 0))
	_, err = c3.Rerank(ctx, "query", []string{"doc0"}, 1)
	if err == nil {
		t.Fatal("failed rerank must error")
	}

	// Budget exhaustion stops further rerank POSTs.
	rt4 := newRerankTransport(t)
	bt4 := retrieval.NewBudgetTracker(1, 0)
	c4 := NewRerankClient(rerankSettings(rt4, "bailian"), bt4)
	if _, err := c4.Rerank(ctx, "q", []string{"a"}, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := c4.Rerank(ctx, "q", []string{"b"}, 1); err == nil {
		t.Fatal("2nd rerank must be blocked (limit 1)")
	}
	if rt4.count() != 1 {
		t.Fatalf("rerank requests = %d, want 1", rt4.count())
	}
}

// TestBT36_ScoreClamp: out-of-range relevance scores are clamped to [0,1].
func TestBT36_ScoreClamp(t *testing.T) {
	rt := newRerankTransport(t)
	rt.results = []map[string]any{
		{"index": 0, "relevance_score": 1.5},
		{"index": 1, "relevance_score": -0.3},
	}
	c := NewRerankClient(rerankSettings(rt, "bailian"), retrieval.NewBudgetTracker(2, 0))
	res, err := c.Rerank(context.Background(), "q", []string{"a", "b"}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].RelevanceScore != 1 || res[1].RelevanceScore != 0 {
		t.Fatalf("scores not clamped: %+v", res)
	}
}
