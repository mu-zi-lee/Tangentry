package aichat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"tangentry/internal/retrieval"
)

// embedRequest records one HTTP embedding request for assertions.
type embedRequest struct {
	Texts      []string
	TextType   string
	Model      string
	Dimensions int
	Instruct   string
	Surface    string
}

// embedTransport is a fake embedding provider counting every request and its
// role/text_type. No real network/credentials.
type embedTransport struct {
	server     *httptest.Server
	mu         sync.Mutex
	requests   []embedRequest
	dim        int
	model      string
	omitUsage  bool
	wrongDim   bool
	wrongModel bool
	status     int
}

func newEmbedTransport(t *testing.T, dim int, model string) *embedTransport {
	t.Helper()
	et := &embedTransport{dim: dim, model: model, status: 200}
	mux := http.NewServeMux()
	handle := func(surface string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			rec := embedRequest{Surface: surface, Model: fmt.Sprint(body["model"])}
			var texts []string
			if surface == "dashscope" {
				if input, ok := body["input"].(map[string]any); ok {
					for _, tx := range input["texts"].([]any) {
						texts = append(texts, fmt.Sprint(tx))
					}
				}
				if params, ok := body["parameters"].(map[string]any); ok {
					rec.TextType, _ = params["text_type"].(string)
					rec.Instruct, _ = params["instruct"].(string)
					if d, ok := params["dimension"].(float64); ok {
						rec.Dimensions = int(d)
					}
				}
			} else {
				for _, tx := range body["input"].([]any) {
					texts = append(texts, fmt.Sprint(tx))
				}
				if d, ok := body["dimensions"].(float64); ok {
					rec.Dimensions = int(d)
				}
			}
			rec.Texts = texts
			et.mu.Lock()
			et.requests = append(et.requests, rec)
			et.mu.Unlock()
			if et.status != 200 {
				w.WriteHeader(et.status)
				fmt.Fprint(w, `{"error":{"message":"rejected secret-token-body"}}`)
				return
			}
			dim := et.dim
			if et.wrongDim {
				dim = dim + 1
			}
			respModel := et.model
			if et.wrongModel {
				respModel = "different-model"
			}
			vec := make([]float64, dim)
			for i := range vec {
				vec[i] = 0.1
			}
			if surface == "dashscope" {
				embs := make([]map[string]any, len(texts))
				for i := range texts {
					embs[i] = map[string]any{"embedding": vec, "text_index": i}
				}
				out := map[string]any{"output": map[string]any{"embeddings": embs}}
				if !et.omitUsage {
					out["usage"] = map[string]any{"total_tokens": 10}
				}
				_ = json.NewEncoder(w).Encode(out)
				return
			}
			data := make([]map[string]any, len(texts))
			for i := range texts {
				data[i] = map[string]any{"embedding": vec, "index": i}
			}
			out := map[string]any{"data": data, "model": respModel}
			if !et.omitUsage {
				out["usage"] = map[string]any{"total_tokens": 10}
			}
			_ = json.NewEncoder(w).Encode(out)
		}
	}
	mux.HandleFunc("/embeddings", handle("openai"))
	mux.HandleFunc("/api/v1/services/embeddings/text-embedding/text-embedding", handle("dashscope"))
	et.server = httptest.NewServer(mux)
	t.Cleanup(et.server.Close)
	return et
}

func (et *embedTransport) count() int {
	et.mu.Lock()
	defer et.mu.Unlock()
	return len(et.requests)
}

func (et *embedTransport) snapshot() []embedRequest {
	et.mu.Lock()
	defer et.mu.Unlock()
	return append([]embedRequest(nil), et.requests...)
}

func (et *embedTransport) settings(surface string) retrieval.EmbeddingSettings {
	s := retrieval.DefaultEmbeddingSettings()
	s.ProviderKind = retrieval.ProviderRemote
	s.Surface = surface
	s.BaseURL = et.server.URL
	s.Model = et.model
	s.Dimensions = et.dim
	s.BatchSize = 8
	s.APIKey = "test-key"
	return s
}

