package retrieval

import (
	"context"
	"math"
	"testing"
)

// TestBudgetMathWorkedExamples reproduces EVERY worked-example row of prompt
// §5.1 / plan "Worked defaults" exactly (B=8, topK=100, sweepCandidates=90,
// maxEmbeddingChars=100000, ratio=90/190). These are the budget-math half of
// B-T33; the full fake-transport mode matrix runs in phase 4.
func TestBudgetMathWorkedExamples(t *testing.T) {
	rows := []struct {
		name       string
		mode       BatchingMode
		r          int
		slotBudget int
		sweep      int
		lexical    int
		coldCacheC int // candidates embedded for the request-count assertion
		requests   int
		spare      int
	}{
		{"shared_R0", BatchingShared, 0, 0, 0, 0, 0, 0, 0},
		{"shared_R1", BatchingShared, 1, 7, 3, 4, 7, 1, 0},
		{"shared_R24", BatchingShared, 24, 191, 90, 100, 190, 24, 1},
		{"split_R0", BatchingSplit, 0, 0, 0, 0, 0, 0, 0},
		{"split_R1", BatchingSplit, 1, 0, 0, 0, 0, 0, 0},
		{"split_R24", BatchingSplit, 24, 184, 87, 97, 184, 24, 0},
		{"split_R25", BatchingSplit, 25, 192, 90, 100, 190, 25, 2},
		// High-budget guard: uncapped proportional split would yield 94 > 90.
		// 190 candidates + question → ceil(191/8) = 24 requests (<= 25).
		{"shared_R25_capped", BatchingShared, 25, 199, 90, 100, 190, 24, 9},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			cfg := BudgetConfig{
				Mode: row.mode, MaxRequests: row.r, BatchSize: 8,
				TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000, QuestionChars: 0,
			}
			s, err := ComputeShares(cfg)
			if err != nil {
				t.Fatalf("ComputeShares: %v", err)
			}
			if s.SlotBudget != row.slotBudget {
				t.Errorf("slotBudget = %d, want %d", s.SlotBudget, row.slotBudget)
			}
			if s.SweepSlots != row.sweep {
				t.Errorf("sweepSlots = %d, want %d", s.SweepSlots, row.sweep)
			}
			if s.LexicalSlots != row.lexical {
				t.Errorf("lexicalSlots = %d, want %d", s.LexicalSlots, row.lexical)
			}
			if s.SpareSlots != row.spare {
				t.Errorf("spareSlots = %d, want %d", s.SpareSlots, row.spare)
			}
			if got := ColdCacheRequests(row.mode, row.coldCacheC, 8); got != row.requests {
				t.Errorf("coldCacheRequests(%d) = %d, want %d", row.coldCacheC, got, row.requests)
			}
			if row.requests > row.r {
				t.Errorf("requests %d exceed maxEmbeddingRequests %d", row.requests, row.r)
			}
			// Character split at defaults ≈ 47,300 sweep / 52,600 lexical.
			if s.SweepChars != 47368 || s.LexicalChars != 52632 {
				t.Errorf("char split = %d/%d, want 47368/52632", s.SweepChars, s.LexicalChars)
			}
			if s.SweepChars+s.LexicalChars != s.CharBudget {
				t.Errorf("char shares do not sum to char budget")
			}
		})
	}
}

// TestBudgetMathInvalid: -1 (and other invalid values) → invalid_budget
// BEFORE any request; 0 is "off", not invalid.
func TestBudgetMathInvalid(t *testing.T) {
	base := BudgetConfig{Mode: BatchingShared, MaxRequests: 24, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000}
	for _, r := range []int{-1, -100} {
		cfg := base
		cfg.MaxRequests = r
		if _, err := ComputeShares(cfg); err == nil {
			t.Errorf("MaxRequests=%d: expected invalid_budget", r)
		}
	}
	for _, mut := range []func(*BudgetConfig){
		func(c *BudgetConfig) { c.BatchSize = 0 },
		func(c *BudgetConfig) { c.BatchSize = -2 },
		func(c *BudgetConfig) { c.MaxEmbeddingChars = 0 },
		func(c *BudgetConfig) { c.MaxEmbeddingChars = -5 },
		func(c *BudgetConfig) { c.TopK = -1 },
		func(c *BudgetConfig) { c.SweepCandidates = -1 },
		func(c *BudgetConfig) { c.Mode = "bogus" },
	} {
		cfg := base
		mut(&cfg)
		if _, err := ComputeShares(cfg); err == nil {
			t.Errorf("expected invalid_budget for %+v", cfg)
		}
	}
	// 0 requests is valid "off".
	cfg := base
	cfg.MaxRequests = 0
	s, err := ComputeShares(cfg)
	if err != nil || s.SlotBudget != 0 {
		t.Fatalf("R=0 must be off: shares=%+v err=%v", s, err)
	}
}

