package ai

import (
	"context"
	"sync"

	"tangentry/internal/retrieval"
	"tangentry/internal/subtitles"
)

const MaxInputBytes = 3 << 20

const (
	batchBytes        = 8000
	batchCount        = 32
	articleBatchBytes = 2000
)

type Segment struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
}

type Translator interface {
	Translate(context.Context, Config, []Segment) ([]Segment, error)
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Model   string `json:"model,omitempty"`
}
type ChatRequest struct {
	ContentID string        `json:"contentId"`
	Context   string        `json:"context"`
	Messages  []ChatMessage `json:"messages"`
	Revision  int64         `json:"revision"`
	Model     string        `json:"model,omitempty"`
	Clear     bool          `json:"clear,omitempty"`
	// MaxProviderCalls optionally caps started completion POSTs for this
	// invocation. Omitted means unlimited; explicit values must be 1..100.
	MaxProviderCalls *int `json:"maxProviderCalls,omitempty"`
	// Retrieval is B's optional namespaced retrieval object. Omitted or
	// Enabled=false preserves the legacy path byte-identically (B-T01).
	Retrieval *retrieval.Request `json:"retrieval,omitempty"`
}
type ChatResult struct {
	ContentID string        `json:"contentId"`
	Messages  []ChatMessage `json:"messages"`
	UpdatedAt int64         `json:"updatedAt"`
	// Budget is present only for limited invocations.
	Budget *BudgetReport `json:"budget,omitempty"`
	// Retrieval is present only when retrieval ran (B's namespaced object).
	Retrieval *retrieval.Response `json:"retrieval,omitempty"`
}
type Chatter interface {
	Chat(context.Context, Config, string, []ChatMessage) (string, error)
}

// StreamChatter is optional. Providers that support OpenAI-compatible SSE can
// emit answer deltas as they arrive; the service falls back to Chatter when it
// is not implemented.
type StreamChatter interface {
	ChatStream(context.Context, Config, string, []ChatMessage, func(string) error) error
}

type Input struct {
	Source         string          `json:"source,omitempty"`
	ContentID      string          `json:"contentId"`
	Track          subtitles.Track `json:"track"`
	TargetLanguage string          `json:"targetLanguage,omitempty"`
	Revision       int64           `json:"revision"`
	// Regenerate discards the stored translation of this text first.
	Regenerate bool `json:"regenerate,omitempty"`
	// MaxProviderCalls optionally caps started completion POSTs for this
	// invocation. Omitted means unlimited; explicit values must be 1..100.
	MaxProviderCalls *int `json:"maxProviderCalls,omitempty"`
}

type Result struct {
	Key            string   `json:"key"`
	ContentID      string   `json:"contentId"`
	Language       string   `json:"language"`
	TargetLanguage string   `json:"targetLanguage"`
	BaseURL        string   `json:"baseUrl"`
	Model          string   `json:"model"`
	Total          int      `json:"total"`
	Texts          []string `json:"texts"`
	UpdatedAt      int64    `json:"updatedAt"`
	// Budget is present only for limited invocations.
	Budget *BudgetReport `json:"budget,omitempty"`
}

type Inspection struct {
	Settings Status `json:"settings"`
	Result   Result `json:"result"`
	Active   bool   `json:"active"`
}

type Service struct {
	mu              sync.Mutex
	config          Config
	settingsPath    string
	results         ResultStore
	summaries       *summaryStore
	provider        Translator
	summarizer      Summarizer
	active          string
	cancel          context.CancelFunc
	closed          bool
	wait            sync.WaitGroup
	saveSummaryNote func(context.Context, SummaryResult) error
	retrievalEngine *retrieval.Engine
}

// SetSummaryNoteWriter connects the optional notes use case at the composition root.
// AI remains usable without notes storage in focused tests and minimal servers.
func (s *Service) SetSummaryNoteWriter(writer func(context.Context, SummaryResult) error) {
	s.mu.Lock()
	s.saveSummaryNote = writer
	s.mu.Unlock()
}

// SetRetrievalEngine connects B's optional retrieval engine at the composition
// root. Without it, retrieval requests are not ready and the legacy chat path
// is unchanged (B-T01).
func (s *Service) SetRetrievalEngine(engine *retrieval.Engine) {
	s.mu.Lock()
	s.retrievalEngine = engine
	s.mu.Unlock()
}
