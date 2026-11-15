package retrieval

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Embedding provider kinds.
const (
	ProviderLocal   = "local"
	ProviderRemote  = "remote"
	ProviderBailian = "bailian"
)

// Embedding API surfaces.
const (
	SurfaceOpenAICompatible = "openai"    // POST {base}/embeddings
	SurfaceDashScope        = "dashscope" // POST {base}/api/v1/services/embeddings/text-embedding/text-embedding
)

// Encoding formats.
const (
	EncodingFloat  = "float"
	EncodingBase64 = "base64"
)

// ModelLimit records a Bailian model's documented row/batch and dimension
// constraints (docs/evidence/b-embedding-provider-notes.md).
type ModelLimit struct {
	MaxRows      int
	Dimensions   []int // allowed choices; empty = any positive (custom)
	DefaultDims  int
	FixedDims    int // non-zero = the only allowed dimension
	MaxRowTokens int
}

// bailianModelLimits is the documented preset table. Dimensions are a
// per-model choice, never a global constant.
var bailianModelLimits = map[string]ModelLimit{
	"text-embedding-v4": {
		MaxRows: 10, DefaultDims: 1024, MaxRowTokens: 8192,
		Dimensions: []int{2048, 1536, 1024, 768, 512, 256, 128, 64},
	},
	"text-embedding-v3": {
		MaxRows: 10, DefaultDims: 1024,
		Dimensions: []int{1024, 768, 512, 256, 128, 64},
	},
	"text-embedding-v2": {
		MaxRows: 25, FixedDims: 1536, DefaultDims: 1536, MaxRowTokens: 2048,
		Dimensions: []int{1536},
	},
	"qwen3.7-text-embedding": {
		MaxRows: 20, DefaultDims: 1024, MaxRowTokens: 128000,
		Dimensions: []int{2560, 2048, 1536, 1024, 768, 512, 256},
	},
	"qwen3.7-text-embedding-flash": {
		MaxRows: 20, DefaultDims: 1024, MaxRowTokens: 128000,
		Dimensions: []int{1024, 768, 512, 256},
	},
}

// ModelLimitFor returns the documented limit for a Bailian model (ok=false
// for unknown/custom models, which use generic validation).
func ModelLimitFor(model string) (ModelLimit, bool) {
	l, ok := bailianModelLimits[model]
	return l, ok
}

// EmbeddingSettings is the user-configurable embedding/rerank configuration.
// The API key is stored locally/env and never returned by the settings API
// (only HasKey). Budgets are B's own retrieval budget. The JSON tags are the
// settings API wire shape; keys are write-only inputs (an empty key on save
// keeps the stored one) and responses always use Mask.
type EmbeddingSettings struct {
	ProviderKind   string `json:"providerKind"`
	Surface        string `json:"surface"`
	BaseURL        string `json:"baseUrl"`
	APIKey         string `json:"apiKey"`
	Model          string `json:"model"`
	Dimensions     int    `json:"dimensions"`
	BatchSize      int    `json:"batchSize"`
	TextType       string `json:"textType"` // optional; "" = shared, "query"/"document" role-split
	Instruct       string `json:"instruct"` // optional, query-only
	EncodingFormat string `json:"encodingFormat"`
	TimeoutMs      int    `json:"timeoutMs"`
	TopK           int    `json:"topK"`

	LexicalWeight   float64 `json:"lexicalWeight"`
	EmbeddingWeight float64 `json:"embeddingWeight"`
	RerankWeight    float64 `json:"rerankWeight"`

	MaxEmbeddingRequests int `json:"maxEmbeddingRequests"`
	MaxEmbeddingChars    int `json:"maxEmbeddingChars"`
	MaxRerankRequests    int `json:"maxRerankRequests"`

	RerankProvider string `json:"rerankProvider"` // off/bailian/custom
	RerankModel    string `json:"rerankModel"`
	RerankBaseURL  string `json:"rerankBaseUrl"`
	RerankAPIKey   string `json:"rerankApiKey"`
	RerankTopN     int    `json:"rerankTopN"`
	RerankInstruct string `json:"rerankInstruct"`
}