// TestBudgetMathSweepDisabled: sweepCandidates=0 → ratio 0, sweep 0, all
// slots lexical (deliberate opt-out; distinct label tested at selector level).
func TestBudgetMathSweepDisabled(t *testing.T) {
	cfg := defaultBudget()
	cfg.SweepCandidates = 0
	s, err := ComputeShares(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if s.SweepSlots != 0 || s.SweepChars != 0 || s.SweepRatio != 0 {
		t.Fatalf("sweep must be zero: %+v", s)
	}
	if s.LexicalSlots != 100 {
		t.Fatalf("lexicalSlots = %d, want 100", s.LexicalSlots)
	}
}

// TestBudgetMathCharPressure: char pressure shrinks BOTH shares
// proportionally (B-T40 variant C math half).
func TestBudgetMathCharPressure(t *testing.T) {
	cfg := defaultBudget()
	cfg.MaxEmbeddingChars = 10000 // binds before the 191 slot budget
	cfg.QuestionChars = 100
	s, err := ComputeShares(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if s.CharBudget != 9900 {
		t.Fatalf("charBudget = %d, want 9900", s.CharBudget)
	}
	wantSweep := 9900 * 90 / 190
	if s.SweepChars != wantSweep || s.LexicalChars != 9900-wantSweep {
		t.Fatalf("char shares = %d/%d, want %d/%d", s.SweepChars, s.LexicalChars, wantSweep, 9900-wantSweep)
	}
	if s.SweepChars == 0 {
		t.Fatal("char pressure must not starve the sweep to zero at this budget")
	}
	// Slot shares are unchanged (chars bind, not slots).
	if s.SweepSlots != 90 || s.LexicalSlots != 100 {
		t.Fatalf("slot shares changed under char pressure: %+v", s)
	}
}

// TestBudgetMathInvariantGrid asserts the invariants over a deterministic
// configuration grid (no randomness).
func TestBudgetMathInvariantGrid(t *testing.T) {
	modes := []BatchingMode{BatchingShared, BatchingSplit}
	requests := []int{0, 1, 2, 7, 24, 25, 100}
	batches := []int{1, 8, 10, 20, 25}
	topKs := []int{0, 20, 100, 1000}
	sweeps := []int{0, 1, 90, 500}
	chars := []int{1, 100, 100000}
	questions := []int{0, 50, 200000}
	for _, mode := range modes {
		for _, r := range requests {
			for _, b := range batches {
				for _, tk := range topKs {
					for _, sc := range sweeps {
						for _, mc := range chars {
							for _, q := range questions {
								cfg := BudgetConfig{Mode: mode, MaxRequests: r, BatchSize: b, TopK: tk, SweepCandidates: sc, MaxEmbeddingChars: mc, QuestionChars: q}
								s, err := ComputeShares(cfg)
								if err != nil {
									t.Fatalf("unexpected error for %+v: %v", cfg, err)
								}
								if s.SweepSlots < 0 || s.LexicalSlots < 0 ||
									s.SweepSlots > sc || s.LexicalSlots > tk ||
									s.SweepSlots+s.LexicalSlots > s.SlotBudget ||
									s.SweepChars < 0 || s.LexicalChars < 0 ||
									s.SweepChars+s.LexicalChars != s.CharBudget ||
									s.SpareSlots < 0 {
									t.Fatalf("invariant violated: cfg=%+v shares=%+v", cfg, s)
								}
							}
						}
					}
				}
			}
		}
	}
}

// TestBT10_InvalidAssemblyBudget: the context assembly budget values 0, -1,
// 1.5, NaN, +Inf, 1,000,001 are rejected as invalid_budget before any work.
// Omission is a labelled default (caller), never an unlabelled zero.
func TestBT10_InvalidAssemblyBudget(t *testing.T) {
	for _, v := range []float64{0, -1, 1.5, math.NaN(), math.Inf(1), math.Inf(-1), 1000001, -0.5} {
		if _, err := ValidateAssemblyBudget(v); err == nil {
			t.Errorf("ValidateAssemblyBudget(%v): expected invalid_budget", v)
		}
	}
	for _, v := range []float64{1, 8000, 120000, 1000000} {
		got, err := ValidateAssemblyBudget(v)
		if err != nil || got != int(v) {
			t.Errorf("ValidateAssemblyBudget(%v) = %d, %v", v, got, err)
		}
	}
	// Integer boundary via the assembler: no work, explicit status.
	asm := NewContextAssembler()
	for _, b := range []int{0, -1, 1000001} {
		out, err := asm.Assemble(context.Background(), AssemblyInput{BudgetRunes: b, MaxBytes: DefaultMaxBytes})
		if err != nil {
			t.Fatalf("Assemble(%d): %v", b, err)
		}
		if out.Status != AssemblyInvalidBudget {
			t.Errorf("Assemble(%d) status = %q, want invalid_budget", b, out.Status)
		}
		if out.Context != "" || out.UsedRunes != 0 {
			t.Errorf("Assemble(%d) did work before rejection", b)
		}
	}
}
