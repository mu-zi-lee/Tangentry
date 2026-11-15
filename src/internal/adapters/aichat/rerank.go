package aichat

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"tangentry/internal/ai"
	"tangentry/internal/retrieval"
)

// RerankClient is B's optional text-rerank adapter (off by default). It calls
// a Bailian DashScope or custom OpenAI-compatible rerank endpoint, counts
// requests under B's own budget, and returns request-relative relevance
// scores (0–1) that must never be compared across requests.
type RerankClient struct {
	HTTP     *http.Client
	Settings retrieval.EmbeddingSettings
	Budget   *retrieval.BudgetTracker
}

// NewRerankClient builds the rerank adapter.
func NewRerankClient(settings retrieval.EmbeddingSettings, budget *retrieval.BudgetTracker) *RerankClient {
	return &RerankClient{Settings: settings, Budget: budget}
}

// Enabled reports whether rerank is configured with a positive budget.
func (c *RerankClient) Enabled() bool {
	return c.Settings.RerankProvider != "" && c.Settings.RerankProvider != "off" && c.Settings.MaxRerankRequests > 0
}

// Model returns the rerank model identity.
func (c *RerankClient) Model() string { return c.Settings.RerankModel }

// Rerank scores documents against the query. A failure returns an error so
// the caller degrades to embedding/lexical ranking with rerank_unavailable;
// scores are request-relative.
func (c *RerankClient) Rerank(ctx context.Context, query string, documents []string, topN int) ([]retrieval.RerankResult, error) {
	if !c.Enabled() {
		return nil, ai.ErrInvalid
	}
	if len(documents) == 0 || strings.TrimSpace(query) == "" {
		return nil, ai.ErrInvalid
	}
	base := c.Settings.RerankBaseURL
	if base == "" {
		base = c.Settings.BaseURL
	}
	if !ai.ValidEndpoint(base) {
		return nil, ai.ErrInvalid
	}
	if c.Budget != nil && !c.Budget.Reserve() {
		return nil, ai.ErrProvider
	}
	body, endpoint, err := c.buildRequest(base, query, documents, topN)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, ai.ErrProvider
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Settings.RerankAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.Settings.RerankAPIKey)
	}
	client := c.httpClient()
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ai.ErrProvider
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, ai.ErrAuth
	}
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, ai.ErrRequestRejected
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, ai.ErrProvider
	}
	return c.parseResponse(raw)
}

func (c *RerankClient) httpClient() *http.Client {
	client := c.HTTP
	if client == nil {
		client = New().HTTP
	}
	safe := *client
	safe.Jar = nil
	safe.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if c.Settings.TimeoutMs > 0 {
		safe.Timeout = time.Duration(c.Settings.TimeoutMs) * time.Millisecond
	}
	return &safe
}

func (c *RerankClient) buildRequest(base, query string, documents []string, topN int) ([]byte, string, error) {
	base = strings.TrimRight(base, "/")
	if topN <= 0 {
		topN = c.Settings.RerankTopN
	}
	if topN <= 0 {
		topN = len(documents)
	}
	if c.Settings.RerankProvider == "bailian" {
		// DashScope surface.
		params := map[string]any{"top_n": topN, "return_documents": false}
		if c.Settings.RerankInstruct != "" {
			params["instruct"] = c.Settings.RerankInstruct
		}
		payload := map[string]any{
			"model":      c.Settings.RerankModel,
			"input":      map[string]any{"query": query, "documents": documents},
			"parameters": params,
		}
		b, err := json.Marshal(payload)
		return b, base + "/api/v1/services/rerank/text-rerank/text-rerank", err
	}
	// Custom OpenAI-compatible surface.
	payload := map[string]any{
		"model":            c.Settings.RerankModel,
		"query":            query,
		"documents":        documents,
		"top_n":            topN,
		"return_documents": false,
	}
	if c.Settings.RerankInstruct != "" {
		payload["instruct"] = c.Settings.RerankInstruct
	}
	b, err := json.Marshal(payload)
	return b, base + "/compatible-api/v1/reranks", err
}

func (c *RerankClient) parseResponse(raw []byte) ([]retrieval.RerankResult, error) {
	var env struct {
		Output struct {
			Results []struct {
				Index          int     `json:"index"`
				RelevanceScore float64 `json:"relevance_score"`
			} `json:"results"`
		} `json:"output"`
		Results []struct {
			Index          int     `json:"index"`
			RelevanceScore float64 `json:"relevance_score"`
		} `json:"results"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, ai.ErrFormat
	}
	if env.Code != "" {
		return nil, ai.ErrRequestRejected
	}
	results := env.Output.Results
	if len(results) == 0 {
		results = env.Results
	}
	out := make([]retrieval.RerankResult, 0, len(results))
	for _, r := range results {
		if r.Index < 0 {
			return nil, ai.ErrFormat
		}
		score := r.RelevanceScore
		if score < 0 {
			score = 0
		}
		if score > 1 {
			score = 1
		}
		out = append(out, retrieval.RerankResult{Index: r.Index, RelevanceScore: score})
	}
	return out, nil
}
