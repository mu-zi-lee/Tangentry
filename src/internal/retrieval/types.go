// Package retrieval implements owner B's hybrid question-relevant retrieval
// domain core (FR-02, NFR-02, INV-04, INV-05). It is pure business logic:
// only stdlib and other domain packages may be imported (ADR-002, plan
// "Boundaries and interfaces"). Adapters implement the ports in ports.go.
package retrieval

import "context"

// SourceKind names the source family a passage was selected from.
type SourceKind string

const (
	SourceArticle    SourceKind = "article"
	SourceDiscussion SourceKind = "discussion"
	SourceSubtitle   SourceKind = "subtitle"
	SourcePDF        SourceKind = "pdf"
)

// Passage is a selected sentence/segment with a verifiable source locator.
// Field names and types follow the implementation plan §"Passage type".
// StartRune/EndRune are zero-based, half-open Unicode code-point offsets
// within the named source unit — never Go byte offsets, never UTF-16 indices.
type Passage struct {
	ID            string // stable locator, see ADR-002 "Passage contract for C"
	ContentID     string
	Source        SourceKind
	Locator       string // article:12:s3, subtitle:zh:2999-3004, pdf:<hash>:7:s2
	SentenceStart int    // zero-based sentence index inside the source unit
	SentenceEnd   int    // exclusive
	StartRune     int    // zero-based, half-open
	EndRune       int
	Text          string  // exact source text at the range
	Score         float64 // hybrid score
	LexicalScore  float64
	CosineScore   float64
	SourceVersion string // content revision or text hash; subtitle revision; PDF doc hash+extractor
	TextSHA256    string
	CueIDs        []string // subtitle only
}

// EmbedRole distinguishes the question from source passages.
type EmbedRole string

const (
	EmbedQuery    EmbedRole = "query"    // the question
	EmbedDocument EmbedRole = "document" // source passages
)

// BatchingMode reports whether the question and passages can share one request.
type BatchingMode string

const (
	// BatchingShared: question and passages use the same request-level config
	// (e.g. a local OpenAI-compatible server without text_type) and batch together.
	BatchingShared BatchingMode = "shared"
	// BatchingSplit: question uses text_type=query and passages text_type=document
	// (DashScope/Bailian). Different request-level configs cannot share a batch;
	// the query request is reserved separately.
	BatchingSplit BatchingMode = "split"
)

// Embedder embeds texts for one role. Implementations live in adapters.
type Embedder interface {
	ModelID() string
	Dimensions() int
	BatchingMode() BatchingMode
	// Embed embeds texts for one role. In BatchingSplit the adapter sets
	// text_type=query for EmbedQuery and text_type=document for EmbedDocument,
	// and the caller must never mix roles in a single request.
	Embed(ctx context.Context, texts []string, role EmbedRole) ([][]float32, error)
}

// SelectionStatus is the explicit retrieval outcome vocabulary. The first
// block copies the implementation plan §"Embedding and selection signatures";
// the second block adds the remaining ADR-002 / prompt §5.6 statuses.
type SelectionStatus string

const (
	SelectionOK                SelectionStatus = "ok"
	SelectionNoMatch           SelectionStatus = "no_match"
	SelectionLexicalOnly       SelectionStatus = "lexical_only"
	SelectionPDFNoText         SelectionStatus = "pdf_no_text"
	SelectionPDFExtracting     SelectionStatus = "pdf_extracting"
	SelectionPDFExtractFail    SelectionStatus = "pdf_extract_failed"
	SelectionPDFOCRUnavailable SelectionStatus = "pdf_ocr_unavailable"
	SelectionSourceInvalid     SelectionStatus = "source_unverified"
	SelectionSweepLimited      SelectionStatus = "semantic_sweep_limited"
)

const (
	SelectionInvalidBudget          SelectionStatus = "invalid_budget"
	SelectionContextBudgetExceeded  SelectionStatus = "context_budget_exceeded"
	SelectionNoVerifiedPassages     SelectionStatus = "no_verified_passages"
	SelectionStaleSource            SelectionStatus = "stale_source"
	SelectionEmpty                  SelectionStatus = "empty"
	SelectionInvalidInput           SelectionStatus = "invalid_input"
	SelectionOversizeDropped        SelectionStatus = "oversize_dropped"
	SelectionEmbeddingBudgetLimited SelectionStatus = "embedding_budget_limited"
	SelectionEmbeddingBudgetExhaust SelectionStatus = "embedding_budget_exhausted"
	SelectionEmbeddingUsageUnknown  SelectionStatus = "embedding_usage_unknown"
	SelectionEmbeddingUnavailable   SelectionStatus = "embedding_unavailable"
	SelectionRerankUnavailable      SelectionStatus = "rerank_unavailable"
	SelectionRerankBudgetExhausted  SelectionStatus = "rerank_budget_exhausted"
)

