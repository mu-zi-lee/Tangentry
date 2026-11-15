package httptransport

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

// fakeRetrievalSettings records the decoded input for boundary assertions.
type fakeRetrievalSettings struct {
	masked     retrieval.MaskedSettings
	savedInput retrieval.EmbeddingSettings
	err        error
}

func (f *fakeRetrievalSettings) Get(ctx context.Context) (retrieval.MaskedSettings, error) {
	return f.masked, f.err
}

func (f *fakeRetrievalSettings) Save(ctx context.Context, input retrieval.EmbeddingSettings) (retrieval.MaskedSettings, error) {
	f.savedInput = input
	return f.masked, f.err
}

func retrievalSettingsRequest(t *testing.T, method, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, "/api/ai/retrieval/settings", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

// TestRetrievalSettingsBoundary: GET/PUT use the masked shape, PUT decodes
// the camelCase settings (keys write-only), unknown fields are rejected, and
// the endpoints do not depend on the chat provider being configured.
func TestRetrievalSettingsBoundary(t *testing.T) {
	settings := retrieval.DefaultEmbeddingSettings()
	settings.APIKey = "boundary-secret-key"
	fake := &fakeRetrievalSettings{masked: settings.Mask()}
	h := &aiHandler{ai: AIDependencies{RetrievalSettings: fake}} // AI intentionally nil

	w := httptest.NewRecorder()
	h.retrievalSettingsGet(w, httptest.NewRequest(http.MethodGet, "/api/ai/retrieval/settings", nil))
	if w.Code != 200 {
		t.Fatalf("GET = %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "boundary-secret-key") {
		t.Fatalf("GET leaked the key: %s", w.Body.String())
	}

	body := `{"providerKind":"remote","surface":"openai","baseUrl":"https://embed.example/v1","apiKey":"new-key","model":"custom","dimensions":4,"batchSize":8,"textType":"","instruct":"","encodingFormat":"float","timeoutMs":5000,"topK":100,"lexicalWeight":0.35,"embeddingWeight":0.65,"rerankWeight":0,"maxEmbeddingRequests":24,"maxEmbeddingChars":100000,"maxRerankRequests":0,"rerankProvider":"off","rerankModel":"","rerankBaseUrl":"","rerankApiKey":"","rerankTopN":0,"rerankInstruct":""}`
	w = httptest.NewRecorder()
	h.retrievalSettingsPut(w, retrievalSettingsRequest(t, http.MethodPut, body))
	if w.Code != 200 {
		t.Fatalf("PUT = %d: %s", w.Code, w.Body.String())
	}
	if fake.savedInput.ProviderKind != "remote" || fake.savedInput.Model != "custom" || fake.savedInput.APIKey != "new-key" || fake.savedInput.Dimensions != 4 {
		t.Fatalf("decoded input: %+v", fake.savedInput)
	}
	if strings.Contains(w.Body.String(), "boundary-secret-key") || strings.Contains(w.Body.String(), "new-key") {
		t.Fatalf("PUT response leaked a key: %s", w.Body.String())
	}

	// Unknown fields are rejected at the boundary.
	w = httptest.NewRecorder()
	h.retrievalSettingsPut(w, retrievalSettingsRequest(t, http.MethodPut, `{"model":"custom","bogusField":1}`))
	if w.Code != 400 {
		t.Fatalf("unknown field = %d, want 400", w.Code)
	}

	// Validation faults map to the distinct 400; storage faults to 503.
	fake.err = errors.Join(retrieval.ErrInvalidInput, errors.New("dimensions must be a positive integer"))
	w = httptest.NewRecorder()
	h.retrievalSettingsPut(w, retrievalSettingsRequest(t, http.MethodPut, body))
	if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_retrieval_settings") {
		t.Fatalf("validation fault = %d: %s", w.Code, w.Body.String())
	}
	fake.err = errors.New("disk unavailable")
	w = httptest.NewRecorder()
	h.retrievalSettingsGet(w, httptest.NewRequest(http.MethodGet, "/api/ai/retrieval/settings", nil))
	if w.Code != 503 {
		t.Fatalf("storage fault = %d, want 503", w.Code)
	}

	// Without the settings dependency the endpoints are unavailable.
	empty := &aiHandler{ai: AIDependencies{}}
	w = httptest.NewRecorder()
	empty.retrievalSettingsGet(w, httptest.NewRequest(http.MethodGet, "/api/ai/retrieval/settings", nil))
	if w.Code != 503 {
		t.Fatalf("missing dependency = %d, want 503", w.Code)
	}
}

// TestRetrievalSettingsRouteRegistered: the mux exposes GET/PUT on the
// settings path (and the masked response survives the full handler chain).
func TestRetrievalSettingsRouteRegistered(t *testing.T) {
	settings := retrieval.DefaultEmbeddingSettings()
	fake := &fakeRetrievalSettings{masked: settings.Mask()}
	h := NewWithDependencies(Dependencies{AI: AIDependencies{RetrievalSettings: fake}}, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/ai/retrieval/settings", nil))
	if w.Code != 200 {
		t.Fatalf("route GET = %d: %s", w.Code, w.Body.String())
	}
	var masked map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &masked); err != nil {
		t.Fatal(err)
	}
	if masked["model"] != "bge-m3" || masked["hasKey"] != false {
		t.Fatalf("masked route response: %s", w.Body.String())
	}
}
