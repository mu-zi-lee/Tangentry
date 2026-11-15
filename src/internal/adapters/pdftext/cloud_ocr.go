package pdftext

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tangentry/internal/retrieval"
)

// DefaultCloudOCREndpoint is the documented PaddleOCR cloud job endpoint.
const DefaultCloudOCREndpoint = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"

// CloudOCRConfig configures the explicit opt-in cloud job adapter. The token
// comes from local settings or the environment; it is never logged, returned
// or committed, and error bodies are redacted.
type CloudOCRConfig struct {
	Endpoint                  string
	Token                     string
	ModelID                   string
	PollIntervalMs            int64
	TimeoutMs                 int64
	UseDocOrientationClassify bool
	UseDocUnwarping           bool
	UseChartRecognition       bool
}

// CloudOCR submits a PDF to the PaddleOCR job API, polls with bounded
// backoff, downloads resultUrl.jsonUrl and parses
// result.layoutParsingResults[].markdown.text per page. It is feature-flagged
// off by default pending legal/terms review and requires recorded consent
// (ocrCloudConsentVersion/timestamp); it never runs as a silent fallback.
type CloudOCR struct {
	Cfg            CloudOCRConfig
	Client         *http.Client
	FeatureEnabled bool
	ConsentVersion string
	ConsentAt      int64
}

// Name implements retrieval.OCRProvider.
func (c *CloudOCR) Name() string { return "paddleocr-cloud" }

// Version implements retrieval.OCRProvider.
func (c *CloudOCR) Version() string {
	if c.Cfg.ModelID != "" {
		return c.Cfg.ModelID
	}
	return DefaultLocalOCRModel
}

// Available requires the feature flag, recorded consent, token and endpoint.
func (c *CloudOCR) Available(ctx context.Context) bool {
	return c.FeatureEnabled && c.ConsentVersion != "" && c.ConsentAt > 0 &&
		c.Cfg.Token != "" && c.Cfg.Endpoint != ""
}

// Recognize runs submit → poll → download → parse. Every failure is an
// explicit, redacted error; no page text is fabricated.
func (c *CloudOCR) Recognize(ctx context.Context, path string, expectedPages int) (retrieval.OCRResult, error) {
	if !c.Available(ctx) {
		return retrieval.OCRResult{}, fmt.Errorf("cloud OCR disabled: requires explicit enablement, consent and token")
	}
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	jobID, err := c.submit(ctx, client, path)
	if err != nil {
		return retrieval.OCRResult{}, err
	}
	jsonURL, err := c.poll(ctx, client, jobID)
	if err != nil {
		return retrieval.OCRResult{}, err
	}
	pages, err := c.download(ctx, client, jsonURL, expectedPages)
	if err != nil {
		return retrieval.OCRResult{}, err
	}
	return retrieval.OCRResult{Pages: pages, JobID: jobID, State: "done"}, nil
}

