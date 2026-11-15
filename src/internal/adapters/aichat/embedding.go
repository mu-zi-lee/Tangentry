package aichat

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"tangentry/internal/ai"
	"tangentry/internal/retrieval"
)

// EmbeddingClient is B's embedding adapter. It implements retrieval.Embedder
// over a local OpenAI-compatible server, a custom remote endpoint, or Aliyun
// Bailian (OpenAI-compatible or DashScope surface). It uses B's OWN retrieval
// budget (BudgetTracker) and never touches A's completion ledger
// (reserveCompletion is not called here).
type EmbeddingClient struct {
	HTTP     *http.Client
	Settings retrieval.EmbeddingSettings
	Budget   *retrieval.BudgetTracker // B budget; nil disables gating (tests)
	Cache    retrieval.VectorCache    // optional vector cache
}

// NewEmbeddingClient builds the adapter from validated settings.
func NewEmbeddingClient(settings retrieval.EmbeddingSettings, budget *retrieval.BudgetTracker, cache retrieval.VectorCache) *EmbeddingClient {
	return &EmbeddingClient{Settings: settings, Budget: budget, Cache: cache}
}

// ModelID implements retrieval.Embedder.
func (c *EmbeddingClient) ModelID() string { return c.Settings.Model }

// Dimensions implements retrieval.Embedder.
func (c *EmbeddingClient) Dimensions() int { return c.Settings.Dimensions }

// BatchingMode implements retrieval.Embedder (shared vs split).
func (c *EmbeddingClient) BatchingMode() retrieval.BatchingMode { return c.Settings.BatchingMode() }

// Embed embeds texts for one role. In split mode the adapter sets
// text_type=query/document by role and never mixes roles; the caller batches
// per role. A B-budget slot is reserved before the remote POST; a missing
// usage marks the budget unknown and stops further calls.
func (c *EmbeddingClient) Embed(ctx context.Context, texts []string, role retrieval.EmbedRole) ([][]float32, error) {
	return c.embed(ctx, texts, role, nil)
}

// EmbedWithUsage implements retrieval.UsageReportingEmbedder: the engine's
// per-invocation tracker receives usage validity for this call. The sink is
// only informed; it never reserves a slot here (the engine wrapper already
// reserved one), and it is never retained between invocations.
func (c *EmbeddingClient) EmbedWithUsage(ctx context.Context, texts []string, role retrieval.EmbedRole, usage retrieval.UsageSink) ([][]float32, error) {
	return c.embed(ctx, texts, role, usage)
}

func (c *EmbeddingClient) embed(ctx context.Context, texts []string, role retrieval.EmbedRole, usage retrieval.UsageSink) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, ai.ErrInvalid
	}
	if !ai.ValidEndpoint(c.Settings.BaseURL) || strings.TrimSpace(c.Settings.Model) == "" {
		return nil, ai.ErrInvalid
	}
	if c.Settings.ProviderKind == retrieval.ProviderLocal && !retrieval.IsLoopbackURL(c.Settings.BaseURL) {
		return nil, ai.ErrInvalid
	}
	// Reserve a B-budget slot BEFORE the remote POST.
	if c.Budget != nil && !c.Budget.Reserve() {
		return nil, fmt.Errorf("%w: embedding budget %s", ai.ErrProvider, c.Budget.Status())
	}
	if c.Budget != nil {
		chars := 0
		for _, t := range texts {
			chars += len([]rune(t))
		}
		c.Budget.AddChars(chars)
	}
	body, err := c.buildRequest(texts, role)
	if err != nil {
		return nil, err
	}
	endpoint := c.endpoint()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, ai.ErrProvider
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Settings.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.Settings.APIKey)
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
		// Redacted: provider bodies may contain credentials/private text.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, ai.ErrRequestRejected
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, ai.ErrProvider
	}
	vecs, usageOK, err := c.parseResponse(raw, len(texts))
	if err != nil {
		return nil, err
	}
	if !usageOK {
		if c.Budget != nil {
			c.Budget.MarkUsageUnknown()
		}
		if usage != nil {
			usage.MarkUsageUnknown()
		}
	}
	return vecs, nil
}

// TestConnection embeds one fixed harmless string, validates the returned
// dimension/model identity and reports usage. It never sends a user document.
func (c *EmbeddingClient) TestConnection(ctx context.Context) (retrieval.EmbeddingTestResult, error) {
	const probe = "Tangentry embedding connection test."
	vecs, err := c.Embed(ctx, []string{probe}, retrieval.EmbedQuery)
	if err != nil {
		return retrieval.EmbeddingTestResult{}, err
	}
	return retrieval.EmbeddingTestResult{
		Model:      c.Settings.Model,
		Dimensions: len(vecs[0]),
		OK:         len(vecs[0]) == c.Settings.Dimensions,
	}, nil
}

