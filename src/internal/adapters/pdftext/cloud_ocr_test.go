package pdftext

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testToken = "test-token-DO-NOT-LOG-12345"

// cloudFake is a fake PaddleOCR job API: submit → poll pending/running/done
// → JSONL download. It counts requests and records the Authorization header.
type cloudFake struct {
	server       *httptest.Server
	requests     int32
	authSeen     string
	polls        int32
	pendingN     int32 // number of pending polls before done
	failJob      bool
	alwaysPend   bool
	jsonl        string
	submitStatus int
	submitBody   string
}

func newCloudFake(t *testing.T, jsonl string) *cloudFake {
	t.Helper()
	f := &cloudFake{jsonl: jsonl, pendingN: 2, submitStatus: 200}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v2/ocr/jobs", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.requests, 1)
		f.authSeen = r.Header.Get("Authorization")
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			w.WriteHeader(400)
			return
		}
		if f.submitStatus != 200 {
			w.WriteHeader(f.submitStatus)
			fmt.Fprint(w, f.submitBody)
			return
		}
		fmt.Fprint(w, `{"jobId":"job-42"}`)
	})
	mux.HandleFunc("/api/v2/ocr/jobs/job-42", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.requests, 1)
		n := atomic.AddInt32(&f.polls, 1)
		switch {
		case f.failJob:
			fmt.Fprint(w, `{"state":"failed"}`)
		case f.alwaysPend:
			fmt.Fprint(w, `{"state":"pending"}`)
		case n <= f.pendingN:
			fmt.Fprint(w, `{"state":"pending"}`)
		case n == f.pendingN+1:
			fmt.Fprint(w, `{"state":"running"}`)
		default:
			fmt.Fprintf(w, `{"state":"done","resultUrl":{"jsonUrl":%q}}`, f.server.URL+"/result.jsonl")
		}
	})
	mux.HandleFunc("/result.jsonl", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&f.requests, 1)
		fmt.Fprint(w, f.jsonl)
	})
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

func (f *cloudFake) cfg() CloudOCRConfig {
	return CloudOCRConfig{
		Endpoint:       f.server.URL + "/api/v2/ocr/jobs",
		Token:          testToken,
		ModelID:        "PaddleOCR-VL-1.6",
		PollIntervalMs: 10,
		TimeoutMs:      2000,
	}
}

func enabledCloud(f *cloudFake) *CloudOCR {
	return &CloudOCR{Cfg: f.cfg(), Client: f.server.Client(), FeatureEnabled: true, ConsentVersion: "v1", ConsentAt: 1700000000}
}

const twoPageJSONL = `{"result":{"layoutParsingResults":[{"markdown":{"text":"云端第一页"}},{"markdown":{"text":"补充块"}}]}}
{"result":{"layoutParsingResults":[{"markdown":{"text":"云端第二页"}}]}}
`

// TestBT34_CloudJobFlow: explicit cloud fake job API submit → poll
// pending/running → done → JSONL download → per-page markdown text; token
// sent in the header; job provenance returned.
func TestBT34_CloudJobFlow(t *testing.T) {
	f := newCloudFake(t, twoPageJSONL)
	ocr := enabledCloud(f)
	if !ocr.Available(context.Background()) {
		t.Fatal("enabled+consented cloud must be available")
	}
	path := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4 fake"), 0600); err != nil {
		t.Fatal(err)
	}
	res, err := ocr.Recognize(context.Background(), path, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Pages) != 2 || res.Pages[0].Text != "云端第一页\n补充块" || res.Pages[1].Text != "云端第二页" {
		t.Fatalf("pages: %+v", res.Pages)
	}
	if res.JobID != "job-42" || res.State != "done" {
		t.Fatalf("provenance: %+v", res)
	}
	if !strings.Contains(f.authSeen, testToken) {
		t.Fatal("token must be sent in the Authorization header")
	}
	if atomic.LoadInt32(&f.polls) < 3 {
		t.Fatal("poll must traverse pending/running/done")
	}
}

// TestBT34_CloudFailures: failed job, bounded timeout, page-count mismatch
// and download failure are explicit errors; no fabricated text.
func TestBT34_CloudFailures(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4 fake"), 0600); err != nil {
		t.Fatal(err)
	}

	// Failed job state.
	f1 := newCloudFake(t, twoPageJSONL)
	f1.failJob = true
	if _, err := enabledCloud(f1).Recognize(ctx, path, 2); err == nil {
		t.Fatal("failed job must error")
	}

	// Bounded polling timeout (always pending).
	f2 := newCloudFake(t, twoPageJSONL)
	f2.alwaysPend = true
	cfg := f2.cfg()
	cfg.TimeoutMs = 100
	ocr2 := &CloudOCR{Cfg: cfg, Client: f2.server.Client(), FeatureEnabled: true, ConsentVersion: "v1", ConsentAt: 1}
	start := time.Now()
	if _, err := ocr2.Recognize(ctx, path, 2); err == nil {
		t.Fatal("timeout must error")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("polling must be bounded")
	}

	// Page-count mismatch (1 JSONL line vs 2 expected).
	f3 := newCloudFake(t, `{"result":{"layoutParsingResults":[{"markdown":{"text":"only one"}}]}}`)
	if _, err := enabledCloud(f3).Recognize(ctx, path, 2); err == nil {
		t.Fatal("page-count mismatch must error")
	}

	// Malformed JSONL.
	f4 := newCloudFake(t, "not json\n")
	if _, err := enabledCloud(f4).Recognize(ctx, path, 1); err == nil {
		t.Fatal("malformed JSONL must error")
	}
}

// TestBT34_TokenRedaction: provider error bodies are redacted; the token
// never appears in returned errors.
func TestBT34_TokenRedaction(t *testing.T) {
	f := newCloudFake(t, twoPageJSONL)
	f.submitStatus = 403
	f.submitBody = `{"error":"forbidden","token":"` + testToken + `","secret":"leaked-body"}`
	ocr := enabledCloud(f)
	path := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4 fake"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := ocr.Recognize(context.Background(), path, 2)
	if err == nil {
		t.Fatal("403 must error")
	}
	msg := err.Error()
	if strings.Contains(msg, testToken) || strings.Contains(msg, "leaked-body") {
		t.Fatalf("error body/token not redacted: %q", msg)
	}
}

// TestBT37_CloudGuards: without the feature flag or consent, Recognize makes
// zero network requests (no upload, no token access).
func TestBT37_CloudGuards(t *testing.T) {
	f := newCloudFake(t, twoPageJSONL)
	path := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(path, []byte("%PDF-1.4 fake"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Feature flag off (default).
	off := &CloudOCR{Cfg: f.cfg(), Client: f.server.Client(), ConsentVersion: "v1", ConsentAt: 1}
	if off.Available(ctx) {
		t.Fatal("cloud must be off by default")
	}
	if _, err := off.Recognize(ctx, path, 2); err == nil {
		t.Fatal("disabled cloud must refuse")
	}
	// Consent missing.
	noConsent := &CloudOCR{Cfg: f.cfg(), Client: f.server.Client(), FeatureEnabled: true}
	if _, err := noConsent.Recognize(ctx, path, 2); err == nil {
		t.Fatal("unconsented cloud must refuse")
	}
	// Token missing.
	noToken := enabledCloud(f)
	noToken.Cfg.Token = ""
	if _, err := noToken.Recognize(ctx, path, 2); err == nil {
		t.Fatal("tokenless cloud must refuse")
	}
	if atomic.LoadInt32(&f.requests) != 0 {
		t.Fatalf("guards must make zero requests, got %d", f.requests)
	}
}
