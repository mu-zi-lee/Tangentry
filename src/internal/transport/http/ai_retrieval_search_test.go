package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

// fakeRetrievalSearch records the decoded RunInput for boundary assertions.
// It stands in for *retrieval.Engine, which satisfies the port directly.
type fakeRetrievalSearch struct {
	result   retrieval.RunResult
	err      error
	gotInput retrieval.RunInput
	calls    int
}

func (f *fakeRetrievalSearch) Run(ctx context.Context, in retrieval.RunInput) (retrieval.RunResult, error) {
	f.calls++
	f.gotInput = in
	return f.result, f.err
}

func retrievalSearchRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/ai/retrieval/search", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func searchPassage() retrieval.Passage {
	return retrieval.Passage{
		ID: "article:12:s3", ContentID: "article:12", Source: retrieval.SourceArticle,
		Locator: "article:12:s3", SentenceStart: 3, SentenceEnd: 4,
		StartRune: 120, EndRune: 180, Text: "命中的原文片段。",
		Score: 0.82, LexicalScore: 0.6, CosineScore: 0.9,
		SourceVersion: "1", TextSHA256: "fixture-hash",
	}
}

// TestRetrievalSearchBoundary: the standalone workbench endpoint runs B's
// pipeline without any chat provider, returns the wire object plus the
// passage text/scores the UI needs, and never invents a generic provider error.
func TestRetrievalSearchBoundary(t *testing.T) {
	p := searchPassage()
	fake := &fakeRetrievalSearch{result: retrieval.RunResult{
		Response: retrieval.Response{
			SchemaVersion: retrieval.WireSchemaVersion, Status: string(retrieval.SelectionOK),
			Mode: retrieval.ModeHybrid, Passages: []retrieval.PassageRef{retrieval.RefFromPassage(p)},
		},
		Context:  "组装后的上下文",
		Passages: []retrieval.Passage{p},
	}}
	h := &aiHandler{ai: AIDependencies{Retrieval: fake}} // AI intentionally nil

	w := httptest.NewRecorder()
	h.retrievalSearchPost(w, retrievalSearchRequest(t, `{"contentId":"article:12","question":"中段的答案是什么"}`))
	if w.Code != 200 {
		t.Fatalf("search = %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Retrieval    retrieval.Response `json:"retrieval"`
		ContextChars int                `json:"contextChars"`
		Passages     []struct {
			retrieval.PassageRef
			Text         string  `json:"text"`
			Score        float64 `json:"score"`
			LexicalScore float64 `json:"lexicalScore"`
			CosineScore  float64 `json:"cosineScore"`
		} `json:"passages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Retrieval.Status != string(retrieval.SelectionOK) {
		t.Fatalf("status = %q", body.Retrieval.Status)
	}
	if len(body.Passages) != 1 {
		t.Fatalf("passages = %d", len(body.Passages))
	}
	got := body.Passages[0]
	if got.Text != p.Text || got.Locator != p.Locator || got.TextSHA256 != p.TextSHA256 {
		t.Fatalf("passage lost verifiable fields: %+v", got)
	}
	if got.Score != p.Score || got.LexicalScore != p.LexicalScore || got.CosineScore != p.CosineScore {
		t.Fatalf("passage lost scores: %+v", got)
	}
	if body.ContextChars != len([]rune("组装后的上下文")) {
		t.Fatalf("contextChars = %d", body.ContextChars)
	}
	if fake.gotInput.ContentID != "article:12" || fake.gotInput.Question != "中段的答案是什么" {
		t.Fatalf("engine input = %+v", fake.gotInput)
	}
	// The workbench always runs retrieval; it must not depend on Enabled.
	if !fake.gotInput.Request.Enabled {
		t.Fatalf("request fragment not enabled: %+v", fake.gotInput.Request)
	}
}

// TestRetrievalSearchRequestFragment: an explicit fragment is forwarded so the
// workbench can tighten budgets, and omitted fields keep the domain defaults.
func TestRetrievalSearchRequestFragment(t *testing.T) {
	fake := &fakeRetrievalSearch{result: retrieval.RunResult{
		Response: retrieval.Response{SchemaVersion: retrieval.WireSchemaVersion, Status: string(retrieval.SelectionOK)},
	}}
	h := &aiHandler{ai: AIDependencies{Retrieval: fake}}
	w := httptest.NewRecorder()
	h.retrievalSearchPost(w, retrievalSearchRequest(t,
		`{"contentId":"article:12","question":"q","retrieval":{"mode":"lexical","maxChars":8000}}`))
	if w.Code != 200 {
		t.Fatalf("search = %d: %s", w.Code, w.Body.String())
	}
	if fake.gotInput.Request.Mode != retrieval.ModeLexical || fake.gotInput.Request.MaxChars != 8000 {
		t.Fatalf("fragment not forwarded: %+v", fake.gotInput.Request)
	}
	if fake.gotInput.Request.SchemaVersion != retrieval.WireSchemaVersion {
		t.Fatalf("schemaVersion = %d", fake.gotInput.Request.SchemaVersion)
	}
}

// TestRetrievalSearchStatusMapping: each rejection keeps B's distinct HTTP
// status/code/copy and still carries the retrieval object (B-T25 parity).
func TestRetrievalSearchStatusMapping(t *testing.T) {
	for _, status := range []string{
		string(retrieval.SelectionNoMatch),
		string(retrieval.SelectionStaleSource),
		string(retrieval.SelectionInvalidBudget),
		string(retrieval.SelectionEmpty),
		string(retrieval.SelectionPDFExtracting),
		string(retrieval.SelectionPDFOCRUnavailable),
	} {
		t.Run(status, func(t *testing.T) {
			resp := retrieval.Response{SchemaVersion: retrieval.WireSchemaVersion, Status: status}
			fake := &fakeRetrievalSearch{
				result: retrieval.RunResult{Response: resp},
				err:    retrieval.StatusError{Status: status},
			}
			h := &aiHandler{ai: AIDependencies{Retrieval: fake}}
			w := httptest.NewRecorder()
			h.retrievalSearchPost(w, retrievalSearchRequest(t, `{"contentId":"article:12","question":"q"}`))
			if w.Code != retrievalHTTPStatus(status) {
				t.Fatalf("%s = %d, want %d", status, w.Code, retrievalHTTPStatus(status))
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if body["code"] != retrievalStatusCode(status) {
				t.Fatalf("code = %v", body["code"])
			}
			if body["message"] != retrievalStatusMessage(status) {
				t.Fatalf("message = %v", body["message"])
			}
			if body["retrieval"] == nil {
				t.Fatalf("missing retrieval object: %s", w.Body.String())
			}
		})
	}
}

// TestRetrievalSearchGuards: unavailable service, missing content, malformed
// bodies and unexpected query parameters are rejected before any engine work.
func TestRetrievalSearchGuards(t *testing.T) {
	fake := &fakeRetrievalSearch{}
	h := &aiHandler{ai: AIDependencies{Retrieval: fake}}

	cases := []struct {
		name, body string
		want       int
	}{
		{"missing content", `{"question":"q"}`, 400},
		{"blank content", `{"contentId":"   ","question":"q"}`, 400},
		{"unknown field", `{"contentId":"article:12","question":"q","bogus":1}`, 400},
		{"unknown retrieval field", `{"contentId":"article:12","question":"q","retrieval":{"bogus":1}}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.retrievalSearchPost(w, retrievalSearchRequest(t, tc.body))
			if w.Code != tc.want {
				t.Fatalf("%s = %d: %s", tc.name, w.Code, w.Body.String())
			}
			if fake.calls != 0 {
				t.Fatalf("engine ran %d times on a rejected request", fake.calls)
			}
		})
	}

	t.Run("unavailable", func(t *testing.T) {
		empty := &aiHandler{ai: AIDependencies{}}
		w := httptest.NewRecorder()
		empty.retrievalSearchPost(w, retrievalSearchRequest(t, `{"contentId":"article:12","question":"q"}`))
		if w.Code != 503 {
			t.Fatalf("unavailable = %d", w.Code)
		}
	})

	t.Run("json required", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/ai/retrieval/search", strings.NewReader(`{}`))
		w := httptest.NewRecorder()
		h.retrievalSearchPost(w, r)
		if w.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("content-type = %d", w.Code)
		}
	})

	t.Run("unexpected query", func(t *testing.T) {
		r := retrievalSearchRequest(t, `{"contentId":"article:12","question":"q"}`)
		r.URL.RawQuery = "x=1"
		w := httptest.NewRecorder()
		h.retrievalSearchPost(w, r)
		if w.Code != 400 {
			t.Fatalf("query = %d", w.Code)
		}
	})
}

// TestRetrievalSearchRouteRegistered: the endpoint is reachable through the
// real mux, so the workbench does not rely on an unregistered handler.
func TestRetrievalSearchRouteRegistered(t *testing.T) {
	fake := &fakeRetrievalSearch{result: retrieval.RunResult{
		Response: retrieval.Response{SchemaVersion: retrieval.WireSchemaVersion, Status: string(retrieval.SelectionOK)},
	}}
	h := NewWithDependencies(Dependencies{AI: AIDependencies{Retrieval: fake}}, nil)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/ai/retrieval/search",
		strings.NewReader(`{"contentId":"article:12","question":"q"}`))
	r.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("routed search = %d: %s", w.Code, w.Body.String())
	}
	if fake.calls != 1 {
		t.Fatalf("engine calls = %d", fake.calls)
	}
}