func (c *EmbeddingClient) httpClient() *http.Client {
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

func (c *EmbeddingClient) endpoint() string {
	base := strings.TrimRight(c.Settings.BaseURL, "/")
	if c.Settings.Surface == retrieval.SurfaceDashScope {
		return base + "/api/v1/services/embeddings/text-embedding/text-embedding"
	}
	return base + "/embeddings"
}

func (c *EmbeddingClient) buildRequest(texts []string, role retrieval.EmbedRole) ([]byte, error) {
	if c.Settings.Surface == retrieval.SurfaceDashScope {
		params := map[string]any{
			"dimension":   c.Settings.Dimensions,
			"output_type": "dense",
		}
		// text_type only in split mode; instruct is query-only.
		if c.Settings.BatchingMode() == retrieval.BatchingSplit {
			params["text_type"] = string(role)
		}
		if role == retrieval.EmbedQuery && c.Settings.Instruct != "" {
			params["instruct"] = c.Settings.Instruct
		}
		payload := map[string]any{
			"model":      c.Settings.Model,
			"input":      map[string]any{"texts": texts},
			"parameters": params,
		}
		return json.Marshal(payload)
	}
	// OpenAI-compatible.
	payload := map[string]any{
		"model":           c.Settings.Model,
		"input":           texts,
		"dimensions":      c.Settings.Dimensions,
		"encoding_format": c.Settings.EncodingFormat,
	}
	return json.Marshal(payload)
}

// parseResponse decodes both surfaces, validates every vector's dimension
// (fail closed) and the model identity, and reports whether usage was present.
func (c *EmbeddingClient) parseResponse(raw []byte, want int) ([][]float32, bool, error) {
	if c.Settings.Surface == retrieval.SurfaceDashScope {
		var env struct {
			Output struct {
				Embeddings []struct {
					Embedding json.RawMessage `json:"embedding"`
					TextIndex int             `json:"text_index"`
				} `json:"embeddings"`
			} `json:"output"`
			Usage *struct {
				TotalTokens *int `json:"total_tokens"`
			} `json:"usage"`
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			return nil, false, ai.ErrFormat
		}
		if env.Code != "" {
			return nil, false, ai.ErrRequestRejected
		}
		if len(env.Output.Embeddings) != want {
			return nil, false, ai.ErrFormat
		}
		vecs := make([][]float32, want)
		for _, e := range env.Output.Embeddings {
			v, err := c.decodeVector(e.Embedding)
			if err != nil {
				return nil, false, err
			}
			if e.TextIndex < 0 || e.TextIndex >= want {
				return nil, false, ai.ErrFormat
			}
			vecs[e.TextIndex] = v
		}
		return vecs, usagePresent(env.Usage), nil
	}
	var env struct {
		Data []struct {
			Embedding json.RawMessage `json:"embedding"`
			Index     int             `json:"index"`
		} `json:"data"`
		Model string `json:"model"`
		Usage *struct {
			TotalTokens *int `json:"total_tokens"`
		} `json:"usage"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, false, ai.ErrFormat
	}
	if env.Error != nil {
		return nil, false, ai.ErrRequestRejected
	}
	// Model identity: a mismatched returned model is rejected (fail closed).
	if env.Model != "" && env.Model != c.Settings.Model {
		return nil, false, fmt.Errorf("%w: embedding model identity mismatch", ai.ErrFormat)
	}
	if len(env.Data) != want {
		return nil, false, ai.ErrFormat
	}
	vecs := make([][]float32, want)
	for _, d := range env.Data {
		v, err := c.decodeVector(d.Embedding)
		if err != nil {
			return nil, false, err
		}
		if d.Index < 0 || d.Index >= want {
			return nil, false, ai.ErrFormat
		}
		vecs[d.Index] = v
	}
	return vecs, usagePresent(env.Usage), nil
}

// decodeVector handles float and base64 encodings and validates the dimension.
func (c *EmbeddingClient) decodeVector(raw json.RawMessage) ([]float32, error) {
	if c.Settings.EncodingFormat == retrieval.EncodingBase64 {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, ai.ErrFormat
		}
		b, err := base64.StdEncoding.DecodeString(s)
		if err != nil || len(b)%4 != 0 {
			return nil, ai.ErrFormat
		}
		vec := make([]float32, len(b)/4)
		for i := range vec {
			vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
		}
		return c.checkDims(vec)
	}
	var floats []float64
	if err := json.Unmarshal(raw, &floats); err != nil {
		return nil, ai.ErrFormat
	}
	vec := make([]float32, len(floats))
	for i, f := range floats {
		vec[i] = float32(f)
	}
	return c.checkDims(vec)
}

func (c *EmbeddingClient) checkDims(vec []float32) ([]float32, error) {
	if len(vec) != c.Settings.Dimensions {
		return nil, fmt.Errorf("%w: embedding dimension mismatch (got %d, want %d)", ai.ErrFormat, len(vec), c.Settings.Dimensions)
	}
	return vec, nil
}

func usagePresent(u *struct {
	TotalTokens *int `json:"total_tokens"`
}) bool {
	return u != nil && u.TotalTokens != nil && *u.TotalTokens >= 0
}

var (
	_ retrieval.Embedder               = (*EmbeddingClient)(nil)
	_ retrieval.UsageReportingEmbedder = (*EmbeddingClient)(nil)
)
