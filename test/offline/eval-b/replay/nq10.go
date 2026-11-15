package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"

	"tangentry/internal/adapters/aichat"
	"tangentry/internal/retrieval"
)

// runDimensionMismatch exercises the REAL embedding adapter against a
// loopback test server (no external network): a wrong-dimension response and
// a wrong-model response must both be rejected fail-closed.
func (h *harness) runDimensionMismatch() negativeResult {
	ctx := context.Background()

	// (a) DashScope surface: 512-dim vectors against configured 1024.
	srvA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vec := make([]float64, 512)
		resp := map[string]any{
			"output": map[string]any{"embeddings": []map[string]any{{"embedding": vec, "text_index": 0}}},
			"usage":  map[string]any{"total_tokens": 5},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srvA.Close()
	settingsA := retrieval.EmbeddingSettings{
		ProviderKind: retrieval.ProviderBailian, Surface: retrieval.SurfaceDashScope,
		BaseURL: srvA.URL, Model: "text-embedding-v4", Dimensions: 1024, BatchSize: 8,
		EncodingFormat: retrieval.EncodingFloat, TopK: 100,
		LexicalWeight: 0.35, EmbeddingWeight: 0.65,
		MaxEmbeddingRequests: 10, MaxEmbeddingChars: 100000,
	}
	clientA := aichat.NewEmbeddingClient(settingsA, nil, nil)
	_, errA := clientA.Embed(ctx, []string{"dimension probe"}, retrieval.EmbedQuery)
	dimRejected := errA != nil && strings.Contains(errA.Error(), "dimension")

	// (b) OpenAI-compatible surface: returned model identity differs.
	srvB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vec := make([]float64, 1024)
		resp := map[string]any{
			"data":  []map[string]any{{"embedding": vec, "index": 0}},
			"model": "text-embedding-v3",
			"usage": map[string]any{"total_tokens": 5},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srvB.Close()
	settingsB := settingsA
	settingsB.Surface = retrieval.SurfaceOpenAICompatible
	settingsB.ProviderKind = retrieval.ProviderRemote
	settingsB.BaseURL = srvB.URL
	clientB := aichat.NewEmbeddingClient(settingsB, nil, nil)
	_, errB := clientB.Embed(ctx, []string{"model identity probe"}, retrieval.EmbedQuery)
	modelRejected := errB != nil && strings.Contains(errB.Error(), "model identity")

	pass := dimRejected && modelRejected
	return negativeResult{
		CaseID:   "NQ-010",
		Kind:     "model_mismatch",
		Expected: "dimension mismatch rejected",
		Actual:   boolStr(dimRejected) + "/" + boolStr(modelRejected),
		Pass:     pass,
		Detail:   "real adapter vs loopback server: wrong dimensions and wrong model identity both fail closed; cached vectors for another model/dimension are invalid",
	}
}

func boolStr(b bool) string {
	if b {
		return "rejected"
	}
	return "ACCEPTED(BAD)"
}
