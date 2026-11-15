package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"tangentry/internal/ai"
)

// integrationChatProvider is a fake translator/chatter for full-app tests:
// it records the system-message source and never touches the network.
type integrationChatProvider struct {
	mu         sync.Mutex
	chatCalls  int
	lastSource string
}

func (p *integrationChatProvider) Translate(ctx context.Context, c ai.Config, segments []ai.Segment) ([]ai.Segment, error) {
	return segments, nil
}

func (p *integrationChatProvider) Chat(ctx context.Context, c ai.Config, source string, messages []ai.ChatMessage) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.chatCalls++
	p.lastSource = source
	return "answer", nil
}

func (p *integrationChatProvider) snapshot() (int, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.chatCalls, p.lastSource
}

// newIntegrationApp boots the full composition root with a fake AI provider.
func newIntegrationApp(t *testing.T, provider ai.Translator) *Application {
	t.Helper()
	root := t.TempDir()
	for name, value := range map[string]string{"TANGENTRY_DOWNLOAD_DIR": filepath.Join(root, "downloads"), "TANGENTRY_YTDLP_PATH": filepath.Join(root, "absent-tool"), "TANGENTRY_FFMPEG_PATH": filepath.Join(root, "absent-tool"), "TANGENTRY_BILIBILI_COOKIE_FILE": "", "TANGENTRY_BILIBILI_COOKIE": "", "TANGENTRY_PADDLEOCR_PATH": filepath.Join(root, "absent-tool"), "TANGENTRY_PADDLEOCR_MODEL": filepath.Join(root, "absent-model")} {
		t.Setenv(name, value)
	}
	application, err := New(root, fstest.MapFS{}, Options{AITranslator: provider})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = application.Close() })
	return application
}

// integrationJSON performs one JSON API call and returns the raw body.
func integrationJSON(t *testing.T, application *Application, method, path string, body any, wantStatus int) []byte {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	r := httptest.NewRequest(method, "http://127.0.0.1"+path, reader)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	application.HTTPHandler().ServeHTTP(w, r)
	if w.Code != wantStatus {
		t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, wantStatus, w.Body.String())
	}
	return w.Body.Bytes()
}

// configureIntegrationAI selects the fake chat model through the real
// settings endpoint and returns the current revision.
func configureIntegrationAI(t *testing.T, application *Application) int64 {
	t.Helper()
	integrationJSON(t, application, "PUT", "/api/ai/settings", map[string]any{
		"protocol": "compatible", "baseUrl": "https://ai-fixture.example/v1", "model": "fixture", "revision": 1,
	}, 200)
	var status struct {
		Revision int64 `json:"revision"`
	}
	if err := json.Unmarshal(integrationJSON(t, application, "GET", "/api/ai/settings", nil, 200), &status); err != nil {
		t.Fatal(err)
	}
	return status.Revision
}