// Sweep zero-coverage reasons (Selection.Sweep.ZeroReason).
const (
	SweepReasonZeroSlots        = "sweep_zero_slots"
	SweepReasonDisabledByConfig = "sweep_disabled_by_config"
)

// Selection is the selector outcome. Field names and types follow the plan.
type Selection struct {
	Passages       []Passage // deduplicated, verified and sorted
	Status         SelectionStatus
	Mode           string // hybrid or lexical_only
	Dropped        int
	EmbeddingModel string
	// Sweep records the bounded semantic sweep for replay and reporting.
	Sweep struct {
		Used       bool
		Sampled    int     // S: candidates actually added by the sweep
		Stride     int     // ceil(N/S); 1 means every segment was sampled
		Coverage   float64 // S/N; 1.0 means full coverage
		Limited    bool    // true when S < N
		ZeroReason string  // "", "sweep_zero_slots" or "sweep_disabled_by_config"
		Slots      int     // sweepSlots allocated
		Chars      int     // sweepChars allocated
	}
	LexicalSlots    int // lexicalSlots allocated (<= topK)
	LexicalSelected int // lexical candidates actually embedded
	SlotBudget      int // embeddingSlotBudget used for this run
	CharBudget      int // embeddingCharBudget used for this run
	LexicalCoverage int // distinct query terms matched by the best candidate
}

// PassageSelector selects question-relevant passages for one content item.
type PassageSelector interface {
	Select(ctx context.Context, contentID, question string, maxCandidates int) (Selection, error)
}

// SweepConfig configures the bounded semantic sweep.
type SweepConfig struct {
	Enabled         bool // false when no embedder is configured
	SweepCandidates int  // requested sweep quota, default 90
}

// HistoryTurn is one prior conversation turn (the AI layer maps ChatMessage).
type HistoryTurn struct {
	Role    string
	Content string
}

// RerankResult is one request-relative rerank score (0–1). Scores from
// different requests must never be compared.
type RerankResult struct {
	Index          int
	RelevanceScore float64
}

// AssemblyInput feeds the six-layer context assembler.
type AssemblyInput struct {
	Selection       Selection
	SummaryMaterial string
	History         []HistoryTurn
	ResumableState  string
	CurrentTask     string
	BudgetRunes     int
	MaxBytes        int
}

// Assembly is the assembled context outcome.
type Assembly struct {
	Context   string
	Passages  []Passage
	Status    string // ok, degraded_budget, context_budget_exceeded, source_unverified, stale_source
	UsedRunes int
	UsedBytes int
	Dropped   int
}

// ContextAssembler assembles the six-layer context under rune and byte caps.
type ContextAssembler interface {
	Assemble(ctx context.Context, input AssemblyInput) (Assembly, error)
}

// Assembly status vocabulary (Assembly.Status is a plain string per plan).
const (
	AssemblyOK                    = "ok"
	AssemblyDegradedBudget        = "degraded_budget"
	AssemblyContextBudgetExceeded = "context_budget_exceeded"
	AssemblyInvalidBudget         = "invalid_budget"
	AssemblySourceUnverified      = "source_unverified"
	AssemblyStaleSource           = "stale_source"
)

// Wire byte cap: the backend rejects contexts over 200,000 UTF-8 bytes
// (src/internal/ai/chat.go). Independent of the rune budget.
const DefaultMaxBytes = 200000

// Accepted assembly budget range (ADR-002 D2.2): 1–1,000,000 runes.
const (
	MinAssemblyBudgetRunes = 1
	MaxAssemblyBudgetRunes = 1000000
)

// DefaultBudgetRunes is the labelled default when the client omits maxChars.
const DefaultBudgetRunes = 120000

// StressBudgetRunes is the 8,000-rune stress profile threshold: at or below
// it, summary and history are disabled and the result is degraded_budget.
const StressBudgetRunes = 8000