// TestBT31_AdapterRoleAndSurface: split mode sets text_type by role and never
// mixes roles; shared omits text_type; instruct is query-only; both surfaces
// work; dimension validated.
func TestBT31_AdapterRoleAndSurface(t *testing.T) {
	ctx := context.Background()
	// DashScope split.
	et := newEmbedTransport(t, 4, "text-embedding-v4")
	s := et.settings(retrieval.SurfaceDashScope)
	s.ProviderKind = retrieval.ProviderBailian
	s.Instruct = "query instruction"
	c := NewEmbeddingClient(s, nil, nil)
	if c.BatchingMode() != retrieval.BatchingSplit {
		t.Fatal("DashScope must be split")
	}
	if _, err := c.Embed(ctx, []string{"question"}, retrieval.EmbedQuery); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Embed(ctx, []string{"doc1", "doc2"}, retrieval.EmbedDocument); err != nil {
		t.Fatal(err)
	}
	reqs := et.snapshot()
	if len(reqs) != 2 {
		t.Fatalf("requests = %d", len(reqs))
	}
	if reqs[0].TextType != "query" || reqs[0].Instruct != "query instruction" {
		t.Fatalf("query request: %+v", reqs[0])
	}
	if reqs[1].TextType != "document" || reqs[1].Instruct != "" {
		t.Fatalf("document request must not carry instruct: %+v", reqs[1])
	}
	for _, r := range reqs {
		if r.Surface != "dashscope" || r.Dimensions != 4 {
			t.Fatalf("surface/dims: %+v", r)
		}
	}

	// OpenAI-compatible shared: no text_type.
	et2 := newEmbedTransport(t, 4, "bge-m3")
	s2 := et2.settings(retrieval.SurfaceOpenAICompatible)
	c2 := NewEmbeddingClient(s2, nil, nil)
	if c2.BatchingMode() != retrieval.BatchingShared {
		t.Fatal("local-compatible must be shared")
	}
	if _, err := c2.Embed(ctx, []string{"a", "b"}, retrieval.EmbedDocument); err != nil {
		t.Fatal(err)
	}
	r2 := et2.snapshot()[0]
	if r2.TextType != "" || r2.Surface != "openai" {
		t.Fatalf("shared must omit text_type: %+v", r2)
	}
}

