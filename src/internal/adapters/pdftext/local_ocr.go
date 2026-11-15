package pdftext

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"

	"tangentry/internal/retrieval"
)

// DefaultLocalOCRModel is the recommended model ID (user-editable; never
// silently downloaded).
const DefaultLocalOCRModel = "PaddleOCR-VL-1.6"

// LocalOCRConfig points at the user-installed PaddleOCR runtime and model.
// No token and no network are involved; the PDF never leaves the device.
type LocalOCRConfig struct {
	RuntimePath string
	ModelPath   string
	ModelID     string
	TimeoutMs   int64
}

// CommandRunner abstracts process execution so tests use a fake runtime.
type CommandRunner interface {
	Run(ctx context.Context, name string, args ...string) ([]byte, error)
}

// ExecRunner runs the real user-installed runtime.
type ExecRunner struct{}

// Run executes the command and returns stdout.
func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).Output()
}

// LocalOCR invokes the user-installed PaddleOCR runtime. Contract: the
// runtime is called as `<runtime> --model <modelPath> --input <pdfPath>` and
// writes `{"pages":[{"page":1,"text":"..."}]}` to stdout, one entry per
// requested page in order. Missing runtime/model → unavailable (the service
// reports pdf_ocr_unavailable); no silent cloud fallback exists.
type LocalOCR struct {
	Cfg    LocalOCRConfig
	Runner CommandRunner
}

// Name implements retrieval.OCRProvider.
func (l *LocalOCR) Name() string { return "local-paddleocr" }

// Version implements retrieval.OCRProvider.
func (l *LocalOCR) Version() string {
	if l.Cfg.ModelID != "" {
		return l.Cfg.ModelID
	}
	return DefaultLocalOCRModel
}

// Available reports whether the user-installed runtime and model exist.
func (l *LocalOCR) Available(ctx context.Context) bool {
	if l.Cfg.RuntimePath == "" || l.Cfg.ModelPath == "" || l.Runner == nil {
		return false
	}
	if _, err := os.Stat(l.Cfg.RuntimePath); err != nil {
		return false
	}
	if _, err := os.Stat(l.Cfg.ModelPath); err != nil {
		return false
	}
	return true
}

// Recognize runs the local runtime and validates the page count.
func (l *LocalOCR) Recognize(ctx context.Context, path string, expectedPages int) (retrieval.OCRResult, error) {
	if !l.Available(ctx) {
		return retrieval.OCRResult{}, fmt.Errorf("local OCR runtime/model unavailable")
	}
	timeout := time.Duration(l.Cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	if timeout > 10*time.Minute {
		timeout = 10 * time.Minute
	}
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := l.Runner.Run(rctx, l.Cfg.RuntimePath, "--model", l.Cfg.ModelPath, "--input", path)
	if err != nil {
		return retrieval.OCRResult{}, fmt.Errorf("local OCR runtime failed: %w", err)
	}
	var parsed struct {
		Pages []struct {
			Page int    `json:"page"`
			Text string `json:"text"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return retrieval.OCRResult{}, fmt.Errorf("local OCR output invalid")
	}
	if len(parsed.Pages) != expectedPages {
		return retrieval.OCRResult{}, fmt.Errorf("local OCR page-count mismatch: got %d, want %d", len(parsed.Pages), expectedPages)
	}
	res := retrieval.OCRResult{State: "done", Pages: make([]retrieval.OCRPage, 0, expectedPages)}
	for i, p := range parsed.Pages {
		if p.Page != i+1 {
			return retrieval.OCRResult{}, fmt.Errorf("local OCR page order invalid")
		}
		res.Pages = append(res.Pages, retrieval.OCRPage{Number: p.Page, Text: p.Text})
	}
	return res, nil
}

var _ retrieval.OCRProvider = (*LocalOCR)(nil)