// DefaultEmbeddingSettings returns the local-first default (recommended
// bge-m3/1024, Ollama-style loopback, batch 8, top-K 100, weights
// 0.35/0.65/0, rerank off, mode-specific request limit 24 shared).
func DefaultEmbeddingSettings() EmbeddingSettings {
	return EmbeddingSettings{
		ProviderKind:         ProviderLocal,
		Surface:              SurfaceOpenAICompatible,
		BaseURL:              "http://127.0.0.1:11434/v1",
		Model:                "bge-m3",
		Dimensions:           1024,
		BatchSize:            8,
		EncodingFormat:       EncodingFloat,
		TimeoutMs:            30000,
		TopK:                 100,
		LexicalWeight:        0.35,
		EmbeddingWeight:      0.65,
		RerankWeight:         0,
		MaxEmbeddingRequests: 24,
		MaxEmbeddingChars:    100000,
		MaxRerankRequests:    0,
		RerankProvider:       "off",
	}
}

// HasKey reports whether an API key is configured (never the key itself).
func (s EmbeddingSettings) HasKey() bool { return strings.TrimSpace(s.APIKey) != "" }

// HasRerankKey reports whether a rerank key is configured (masked).
func (s EmbeddingSettings) HasRerankKey() bool { return strings.TrimSpace(s.RerankAPIKey) != "" }

// BatchingMode derives the batching mode from the configuration: a provider
// with per-role text_type (DashScope/Bailian) is split; otherwise shared.
func (s EmbeddingSettings) BatchingMode() BatchingMode {
	if s.Surface == SurfaceDashScope || s.TextType != "" {
		return BatchingSplit
	}
	return BatchingShared
}

// ValidateEmbeddingSettings checks provider/endpoint/model/dimensions/batch/
// weights/budgets. It returns an actionable error (invalid_budget for budget
// faults, invalid_input otherwise); a wrong dimension/model is rejected, not
// silently accepted.
func ValidateEmbeddingSettings(s EmbeddingSettings) error {
	switch s.ProviderKind {
	case ProviderLocal, ProviderRemote, ProviderBailian:
	default:
		return fmt.Errorf("%w: unknown provider kind %q", ErrInvalidInput, s.ProviderKind)
	}
	if strings.TrimSpace(s.BaseURL) == "" {
		return fmt.Errorf("%w: baseUrl is required", ErrInvalidInput)
	}
	if s.ProviderKind == ProviderLocal && !IsLoopbackURL(s.BaseURL) {
		return fmt.Errorf("%w: local provider requires a loopback baseUrl", ErrInvalidInput)
	}
	if strings.TrimSpace(s.Model) == "" || len(s.Model) > 200 || strings.ContainsAny(s.Model, "\r\n\x00") {
		return fmt.Errorf("%w: model is required", ErrInvalidInput)
	}
	if s.Surface != SurfaceOpenAICompatible && s.Surface != SurfaceDashScope {
		return fmt.Errorf("%w: unknown surface %q", ErrInvalidInput, s.Surface)
	}
	if s.EncodingFormat != EncodingFloat && s.EncodingFormat != EncodingBase64 {
		return fmt.Errorf("%w: encodingFormat must be float or base64", ErrInvalidInput)
	}
	if s.Dimensions <= 0 {
		return fmt.Errorf("%w: dimensions must be a positive integer", ErrInvalidInput)
	}
	if s.BatchSize <= 0 {
		return fmt.Errorf("%w: batchSize must be a positive integer", ErrInvalidInput)
	}
	// Per-model dimension/batch constraints for Bailian presets.
	if s.ProviderKind == ProviderBailian {
		if limit, ok := ModelLimitFor(s.Model); ok {
			if limit.FixedDims > 0 && s.Dimensions != limit.FixedDims {
				return fmt.Errorf("%w: model %s requires dimensions=%d", ErrInvalidInput, s.Model, limit.FixedDims)
			}
			if len(limit.Dimensions) > 0 && !containsInt(limit.Dimensions, s.Dimensions) {
				return fmt.Errorf("%w: dimensions %d not allowed for model %s", ErrInvalidInput, s.Dimensions, s.Model)
			}
			if limit.MaxRows > 0 && s.BatchSize > limit.MaxRows {
				return fmt.Errorf("%w: batchSize %d exceeds model %s row limit %d", ErrInvalidInput, s.BatchSize, s.Model, limit.MaxRows)
			}
		}
	}
	if s.TopK < 20 || s.TopK > 1000 {
		return fmt.Errorf("%w: topK must be in 20..1000", ErrInvalidInput)
	}
	if s.TimeoutMs < 0 {
		return fmt.Errorf("%w: timeoutMs must be >= 0", ErrInvalidInput)
	}
	// Weights: each in [0,1], at least one positive (normalized by caller).
	if _, err := ValidateWeights(Weights{Lexical: s.LexicalWeight, Embedding: s.EmbeddingWeight, Rerank: s.RerankWeight}); err != nil {
		return err
	}
	// B budgets: 0 = off; negative/non-integer invalid (int here); chars positive.
	if s.MaxEmbeddingRequests < 0 || s.MaxRerankRequests < 0 {
		return fmt.Errorf("%w: request budgets must be >= 0", ErrInvalidBudget)
	}
	if s.MaxEmbeddingChars <= 0 {
		return fmt.Errorf("%w: maxEmbeddingChars must be a positive integer", ErrInvalidBudget)
	}
	// Rerank enabled with zero budget is rejected (UI must require a positive
	// budget or keep rerank off; never silently ignored).
	if s.RerankProvider != "" && s.RerankProvider != "off" && s.MaxRerankRequests <= 0 {
		return fmt.Errorf("%w: rerank enabled requires a positive maxRerankRequests", ErrInvalidBudget)
	}
	return nil
}