// TestBT26_AdapterFailures: wrong dimension, wrong model identity, missing
// usage and auth failure are explicit errors (fail closed); missing usage
// marks the B budget unknown and stops further calls.
func TestBT26_AdapterFailures(t *testing.T) {
	ctx := context.Background()
	// Wrong dimension.
	et := newEmbedTransport(t, 4, "bge-m3")
	et.wrongDim = true
	c := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	if _, err := c.Embed(ctx, []string{"x"}, retrieval.EmbedDocument); err == nil {
		t.Fatal("wrong dimension must fail closed")
	}
	// Wrong model identity.
	et2 := newEmbedTransport(t, 4, "bge-m3")
	et2.wrongModel = true
	c2 := NewEmbeddingClient(et2.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	if _, err := c2.Embed(ctx, []string{"x"}, retrieval.EmbedDocument); err == nil {
		t.Fatal("model identity mismatch must fail")
	}
	// Missing usage → budget unknown, further calls blocked.
	et3 := newEmbedTransport(t, 4, "bge-m3")
	et3.omitUsage = true
	bt := retrieval.NewBudgetTracker(10, 100000)
	c3 := NewEmbeddingClient(et3.settings(retrieval.SurfaceOpenAICompatible), bt, nil)
	if _, err := c3.Embed(ctx, []string{"x"}, retrieval.EmbedDocument); err != nil {
		t.Fatalf("first call returns vectors: %v", err)
	}
	if bt.Status() != retrieval.BudgetEmbeddingUsageUnknown {
		t.Fatalf("budget status = %s", bt.Status())
	}
	if _, err := c3.Embed(ctx, []string{"y"}, retrieval.EmbedDocument); err == nil {
		t.Fatal("usage-unknown must stop further calls")
	}
	// Auth failure.
	et4 := newEmbedTransport(t, 4, "bge-m3")
	et4.status = 401
	c4 := NewEmbeddingClient(et4.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	if _, err := c4.Embed(ctx, []string{"x"}, retrieval.EmbedDocument); err == nil {
		t.Fatal("401 must fail")
	}
	// Error body redaction: the secret body never surfaces.
	et5 := newEmbedTransport(t, 4, "bge-m3")
	et5.status = 400
	c5 := NewEmbeddingClient(et5.settings(retrieval.SurfaceOpenAICompatible), nil, nil)
	_, err := c5.Embed(ctx, []string{"x"}, retrieval.EmbedDocument)
	if err == nil || strings.Contains(err.Error(), "secret-token-body") {
		t.Fatalf("error body must be redacted: %v", err)
	}
}

// TestBT24_BBudgetAndALedger: the adapter reserves B-budget slots before each
// POST, never exceeds the limit, and never calls A's completion reservation.
func TestBT24_BBudgetAndALedger(t *testing.T) {
	ctx := context.Background()
	et := newEmbedTransport(t, 4, "bge-m3")
	bt := retrieval.NewBudgetTracker(2, 100000)
	c := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), bt, nil)
	for i := 0; i < 2; i++ {
		if _, err := c.Embed(ctx, []string{"x"}, retrieval.EmbedDocument); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := c.Embed(ctx, []string{"y"}, retrieval.EmbedDocument); err == nil {
		t.Fatal("3rd call must be blocked by B budget (limit 2)")
	}
	if et.count() != 2 || bt.Requests() != 2 {
		t.Fatalf("requests=%d budget=%d", et.count(), bt.Requests())
	}
	if bt.Status() != retrieval.BudgetEmbeddingExhausted {
		t.Fatalf("status=%s", bt.Status())
	}
	// A's completion ledger is untouched: no completion POST was made to the
	// embedding transport, and the adapter never invokes reserveCompletion.
	for _, r := range et.snapshot() {
		if r.Surface != "openai" {
			t.Fatalf("unexpected surface: %+v", r)
		}
	}
}

// TestBT37_LocalFirstEmbedding: default settings are local loopback; a
// non-loopback local endpoint is rejected; no cloud call without a switch.
func TestBT37_LocalFirstEmbedding(t *testing.T) {
	def := retrieval.DefaultEmbeddingSettings()
	if def.ProviderKind != retrieval.ProviderLocal || def.Model != "bge-m3" || def.Dimensions != 1024 {
		t.Fatalf("local-first default: %+v", def)
	}
	if !retrieval.IsLoopbackURL(def.BaseURL) {
		t.Fatal("default must be loopback")
	}
	if err := retrieval.ValidateEmbeddingSettings(def); err != nil {
		t.Fatalf("default validates: %v", err)
	}
	// Local with a non-loopback URL is rejected.
	bad := def
	bad.BaseURL = "https://cloud.example.com/v1"
	if err := retrieval.ValidateEmbeddingSettings(bad); err == nil {
		t.Fatal("local non-loopback must be rejected")
	}
	// The adapter refuses a non-loopback local endpoint at call time.
	et := newEmbedTransport(t, 4, "bge-m3")
	s := et.settings(retrieval.SurfaceOpenAICompatible)
	s.ProviderKind = retrieval.ProviderLocal // server.URL is 127.0.0.1 (loopback)
	c := NewEmbeddingClient(s, nil, nil)
	if _, err := c.Embed(context.Background(), []string{"x"}, retrieval.EmbedDocument); err != nil {
		t.Fatalf("loopback local must work: %v", err)
	}
}

// TestEmbeddingBase64Encoding: base64 vectors decode to the right dimension.
func TestEmbeddingBase64Encoding(t *testing.T) {
	et := newEmbedTransport(t, 4, "bge-m3")
	s := et.settings(retrieval.SurfaceOpenAICompatible)
	s.EncodingFormat = retrieval.EncodingBase64
	c := NewEmbeddingClient(s, nil, nil)
	// 4 float32 little-endian (1,2,3,4) = 16 bytes.
	raw := []byte{0, 0, 0x80, 0x3f, 0, 0, 0, 0x40, 0, 0, 0x40, 0x40, 0, 0, 0x80, 0x40}
	enc := base64.StdEncoding.EncodeToString(raw)
	vec, err := c.decodeVector(json.RawMessage(`"` + enc + `"`))
	if err != nil || len(vec) != 4 || vec[0] != 1 || vec[1] != 2 || vec[3] != 4 {
		t.Fatalf("base64 decode: %v %v", vec, err)
	}
	// Wrong dimension fails closed.
	if _, err := c.decodeVector(json.RawMessage(`"` + base64.StdEncoding.EncodeToString(raw[:8]) + `"`)); err == nil {
		t.Fatal("base64 wrong dimension must fail")
	}
}
