package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tangentry/internal/ai"
	"tangentry/internal/retrieval"
)

// fakeRetrievalAI overrides only Chat/ChatStream; the embedded interface
// satisfies AIService for the handler (other methods are never called here).
type fakeRetrievalAI struct {
	AIService
	result ai.ChatResult
	err    error
}

func (f *fakeRetrievalAI) Chat(ctx context.Context, in ai.ChatRequest) (ai.ChatResult, error) {
	return f.result, f.err
}
func (f *fakeRetrievalAI) ChatStream(ctx context.Context, in ai.ChatRequest, emit func(string) error) (ai.ChatResult, error) {
	return f.result, f.err
}

func retrievalChatRequest(t *testing.T) *http.Request {
	t.Helper()
	body := `{"contentId":"rss:x","revision":1,"messages":[{"role":"user","content":"问题"}],"retrieval":{"schemaVersion":1,"enabled":true,"mode":"lexical"}}`
	r := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	return r
}

// TestBT25_HTTPStatusMapping: each terminal retrieval status maps to a
// distinct HTTP status, code and copy, carries the retrieval object, and is
// never a generic provider error.
func TestBT25_HTTPStatusMapping(t *testing.T) {
	cases := []struct {
		status string
		http   int
	}{
		{"invalid_budget", 400},
		{"context_budget_exceeded", 400},
		{"no_match", 200},
		{"no_verified_passages", 200},
		{"stale_source", 409},
		{"pdf_no_text", 200},
		{"pdf_ocr_unavailable", 200},
		{"pdf_extracting", 202},
		{"pdf_extract_failed", 200},
		{"source_unverified", 200},
		{"empty", 400},
		{"invalid_input", 400},
	}
	for _, tc := range cases {
		t.Run(tc.status, func(t *testing.T) {
			resp := &retrieval.Response{SchemaVersion: 1, Status: tc.status}
			fake := &fakeRetrievalAI{result: ai.ChatResult{ContentID: "rss:x", Retrieval: resp}, err: retrieval.StatusError{Status: tc.status}}
			h := &aiHandler{ai: AIDependencies{AI: fake}}
			w := httptest.NewRecorder()
			h.aiChat(w, retrievalChatRequest(t))
			if w.Code != tc.http {
				t.Fatalf("HTTP = %d, want %d", w.Code, tc.http)
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["code"] != "retrieval_"+tc.status {
				t.Fatalf("code = %v, want retrieval_%s", body["code"], tc.status)
			}
			if body["status"] != tc.status {
				t.Fatalf("status = %v", body["status"])
			}
			if body["retrieval"] == nil {
				t.Fatal("retrieval object missing")
			}
			if body["code"] == "ai_chat_failed" {
				t.Fatal("must not be a generic provider error")
			}
			if msg, _ := body["message"].(string); msg == "" {
				t.Fatal("distinct copy missing")
			}
		})
	}
}

// TestBT25_SSENoDoneOnRejection: a rejected retrieval assembly emits a
// terminal data frame with the distinct status and never event: done.
func TestBT25_SSENoDoneOnRejection(t *testing.T) {
	for _, status := range []string{"invalid_budget", "context_budget_exceeded", "no_match", "no_verified_passages"} {
		t.Run(status, func(t *testing.T) {
			resp := &retrieval.Response{SchemaVersion: 1, Status: status}
			fake := &fakeRetrievalAI{result: ai.ChatResult{ContentID: "rss:x", Retrieval: resp}, err: retrieval.StatusError{Status: status}}
			h := &aiHandler{ai: AIDependencies{AI: fake}}
			r := retrievalChatRequest(t)
			r.Header.Set("Accept", "text/event-stream")
			w := httptest.NewRecorder()
			h.aiChat(w, r)
			out := w.Body.String()
			if strings.Contains(out, "event: done") {
				t.Fatalf("rejected assembly must not emit event: done:\n%s", out)
			}
			if !strings.Contains(out, "retrieval_"+status) {
				t.Fatalf("terminal frame must carry the distinct status:\n%s", out)
			}
			if !strings.Contains(out, "\"status\":\""+status+"\"") {
				t.Fatalf("terminal status missing:\n%s", out)
			}
		})
	}
}

// TestBT25_SweepLimitedNotNoMatch: semantic_sweep_limited is a successful
// outcome (chat runs) rendered with its own status, never as no_match, and
// valid passages are not suppressed.
func TestBT25_SweepLimitedNotNoMatch(t *testing.T) {
	resp := &retrieval.Response{
		SchemaVersion: 1, Status: "semantic_sweep_limited", Mode: "hybrid",
		Passages: []retrieval.PassageRef{{PassageID: "rss:x#article:0:s0:0-5", ContentID: "rss:x", Source: "article"}},
	}
	fake := &fakeRetrievalAI{result: ai.ChatResult{ContentID: "rss:x", Retrieval: resp}, err: nil}
	h := &aiHandler{ai: AIDependencies{AI: fake}}
	w := httptest.NewRecorder()
	h.aiChat(w, retrievalChatRequest(t))
	if w.Code != 200 {
		t.Fatalf("HTTP = %d, want 200", w.Code)
	}
	var result ai.ChatResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Retrieval == nil || result.Retrieval.Status != "semantic_sweep_limited" {
		t.Fatalf("status = %+v, want semantic_sweep_limited", result.Retrieval)
	}
	if result.Retrieval.Status == "no_match" {
		t.Fatal("semantic_sweep_limited must never render as no_match")
	}
	if len(result.Retrieval.Passages) != 1 {
		t.Fatal("valid passages must not be suppressed")
	}
}

// TestBT25_UnknownFieldRejected: the retrieval object participates in the
// strict decoder; an unknown field is rejected on the request side.
func TestBT25_UnknownFieldRejected(t *testing.T) {
	fake := &fakeRetrievalAI{result: ai.ChatResult{ContentID: "rss:x"}}
	h := &aiHandler{ai: AIDependencies{AI: fake}}
	body := `{"contentId":"rss:x","revision":1,"messages":[{"role":"user","content":"q"}],"retrieval":{"enabled":true,"bogusField":1}}`
	r := httptest.NewRequest(http.MethodPost, "/api/ai/chat", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.aiChat(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown retrieval field must be rejected, got %d", w.Code)
	}
}
