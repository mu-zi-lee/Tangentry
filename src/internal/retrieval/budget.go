package retrieval

import (
	"fmt"
	"math"
)

// BudgetConfig carries the embedding budget inputs (prompt §5.1, plan
// "Embedding/rerank settings UI contract"). R = MaxRequests, B = BatchSize.
type BudgetConfig struct {
	Mode              BatchingMode
	MaxRequests       int // R; 0 = embedding off
	BatchSize         int // B
	TopK              int
	SweepCandidates   int
	MaxEmbeddingChars int
	QuestionChars     int
}

// Shares is the mode-aware, proportional, capped budget split.
type Shares struct {
	SlotBudget   int // embeddingSlotBudget
	CharBudget   int // embeddingCharBudget
	SweepRatio   float64
	SweepSlots   int
	LexicalSlots int
	SweepChars   int
	LexicalChars int
	SpareSlots   int // unused slots stay spare; never redistributed
}

// ValidateAssemblyBudget validates the context assembly budget at the JSON
// boundary (float64). 0/negative/non-integer/NaN/Inf/>max are invalid_budget
// before any work (AC-INV-04-2, B-T10). Omission is handled by the caller as
// the labelled DefaultBudgetRunes, never an unlabelled zero.
func ValidateAssemblyBudget(v float64) (int, error) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("%w: assembly budget must be a finite integer", ErrInvalidBudget)
	}
	if v != math.Trunc(v) {
		return 0, fmt.Errorf("%w: assembly budget must be an integer", ErrInvalidBudget)
	}
	if v < MinAssemblyBudgetRunes || v > MaxAssemblyBudgetRunes {
		return 0, fmt.Errorf("%w: assembly budget out of range %d..%d", ErrInvalidBudget, MinAssemblyBudgetRunes, MaxAssemblyBudgetRunes)
	}
	return int(v), nil
}

// ValidateAssemblyBudgetInt validates an already-decoded integer budget.
func ValidateAssemblyBudgetInt(v int) error {
	if v < MinAssemblyBudgetRunes || v > MaxAssemblyBudgetRunes {
		return fmt.Errorf("%w: assembly budget out of range %d..%d", ErrInvalidBudget, MinAssemblyBudgetRunes, MaxAssemblyBudgetRunes)
	}
	return nil
}

// Validate checks the embedding budget inputs. Request budgets accept 0 as
// "off"; negative values are invalid_budget before any request (B-T33 rule).
// MaxEmbeddingChars must be a positive integer.
func (c BudgetConfig) Validate() error {
	if c.Mode != BatchingShared && c.Mode != BatchingSplit {
		return fmt.Errorf("%w: unknown batching mode %q", ErrInvalidBudget, c.Mode)
	}
	if c.MaxRequests < 0 {
		return fmt.Errorf("%w: maxEmbeddingRequests must be >= 0", ErrInvalidBudget)
	}
	if c.BatchSize <= 0 {
		return fmt.Errorf("%w: batchSize must be a positive integer", ErrInvalidBudget)
	}
	if c.TopK < 0 || c.SweepCandidates < 0 {
		return fmt.Errorf("%w: topK and sweepCandidates must be >= 0", ErrInvalidBudget)
	}
	if c.MaxEmbeddingChars <= 0 {
		return fmt.Errorf("%w: maxEmbeddingChars must be a positive integer", ErrInvalidBudget)
	}
	if c.QuestionChars < 0 {
		return fmt.Errorf("%w: questionChars must be >= 0", ErrInvalidBudget)
	}
	return nil
}

// ComputeShares derives the mode-aware slot budget and the proportional,
// nonnegative, capped sweep/lexical shares. All arithmetic is integer
// (deterministic); the ratio is reported as a float for reporting only.
//
//	embeddingSlotBudget = shared ? max(0, R*B - 1) : max(0, (R-1)*B)
//	embeddingCharBudget = max(0, maxEmbeddingChars - questionChars)
//	sweepRatio          = sweepCandidates / (topK + sweepCandidates)
//	sweepSlots          = min(sweepCandidates, floor(slotBudget * ratio))
//	lexicalSlots        = min(topK, slotBudget - sweepSlots)
//	sweepChars          = floor(charBudget * ratio)
//	lexicalChars        = charBudget - sweepChars
func ComputeShares(c BudgetConfig) (Shares, error) {
	if err := c.Validate(); err != nil {
		return Shares{}, err
	}
	var slotBudget int
	if c.Mode == BatchingShared {
		slotBudget = c.MaxRequests*c.BatchSize - 1
	} else {
		slotBudget = (c.MaxRequests - 1) * c.BatchSize
	}
	if slotBudget < 0 {
		slotBudget = 0
	}
	charBudget := c.MaxEmbeddingChars - c.QuestionChars
	if charBudget < 0 {
		charBudget = 0
	}
	denom := int64(c.TopK) + int64(c.SweepCandidates)
	var ratio float64
	var sweepSlots, sweepChars int
	if denom > 0 {
		ratio = float64(c.SweepCandidates) / float64(denom)
		sweepSlots = int(minInt64(int64(c.SweepCandidates), int64(slotBudget)*int64(c.SweepCandidates)/denom))
		sweepChars = int(int64(charBudget) * int64(c.SweepCandidates) / denom)
	}
	lexicalSlots := minInt(c.TopK, slotBudget-sweepSlots)
	lexicalChars := charBudget - sweepChars
	s := Shares{
		SlotBudget:   slotBudget,
		CharBudget:   charBudget,
		SweepRatio:   ratio,
		SweepSlots:   sweepSlots,
		LexicalSlots: lexicalSlots,
		SweepChars:   sweepChars,
		LexicalChars: lexicalChars,
		SpareSlots:   slotBudget - sweepSlots - lexicalSlots,
	}
	if err := s.checkInvariants(c); err != nil {
		return Shares{}, err
	}
	return s, nil
}

// checkInvariants asserts the documented budget invariants in code.
func (s Shares) checkInvariants(c BudgetConfig) error {
	switch {
	case s.SweepSlots < 0:
		return fmt.Errorf("budget invariant: sweepSlots < 0")
	case s.LexicalSlots < 0:
		return fmt.Errorf("budget invariant: lexicalSlots < 0")
	case s.SweepSlots > c.SweepCandidates:
		return fmt.Errorf("budget invariant: sweepSlots > sweepCandidates")
	case s.LexicalSlots > c.TopK:
		return fmt.Errorf("budget invariant: lexicalSlots > topK")
	case s.SweepSlots+s.LexicalSlots > s.SlotBudget:
		return fmt.Errorf("budget invariant: shares exceed slot budget")
	case s.SweepChars < 0 || s.LexicalChars < 0:
		return fmt.Errorf("budget invariant: negative char share")
	case s.SweepChars+s.LexicalChars != s.CharBudget:
		return fmt.Errorf("budget invariant: char shares do not sum to char budget")
	case s.SpareSlots < 0:
		return fmt.Errorf("budget invariant: negative spare slots")
	}
	return nil
}

// ColdCacheRequests returns the cold-cache embedding request count for C
// embedded candidates (C <= slotBudget): shared ceil((1+C)/B), split
// 1 + ceil(C/B). The query is one more text in shared mode; split reserves a
// whole request for the query.
func ColdCacheRequests(mode BatchingMode, candidates, batchSize int) int {
	if candidates <= 0 || batchSize <= 0 {
		return 0
	}
	if mode == BatchingShared {
		return (1 + candidates + batchSize - 1) / batchSize
	}
	return 1 + (candidates+batchSize-1)/batchSize
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
