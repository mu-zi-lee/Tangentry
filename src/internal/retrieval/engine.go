package retrieval

import (
	"context"
	"strings"
	"sync"
)

// Engine orchestrates the retrieval pipeline for the AI service: validate
// budgets → preflight → select → assemble → wire response. It returns the
// assembled six-layer context (for the provider system message) and the
// namespaced response. A preflight- or assembly-detectable failure returns a
// StatusError and starts zero chat requests (the caller never chats on error).
type Engine struct {
	Source    PassageSource
	Embedder  Embedder // nil → lexical-only
	Assembler ContextAssembler
	Settings  *EmbeddingSettings // saved operational settings; nil → built-in defaults
	mu        sync.Mutex         // guards Embedder/Settings swaps (settings save)
}

// SetEmbedder replaces the embedding adapter at runtime (saved settings take
// effect without a restart). A nil embedder falls back to lexical-only. Each
// Run snapshots the current embedder, so an in-flight run keeps its adapter.
func (e *Engine) SetEmbedder(emb Embedder) {
	e.mu.Lock()
	e.Embedder = emb
	e.mu.Unlock()
}

// ApplySettings atomically replaces the saved operational settings and the
// embedding adapter so a settings save takes effect without a restart and no
// run observes a half-applied save. A nil settings pointer restores the
// built-in defaults; a nil embedder falls back to lexical-only. Each Run
// snapshots both, so an in-flight run keeps its configuration.
func (e *Engine) ApplySettings(settings *EmbeddingSettings, emb Embedder) {
	e.mu.Lock()
	e.Settings = settings
	e.Embedder = emb
	e.mu.Unlock()
}

// runBudget is the resolved operational budget for one invocation.
type runBudget struct {
	maxRequests int
	embChars    int
	batchSize   int
	topK        int
	weights     Weights
}

// resolveRunBudget merges the saved settings with the request overrides.
// Saved settings are the baseline: request/character limits, batch size,
// topK and scoring weights come from what the user saved, not hardcoded
// engine values. Explicit request overrides may only tighten the saved
// limits — an omitted field keeps the saved value, a present value is capped
// by it, and a saved 0 (embedding off) is never re-enabled by the client's
// defaults. Without saved settings the built-in mode-aware defaults apply
// and request values are preserved as-is, including an explicit 0 (budget
// contract: zero = off, never silently replaced by the default).
func resolveRunBudget(saved *EmbeddingSettings, batchMode BatchingMode, wire EmbeddingBudgetWire) runBudget {
	b := runBudget{maxRequests: 24, embChars: 100000, batchSize: 8, topK: 100, weights: DefaultWeights()}
	if batchMode == BatchingSplit {
		b.maxRequests = 25
	}
	if saved != nil {
		b.maxRequests = saved.MaxEmbeddingRequests
		if saved.MaxEmbeddingChars > 0 {
			b.embChars = saved.MaxEmbeddingChars
		}
		if saved.BatchSize > 0 {
			b.batchSize = saved.BatchSize
		}
		if saved.TopK > 0 {
			b.topK = saved.TopK
		}
		if w, err := ValidateWeights(Weights{Lexical: saved.LexicalWeight, Embedding: saved.EmbeddingWeight, Rerank: saved.RerankWeight}); err == nil {
			b.weights = w
		}
	}
	if wire.MaxRequests != nil && (saved == nil || *wire.MaxRequests < b.maxRequests) {
		b.maxRequests = *wire.MaxRequests
	}
	if wire.MaxChars > 0 && (saved == nil || wire.MaxChars < b.embChars) {
		b.embChars = wire.MaxChars
	}
	return b
}

// RunInput feeds one retrieval operation.
type RunInput struct {
	ContentID       string
	Question        string
	Request         Request
	History         []HistoryTurn
	SummaryMaterial string
	ResumableState  string
}

// RunResult carries the wire response and the assembled context.
type RunResult struct {
	Response Response
	Context  string
}

// budgetedEmbedder counts requests and enforces B's budget around an inner
// embedder (each Embed call is one request under mode-aware batching).
type budgetedEmbedder struct {
	inner   Embedder
	tracker *BudgetTracker
}

func (b *budgetedEmbedder) ModelID() string            { return b.inner.ModelID() }
func (b *budgetedEmbedder) Dimensions() int            { return b.inner.Dimensions() }
func (b *budgetedEmbedder) BatchingMode() BatchingMode { return b.inner.BatchingMode() }
func (b *budgetedEmbedder) Embed(ctx context.Context, texts []string, role EmbedRole) ([][]float32, error) {
	if !b.tracker.Reserve() {
		return nil, StatusError{Status: string(SelectionEmbeddingBudgetExhaust)}
	}
	chars := 0
	for _, t := range texts {
		chars += RuneLen(t)
	}
	b.tracker.AddChars(chars)
	// Adapters that report usage validity mark this invocation's tracker
	// directly (missing usage stops later batches); the slot above is the
	// only reservation, so no double counting occurs.
	if aware, ok := b.inner.(UsageReportingEmbedder); ok {
		return aware.EmbedWithUsage(ctx, texts, role, b.tracker)
	}
	return b.inner.Embed(ctx, texts, role)
}