func containsInt(xs []int, v int) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

// IsLoopbackURL reports whether the URL host is a loopback address (local
// provider requirement). https is allowed for remote/custom; local must be
// loopback http(s).
func IsLoopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// EmbeddingTestResult is the outcome of a connection test (fixed harmless
// probe; never a user document).
type EmbeddingTestResult struct {
	Model      string
	Dimensions int
	OK         bool
}

// MaskedSettings is the settings API response shape: secrets are replaced by
// hasKey/hasRerankKey booleans; the key never appears.
type MaskedSettings struct {
	ProviderKind         string  `json:"providerKind"`
	Surface              string  `json:"surface"`
	BaseURL              string  `json:"baseUrl"`
	HasKey               bool    `json:"hasKey"`
	Model                string  `json:"model"`
	Dimensions           int     `json:"dimensions"`
	BatchSize            int     `json:"batchSize"`
	TextType             string  `json:"textType"`
	Instruct             string  `json:"instruct"`
	EncodingFormat       string  `json:"encodingFormat"`
	TimeoutMs            int     `json:"timeoutMs"`
	TopK                 int     `json:"topK"`
	LexicalWeight        float64 `json:"lexicalWeight"`
	EmbeddingWeight      float64 `json:"embeddingWeight"`
	RerankWeight         float64 `json:"rerankWeight"`
	MaxEmbeddingRequests int     `json:"maxEmbeddingRequests"`
	MaxEmbeddingChars    int     `json:"maxEmbeddingChars"`
	MaxRerankRequests    int     `json:"maxRerankRequests"`
	RerankProvider       string  `json:"rerankProvider"`
	RerankModel          string  `json:"rerankModel"`
	RerankBaseURL        string  `json:"rerankBaseUrl"`
	HasRerankKey         bool    `json:"hasRerankKey"`
	RerankTopN           int     `json:"rerankTopN"`
	RerankInstruct       string  `json:"rerankInstruct"`
	BatchingMode         string  `json:"batchingMode"`
}

// Mask returns the settings without secrets (for API responses and logs).
func (s EmbeddingSettings) Mask() MaskedSettings {
	return MaskedSettings{
		ProviderKind: s.ProviderKind, Surface: s.Surface, BaseURL: s.BaseURL,
		HasKey: s.HasKey(), Model: s.Model, Dimensions: s.Dimensions, BatchSize: s.BatchSize,
		TextType: s.TextType, Instruct: s.Instruct, EncodingFormat: s.EncodingFormat,
		TimeoutMs: s.TimeoutMs, TopK: s.TopK,
		LexicalWeight: s.LexicalWeight, EmbeddingWeight: s.EmbeddingWeight, RerankWeight: s.RerankWeight,
		MaxEmbeddingRequests: s.MaxEmbeddingRequests, MaxEmbeddingChars: s.MaxEmbeddingChars, MaxRerankRequests: s.MaxRerankRequests,
		RerankProvider: s.RerankProvider, RerankModel: s.RerankModel, RerankBaseURL: s.RerankBaseURL,
		HasRerankKey: s.HasRerankKey(), RerankTopN: s.RerankTopN, RerankInstruct: s.RerankInstruct,
		BatchingMode: string(s.BatchingMode()),
	}
}
