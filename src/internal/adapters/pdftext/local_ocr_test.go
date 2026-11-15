package pdftext

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	out   []byte
	err   error
	calls int
	name  string
	args  []string
}

func (f *fakeRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	f.calls++
	f.name, f.args = name, args
	return f.out, f.err
}

// TestBT34_LocalOCR: default local fake runtime, no cloud/token; success
// parses per-page text; missing runtime/model is unavailable; crash is an
// error; page-count mismatch is rejected. No network, no token.
func TestBT34_LocalOCR(t *testing.T) {
	dir := t.TempDir()
	runtime := filepath.Join(dir, "paddleocr")
	model := filepath.Join(dir, "model")
	if err := os.WriteFile(runtime, []byte("#!/bin/sh\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(model, []byte("model"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Success: runtime JSON output parsed into pages.
	runner := &fakeRunner{out: []byte(`{"pages":[{"page":1,"text":"OCR 第一页"},{"page":2,"text":"OCR 第二页"}]}`)}
	ocr := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: runtime, ModelPath: model, ModelID: "PaddleOCR-VL-1.6"}, Runner: runner}
	if !ocr.Available(ctx) {
		t.Fatal("configured runtime must be available")
	}
	res, err := ocr.Recognize(ctx, "/tmp/doc.pdf", 2)
	if err != nil || len(res.Pages) != 2 || res.Pages[0].Text != "OCR 第一页" {
		t.Fatalf("recognize: %+v %v", res, err)
	}
	if runner.name != runtime {
		t.Fatalf("runtime not invoked: %q", runner.name)
	}
	// The model path is passed; no token argument exists.
	joined := strings.Join(runner.args, " ")
	if !strings.Contains(joined, model) || strings.Contains(strings.ToLower(joined), "token") {
		t.Fatalf("args must carry the model and no token: %v", runner.args)
	}
	if ocr.Name() != "local-paddleocr" || ocr.Version() != "PaddleOCR-VL-1.6" {
		t.Fatalf("provenance: %s %s", ocr.Name(), ocr.Version())
	}

	// Missing runtime → unavailable (service maps to pdf_ocr_unavailable).
	missing := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: filepath.Join(dir, "absent"), ModelPath: model}, Runner: runner}
	if missing.Available(ctx) {
		t.Fatal("absent runtime must be unavailable")
	}
	// Missing model → unavailable.
	missingModel := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: runtime, ModelPath: filepath.Join(dir, "absent-model")}, Runner: runner}
	if missingModel.Available(ctx) {
		t.Fatal("absent model must be unavailable")
	}
	// Empty config → unavailable (default install state).
	if (&LocalOCR{}).Available(ctx) {
		t.Fatal("unconfigured local OCR must be unavailable")
	}

	// Runtime crash → error, no fabricated text.
	crash := &fakeRunner{err: fmt.Errorf("exit status 1")}
	ocrCrash := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: runtime, ModelPath: model}, Runner: crash}
	if _, err := ocrCrash.Recognize(ctx, "/tmp/doc.pdf", 2); err == nil {
		t.Fatal("crash must fail")
	}

	// Page-count mismatch → error.
	short := &fakeRunner{out: []byte(`{"pages":[{"page":1,"text":"only one"}]}`)}
	ocrShort := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: runtime, ModelPath: model}, Runner: short}
	if _, err := ocrShort.Recognize(ctx, "/tmp/doc.pdf", 2); err == nil {
		t.Fatal("page-count mismatch must fail")
	}

	// Malformed JSON → error.
	bad := &fakeRunner{out: []byte(`not json`)}
	ocrBad := &LocalOCR{Cfg: LocalOCRConfig{RuntimePath: runtime, ModelPath: model}, Runner: bad}
	if _, err := ocrBad.Recognize(ctx, "/tmp/doc.pdf", 1); err == nil {
		t.Fatal("malformed output must fail")
	}
}