// Run executes the pipeline. On rejection the Response is still populated
// (status + any spent embedding counts) and a StatusError is returned so the
// caller starts zero chat requests.
func (e *Engine) Run(ctx context.Context, in RunInput) (RunResult, error) {
	e.mu.Lock()
	embedder := e.Embedder
	saved := e.Settings
	e.mu.Unlock()
	asm := e.Assembler
	if asm == nil {
		asm = NewContextAssembler()
	}
	maxChars, err := validateRequest(in.Request)
	if err != nil {
		return RunResult{Response: Response{SchemaVersion: WireSchemaVersion, Status: string(SelectionInvalidBudget)}}, err
	}
	// Preflight before any selector/embedding work (INV-04).
	if perr := Preflight(maxChars, DefaultMaxBytes); perr != nil {
		status := string(SelectionContextBudgetExceeded)
		if perr == ErrInvalidBudget {
			status = string(SelectionInvalidBudget)
		}
		return RunResult{Response: Response{SchemaVersion: WireSchemaVersion, Status: status}}, StatusError{Status: status}
	}

	// Build the embedding budget + mode from the saved settings and the
	// request (saved limits are the baseline; request overrides only tighten).
	mode := in.Request.Mode
	if mode == "" {
		mode = ModeHybrid
	}
	batchMode := BatchingShared
	if in.Request.EmbeddingBudget.BatchingMode == string(BatchingSplit) {
		batchMode = BatchingSplit
	} else if embedder != nil {
		batchMode = embedder.BatchingMode()
	}
	budget := resolveRunBudget(saved, batchMode, in.Request.EmbeddingBudget)
	sweepCandidates := in.Request.EmbeddingBudget.SweepCandidates
	if sweepCandidates == 0 && in.Request.EmbeddingBudget.MaxRequests != nil {
		sweepCandidates = 90
	}

	var emb Embedder
	var tracker *BudgetTracker
	if embedder != nil && mode != ModeLexical {
		tracker = NewBudgetTracker(budget.maxRequests, budget.embChars)
		emb = &budgetedEmbedder{inner: embedder, tracker: tracker}
	}

	cfg := SelectorConfig{
		TopK:                budget.topK,
		Sweep:               SweepConfig{Enabled: embedder != nil, SweepCandidates: sweepCandidates},
		Budget:              BudgetConfig{Mode: batchMode, MaxRequests: budget.maxRequests, BatchSize: budget.batchSize, TopK: budget.topK, SweepCandidates: sweepCandidates, MaxEmbeddingChars: budget.embChars},
		Weights:             budget.weights,
		AssemblyBudgetRunes: maxChars,
		MaxBytes:            DefaultMaxBytes,
		Mode:                mode,
	}
	sel := NewSelector(e.Source, emb, cfg)
	selection, serr := sel.Select(ctx, in.ContentID, in.Question, 0)
	if serr != nil {
		return RunResult{}, serr
	}

	resp := Response{SchemaVersion: WireSchemaVersion, Status: string(selection.Status), Mode: selection.Mode}
	resp.Embedding = embeddingSummary(embedder, tracker)
	resp.Rerank = RerankSummary{Enabled: false, BudgetStatus: BudgetDisabled}

	// Terminal selection statuses start zero chat requests.
	switch selection.Status {
	case SelectionInvalidBudget, SelectionContextBudgetExceeded, SelectionNoVerifiedPassages,
		SelectionStaleSource, SelectionInvalidInput, SelectionEmpty, SelectionNoMatch,
		SelectionPDFNoText, SelectionPDFExtracting, SelectionPDFExtractFail, SelectionPDFOCRUnavailable:
		return RunResult{Response: resp}, StatusError{Status: string(selection.Status)}
	}

	// Assemble the six-layer context (current task = the question).
	assembly, aerr := asm.Assemble(ctx, AssemblyInput{
		Selection:       selection,
		SummaryMaterial: in.SummaryMaterial,
		History:         in.History,
		ResumableState:  in.ResumableState,
		CurrentTask:     in.Question,
		BudgetRunes:     maxChars,
		MaxBytes:        DefaultMaxBytes,
	})
	if aerr != nil {
		return RunResult{}, aerr
	}
	resp.Passages = make([]PassageRef, 0, len(assembly.Passages))
	for _, p := range assembly.Passages {
		resp.Passages = append(resp.Passages, RefFromPassage(p))
	}
	if assembly.Status == AssemblyContextBudgetExceeded || assembly.Status == AssemblyInvalidBudget {
		resp.Status = assembly.Status
		return RunResult{Response: resp}, StatusError{Status: assembly.Status}
	}
	if assembly.Status == AssemblyDegradedBudget && resp.Status == string(SelectionOK) {
		resp.Status = AssemblyDegradedBudget
	}
	return RunResult{Response: resp, Context: assembly.Context}, nil
}

func embeddingSummary(emb Embedder, tracker *BudgetTracker) EmbeddingSummary {
	if emb == nil {
		return EmbeddingSummary{BudgetStatus: BudgetDisabled}
	}
	s := EmbeddingSummary{Model: emb.ModelID(), Dimensions: emb.Dimensions()}
	if tracker != nil {
		s.BudgetStatus = tracker.Status()
		s.Requests = tracker.Requests()
	} else {
		s.BudgetStatus = BudgetCompleted
	}
	return s
}

// LastUserQuestion extracts the current question (last user message).
func LastUserQuestion(messages []HistoryTurn) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return strings.TrimSpace(messages[i].Content)
		}
	}
	return ""
}