func (c *CloudOCR) submit(ctx context.Context, client *http.Client, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("cloud OCR: cannot read PDF")
	}
	defer f.Close()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", fmt.Errorf("cloud OCR: multipart setup failed")
	}
	if _, err := io.Copy(part, f); err != nil {
		return "", fmt.Errorf("cloud OCR: multipart copy failed")
	}
	model := c.Cfg.ModelID
	if model == "" {
		model = DefaultLocalOCRModel
	}
	_ = w.WriteField("model", model)
	for name, val := range map[string]bool{
		"useDocOrientationClassify": c.Cfg.UseDocOrientationClassify,
		"useDocUnwarping":           c.Cfg.UseDocUnwarping,
		"useChartRecognition":       c.Cfg.UseChartRecognition,
	} {
		_ = w.WriteField(name, fmt.Sprintf("%t", val))
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("cloud OCR: multipart finalize failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Cfg.Endpoint, &body)
	if err != nil {
		return "", fmt.Errorf("cloud OCR: request setup failed")
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+c.Cfg.Token)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("cloud OCR: submit transport failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Redacted: never include the provider body or the token.
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", fmt.Errorf("cloud OCR: submit rejected (HTTP %d)", resp.StatusCode)
	}
	var parsed struct {
		JobID string `json:"jobId"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&parsed); err != nil || parsed.JobID == "" {
		return "", fmt.Errorf("cloud OCR: submit response invalid")
	}
	return parsed.JobID, nil
}

func (c *CloudOCR) poll(ctx context.Context, client *http.Client, jobID string) (string, error) {
	interval := time.Duration(c.Cfg.PollIntervalMs) * time.Millisecond
	if interval < 100*time.Millisecond {
		interval = 100 * time.Millisecond
	}
	if interval > 10*time.Second {
		interval = 10 * time.Second
	}
	timeout := time.Duration(c.Cfg.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if timeout > 5*time.Minute {
		timeout = 5 * time.Minute
	}
	deadline := time.Now().Add(timeout)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("cloud OCR: poll timeout")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Cfg.Endpoint+"/"+jobID, nil)
		if err != nil {
			return "", fmt.Errorf("cloud OCR: poll request setup failed")
		}
		req.Header.Set("Authorization", "Bearer "+c.Cfg.Token)
		resp, err := client.Do(req)
		if err != nil {
			return "", fmt.Errorf("cloud OCR: poll transport failed")
		}
		var state struct {
			State     string `json:"state"`
			ResultURL struct {
				JSONURL string `json:"jsonUrl"`
			} `json:"resultUrl"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&state)
		status := resp.StatusCode
		resp.Body.Close()
		if status != http.StatusOK || decodeErr != nil {
			return "", fmt.Errorf("cloud OCR: poll response invalid (HTTP %d)", status)
		}
		switch state.State {
		case "done":
			if state.ResultURL.JSONURL == "" {
				return "", fmt.Errorf("cloud OCR: done without result URL")
			}
			return state.ResultURL.JSONURL, nil
		case "failed":
			return "", fmt.Errorf("cloud OCR: job failed")
		case "pending", "running":
			// bounded wait, then poll again
		default:
			return "", fmt.Errorf("cloud OCR: unknown job state")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(interval):
		}
	}
}

func (c *CloudOCR) download(ctx context.Context, client *http.Client, jsonURL string, expectedPages int) ([]retrieval.OCRPage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jsonURL, nil)
	if err != nil {
		return nil, fmt.Errorf("cloud OCR: result request setup failed")
	}
	req.Header.Set("Authorization", "Bearer "+c.Cfg.Token)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloud OCR: result transport failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("cloud OCR: result rejected (HTTP %d)", resp.StatusCode)
	}
	var pages []retrieval.OCRPage
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, 64<<20))
	scanner.Buffer(make([]byte, 64*1024), 16<<20)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var parsed struct {
			Result struct {
				LayoutParsingResults []struct {
					Markdown struct {
						Text string `json:"text"`
					} `json:"markdown"`
				} `json:"layoutParsingResults"`
			} `json:"result"`
		}
		if err := json.Unmarshal(line, &parsed); err != nil {
			return nil, fmt.Errorf("cloud OCR: result JSONL invalid")
		}
		var texts []string
		for _, block := range parsed.Result.LayoutParsingResults {
			texts = append(texts, block.Markdown.Text)
		}
		pages = append(pages, retrieval.OCRPage{Number: len(pages) + 1, Text: joinNonEmpty(texts)})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("cloud OCR: result read failed")
	}
	if len(pages) != expectedPages {
		return nil, fmt.Errorf("cloud OCR: page-count mismatch: got %d, want %d", len(pages), expectedPages)
	}
	return pages, nil
}

func joinNonEmpty(texts []string) string {
	var kept []string
	for _, t := range texts {
		if t != "" {
			kept = append(kept, t)
		}
	}
	return strings.Join(kept, "\n")
}

var _ retrieval.OCRProvider = (*CloudOCR)(nil)