// integrationPDF builds a minimal deterministic text-layer PDF (same shape
// as the pdftext adapter fixtures; ASCII keeps it font-independent).
func integrationPDF(t *testing.T, pageTexts []string) []byte {
	t.Helper()
	var buf bytes.Buffer
	offsets := []int{0}
	writeObj := func(num int, body string) {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", num, body)
	}
	buf.WriteString("%PDF-1.4\n")
	n := len(pageTexts)
	kids := make([]string, n)
	for i := 0; i < n; i++ {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	writeObj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	writeObj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i, text := range pageTexts {
		pageNum := 4 + 2*i
		contentNum := pageNum + 1
		writeObj(pageNum, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", contentNum))
		stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
		writeObj(contentNum, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
	}
	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", len(offsets))
	buf.WriteString("0000000000 65535 f \n")
	for _, off := range offsets[1:] {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xrefOffset)
	return buf.Bytes()
}

// uploadIntegrationPDF imports a PDF through the real multipart endpoint.
func uploadIntegrationPDF(t *testing.T, application *Application, pdf []byte) string {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	file, err := mw.CreateFormFile("file", "fixture.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(pdf); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1/api/documents", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	application.HTTPHandler().ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("document upload = %d: %s", w.Code, w.Body.String())
	}
	var item struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil || !strings.HasPrefix(item.ID, "pdf:") {
		t.Fatalf("uploaded item: %s (%v)", w.Body.String(), err)
	}
	return item.ID
}

// TestPDFImportExtractionRetrievalThroughApp: a newly imported text-layer
// PDF is extracted through the production save hook and yields verified
// passages in retrieval — import → extraction → retrieval, no test-only
// wiring.
func TestPDFImportExtractionRetrievalThroughApp(t *testing.T) {
	provider := &integrationChatProvider{}
	application := newIntegrationApp(t, provider)
	revision := configureIntegrationAI(t, application)
	contentID := uploadIntegrationPDF(t, application, integrationPDF(t, []string{
		"Background paragraph on page one.",
		"The secret answer is BANANA-42 on page two.",
	}))

	body := integrationJSON(t, application, "POST", "/api/ai/chat", map[string]any{
		"contentId": contentID, "revision": revision, "model": "fixture",
		"messages":  []map[string]string{{"role": "user", "content": "BANANA-42"}},
		"retrieval": map[string]any{"schemaVersion": 1, "enabled": true, "mode": "lexical"},
	}, 200)
	var result struct {
		Retrieval *struct {
			Status   string `json:"status"`
			Passages []struct {
				Source  string `json:"source"`
				Locator string `json:"locator"`
			} `json:"passages"`
		} `json:"retrieval"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || result.Retrieval.Status != "lexical_only" || len(result.Retrieval.Passages) == 0 {
		t.Fatalf("retrieval must read extracted PDF pages: %s", body)
	}
	foundAnswer := false
	for _, p := range result.Retrieval.Passages {
		if p.Source != "pdf" || !strings.HasPrefix(p.Locator, "pdf:") {
			t.Fatalf("passage provenance: %+v", p)
		}
		if strings.Contains(p.Locator, ":2:") {
			foundAnswer = true
		}
	}
	if !foundAnswer {
		t.Fatalf("answer page passage missing: %s", body)
	}
	calls, source := provider.snapshot()
	if calls != 1 || !strings.Contains(source, "BANANA-42") {
		t.Fatalf("chat calls=%d, provider source must contain the extracted page text: %q", calls, source)
	}

	// Re-importing the same document is idempotent: extraction reuses the
	// stored rows and retrieval keeps working.
	uploadIntegrationPDF(t, application, integrationPDF(t, []string{
		"Background paragraph on page one.",
		"The secret answer is BANANA-42 on page two.",
	}))
	integrationJSON(t, application, "POST", "/api/ai/chat", map[string]any{
		"contentId": contentID, "revision": revision, "model": "fixture",
		"messages":  []map[string]string{{"role": "user", "content": "BANANA-42"}},
		"retrieval": map[string]any{"schemaVersion": 1, "enabled": true, "mode": "lexical"},
	}, 200)
}

// integrationEmbeddingServer is a fake OpenAI-compatible embedding endpoint
// recording model identity, authorization and batch sizes for the
// settings-use tests.
type integrationEmbeddingServer struct {
	server   *httptest.Server
	mu       sync.Mutex
	requests int
	models   []string
	auths    []string
	batches  []int
}

func newIntegrationEmbeddingServer(t *testing.T) *integrationEmbeddingServer {
	t.Helper()
	s := &integrationEmbeddingServer{}
	s.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.mu.Lock()
		s.requests++
		s.models = append(s.models, body.Model)
		s.auths = append(s.auths, r.Header.Get("Authorization"))
		s.batches = append(s.batches, len(body.Input))
		s.mu.Unlock()
		data := make([]map[string]any, len(body.Input))
		for i := range body.Input {
			data[i] = map[string]any{"embedding": []float64{0.1, 0.2, 0.3, 0.4}, "index": i}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": data, "model": body.Model, "usage": map[string]any{"total_tokens": 10},
		})
	}))
	t.Cleanup(s.server.Close)
	return s
}

func (s *integrationEmbeddingServer) snapshot() (int, []string, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests, append([]string(nil), s.models...), append([]string(nil), s.auths...)
}

func (s *integrationEmbeddingServer) batchSizes() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]int(nil), s.batches...)
}

// TestRetrievalSettingsSaveReloadUseThroughApp: the settings panel contract
// end to end — save through the API, reload masked (no key in any response),
// and the live engine uses the new provider without a restart. Keys stay out
// of responses; an empty key on save keeps the stored one.
func TestRetrievalSettingsSaveReloadUseThroughApp(t *testing.T) {
	provider := &integrationChatProvider{}
	application := newIntegrationApp(t, provider)
	revision := configureIntegrationAI(t, application)
	contentID := uploadIntegrationPDF(t, application, integrationPDF(t, []string{
		"The secret answer is BANANA-42 on page one.",
	}))

	// Unsaved load returns the labelled local-first default, masked.
	defaults := integrationJSON(t, application, "GET", "/api/ai/retrieval/settings", nil, 200)
	var masked struct {
		ProviderKind string `json:"providerKind"`
		Model        string `json:"model"`
		HasKey       bool   `json:"hasKey"`
	}
	if err := json.Unmarshal(defaults, &masked); err != nil {
		t.Fatal(err)
	}
	if masked.ProviderKind != "local" || masked.Model != "bge-m3" || masked.HasKey {
		t.Fatalf("default settings: %s", defaults)
	}

	embeddings := newIntegrationEmbeddingServer(t)
	settings := map[string]any{
		"providerKind": "remote", "surface": "openai", "baseUrl": embeddings.server.URL,
		"apiKey": "integration-test-key", "model": "custom-embed-model", "dimensions": 4,
		"batchSize": 8, "textType": "", "instruct": "", "encodingFormat": "float",
		"timeoutMs": 5000, "topK": 100,
		"lexicalWeight": 0.35, "embeddingWeight": 0.65, "rerankWeight": 0,
		"maxEmbeddingRequests": 24, "maxEmbeddingChars": 100000, "maxRerankRequests": 0,
		"rerankProvider": "off", "rerankModel": "", "rerankBaseUrl": "", "rerankApiKey": "",
		"rerankTopN": 0, "rerankInstruct": "",
	}
	saved := integrationJSON(t, application, "PUT", "/api/ai/retrieval/settings", settings, 200)
	if strings.Contains(string(saved), "integration-test-key") {
		t.Fatalf("save response leaked the key: %s", saved)
	}
	if err := json.Unmarshal(saved, &masked); err != nil {
		t.Fatal(err)
	}
	if !masked.HasKey || masked.Model != "custom-embed-model" {
		t.Fatalf("masked save response: %s", saved)
	}

	// Reload persists the configuration (still masked).
	reloaded := integrationJSON(t, application, "GET", "/api/ai/retrieval/settings", nil, 200)
	if strings.Contains(string(reloaded), "integration-test-key") {
		t.Fatalf("reload response leaked the key: %s", reloaded)
	}
	if err := json.Unmarshal(reloaded, &masked); err != nil {
		t.Fatal(err)
	}
	if !masked.HasKey || masked.ProviderKind != "remote" || masked.Model != "custom-embed-model" {
		t.Fatalf("reloaded settings: %s", reloaded)
	}

	// An empty key keeps the stored one.
	settings["apiKey"] = ""
	integrationJSON(t, application, "PUT", "/api/ai/retrieval/settings", settings, 200)

	// The live engine uses the saved provider without a restart: the chat
	// retrieval run POSTs to the configured endpoint with the stored key.
	body := integrationJSON(t, application, "POST", "/api/ai/chat", map[string]any{
		"contentId": contentID, "revision": revision, "model": "fixture",
		"messages": []map[string]string{{"role": "user", "content": "BANANA-42"}},
		"retrieval": map[string]any{
			"schemaVersion": 1, "enabled": true, "mode": "hybrid",
			"embeddingBudget": map[string]any{"maxRequests": 24, "sweepCandidates": 90},
		},
	}, 200)
	var result struct {
		Retrieval *struct {
			Status    string `json:"status"`
			Passages  []any  `json:"passages"`
			Embedding struct {
				Model        string `json:"model"`
				BudgetStatus string `json:"budgetStatus"`
				Requests     int    `json:"requests"`
			} `json:"embedding"`
		} `json:"retrieval"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || len(result.Retrieval.Passages) == 0 {
		t.Fatalf("hybrid retrieval must return passages: %s", body)
	}
	if result.Retrieval.Embedding.Model != "custom-embed-model" || result.Retrieval.Embedding.Requests == 0 {
		t.Fatalf("engine must use the saved provider: %s", body)
	}
	requests, models, auths := embeddings.snapshot()
	if requests == 0 {
		t.Fatal("saved embedding endpoint was never called")
	}
	for i, model := range models {
		if model != "custom-embed-model" || auths[i] != "Bearer integration-test-key" {
			t.Fatalf("embedding request %d: model=%q auth=%q", i, model, auths[i])
		}
	}

	// Invalid settings are rejected before anything is written.
	settings["dimensions"] = 0
	invalid := integrationJSON(t, application, "PUT", "/api/ai/retrieval/settings", settings, 400)
	if !strings.Contains(string(invalid), "invalid_retrieval_settings") {
		t.Fatalf("invalid settings response: %s", invalid)
	}
	// The stored configuration is unchanged.
	reloaded = integrationJSON(t, application, "GET", "/api/ai/retrieval/settings", nil, 200)
	if err := json.Unmarshal(reloaded, &masked); err != nil {
		t.Fatal(err)
	}
	if masked.Model != "custom-embed-model" || !masked.HasKey {
		t.Fatalf("rejected save must not alter stored settings: %s", reloaded)
	}
}

// TestRetrievalSettingsLimitsAppliedThroughApp: the saved operational
// settings reach the actual chat invocation. Saving maxEmbeddingRequests=0
// prevents every embedding POST even though the ordinary frontend request
// supplies its own default 24 requests / 100000 chars; a non-default saved
// configuration (request cap, batch size, topK, char budget) is then used by
// the next chat without a restart.
func TestRetrievalSettingsLimitsAppliedThroughApp(t *testing.T) {
	provider := &integrationChatProvider{}
	application := newIntegrationApp(t, provider)
	revision := configureIntegrationAI(t, application)
	pages := make([]string, 6)
	for i := range pages {
		pages[i] = fmt.Sprintf("The secret answer is BANANA-42 on page %d.", i+1)
	}
	contentID := uploadIntegrationPDF(t, application, integrationPDF(t, pages))

	embeddings := newIntegrationEmbeddingServer(t)
	settings := map[string]any{
		"providerKind": "remote", "surface": "openai", "baseUrl": embeddings.server.URL,
		"apiKey": "integration-test-key", "model": "custom-embed-model", "dimensions": 4,
		"batchSize": 8, "textType": "", "instruct": "", "encodingFormat": "float",
		"timeoutMs": 5000, "topK": 100,
		"lexicalWeight": 0.35, "embeddingWeight": 0.65, "rerankWeight": 0,
		"maxEmbeddingRequests": 0, "maxEmbeddingChars": 100000, "maxRerankRequests": 0,
		"rerankProvider": "off", "rerankModel": "", "rerankBaseUrl": "", "rerankApiKey": "",
		"rerankTopN": 0, "rerankInstruct": "",
	}
	integrationJSON(t, application, "PUT", "/api/ai/retrieval/settings", settings, 200)

	// The ordinary UI request carries its own defaults (24/100000/90); the
	// saved zero must still prevent every embedding POST.
	chatBody := map[string]any{
		"contentId": contentID, "revision": revision, "model": "fixture",
		"messages": []map[string]string{{"role": "user", "content": "BANANA-42"}},
		"retrieval": map[string]any{
			"schemaVersion": 1, "enabled": true, "mode": "hybrid", "maxChars": 120000,
			"embeddingBudget": map[string]any{"batchingMode": "shared", "maxRequests": 24, "maxChars": 100000, "sweepCandidates": 90},
			"rerankBudget":    map[string]any{"maxRequests": 0},
		},
	}
	var result struct {
		Retrieval *struct {
			Status    string `json:"status"`
			Passages  []any  `json:"passages"`
			Embedding struct {
				Model        string `json:"model"`
				BudgetStatus string `json:"budgetStatus"`
				Requests     int    `json:"requests"`
			} `json:"embedding"`
		} `json:"retrieval"`
	}
	body := integrationJSON(t, application, "POST", "/api/ai/chat", chatBody, 200)
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || result.Retrieval.Status != "lexical_only" || len(result.Retrieval.Passages) == 0 {
		t.Fatalf("saved zero must keep lexical retrieval working: %s", body)
	}
	if result.Retrieval.Embedding.BudgetStatus != "disabled" || result.Retrieval.Embedding.Requests != 0 {
		t.Fatalf("saved zero must disable the embedding budget: %s", body)
	}
	if requests, _, _ := embeddings.snapshot(); requests != 0 {
		t.Fatalf("saved zero allowed %d embedding POSTs, want 0", requests)
	}

	// A non-default saved configuration is applied to the next chat: the
	// request cap 2 and batch size 2 beat the frontend's 24/8 defaults.
	settings["maxEmbeddingRequests"] = 2
	settings["batchSize"] = 2
	settings["topK"] = 20
	settings["maxEmbeddingChars"] = 50000
	integrationJSON(t, application, "PUT", "/api/ai/retrieval/settings", settings, 200)
	body = integrationJSON(t, application, "POST", "/api/ai/chat", chatBody, 200)
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || len(result.Retrieval.Passages) == 0 {
		t.Fatalf("hybrid retrieval must return passages: %s", body)
	}
	if result.Retrieval.Embedding.Model != "custom-embed-model" || result.Retrieval.Embedding.Requests != 2 {
		t.Fatalf("saved request cap must shape the run: %s", body)
	}
	requests, _, _ := embeddings.snapshot()
	if requests != 2 {
		t.Fatalf("saved request cap 2 must beat the frontend default 24: %d POSTs (%s)", requests, body)
	}
	for i, size := range embeddings.batchSizes() {
		if size > 2 {
			t.Fatalf("POST %d sent %d texts, saved batchSize is 2", i, size)
		}
	}
}

// TestPDFMixedBlankPagesRemainSearchable: a PDF with one blank page and one
// searchable text page imports through the real endpoint and stays
// retrievable even though no OCR runtime is installed (local OCR
// unavailable; cloud upload is never enabled). The usable native page text
// is preserved instead of being discarded with the blank page.
func TestPDFMixedBlankPagesRemainSearchable(t *testing.T) {
	provider := &integrationChatProvider{}
	application := newIntegrationApp(t, provider)
	revision := configureIntegrationAI(t, application)
	contentID := uploadIntegrationPDF(t, application, integrationPDF(t, []string{
		"",
		"The secret answer is BANANA-42 on page two.",
	}))

	body := integrationJSON(t, application, "POST", "/api/ai/chat", map[string]any{
		"contentId": contentID, "revision": revision, "model": "fixture",
		"messages":  []map[string]string{{"role": "user", "content": "BANANA-42"}},
		"retrieval": map[string]any{"schemaVersion": 1, "enabled": true, "mode": "lexical"},
	}, 200)
	var result struct {
		Retrieval *struct {
			Status   string `json:"status"`
			Passages []struct {
				Source  string `json:"source"`
				Locator string `json:"locator"`
			} `json:"passages"`
		} `json:"retrieval"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || result.Retrieval.Status != "lexical_only" || len(result.Retrieval.Passages) == 0 {
		t.Fatalf("mixed blank/text PDF must remain searchable: %s", body)
	}
	foundAnswer := false
	for _, p := range result.Retrieval.Passages {
		if p.Source != "pdf" || !strings.HasPrefix(p.Locator, "pdf:") {
			t.Fatalf("passage provenance: %+v", p)
		}
		if strings.Contains(p.Locator, ":2:") {
			foundAnswer = true
		}
	}
	if !foundAnswer {
		t.Fatalf("text page passage missing: %s", body)
	}
	calls, source := provider.snapshot()
	if calls != 1 || !strings.Contains(source, "BANANA-42") {
		t.Fatalf("chat calls=%d, provider source must contain the preserved page text: %q", calls, source)
	}
}
