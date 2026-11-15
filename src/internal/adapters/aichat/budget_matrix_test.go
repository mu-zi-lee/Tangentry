package aichat

import (
	"context"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

// matrixSource is a minimal PassageSource serving a generated article.
type matrixSource struct{ snap retrieval.Snapshot }

func (m *matrixSource) Snapshot(ctx context.Context, contentID string) (retrieval.Snapshot, error) {
	return m.snap, nil
}
func (m *matrixSource) ReadRange(ctx context.Context, contentID, locator string, start, end int) (string, string, error) {
	return retrieval.SnapshotRange(m.snap, locator, start, end)
}

// buildMatrixFixture builds an article of n single-sentence segments (each
// >=200 runes so one sentence = one segment). 100 segments contain the query
// term and are placed at indices NOT sampled by the sweep for S=90 or S=87,
// so the lexical and sweep candidate sets are disjoint (full quota).
func buildMatrixFixture(t *testing.T, n int) retrieval.Snapshot {
	t.Helper()
	sampled := map[int]bool{}
	for _, s := range []int{90, 87} {
		for k := 0; k < s; k++ {
			sampled[k*n/s] = true
		}
	}
	var lexicalIdx []int
	for i := 0; i < n && len(lexicalIdx) < 100; i++ {
		if !sampled[i] {
			lexicalIdx = append(lexicalIdx, i)
		}
	}
	if len(lexicalIdx) < 100 {
		t.Fatalf("not enough non-sampled indices: %d", len(lexicalIdx))
	}
	lexicalSet := map[int]bool{}
	for _, i := range lexicalIdx {
		lexicalSet[i] = true
	}
	blocks := make([]retrieval.Block, n)
	for i := 0; i < n; i++ {
		var text string
		if lexicalSet[i] {
			text = "量子退相干机制记录" + strings.Repeat("证", 200) + "。"
		} else {
			text = strings.Repeat("背", 200) + "。"
		}
		blocks[i] = retrieval.Block{Index: i, Kind: "paragraph", Text: text}
	}
	return retrieval.Snapshot{ContentID: "fixture:matrix", Kind: retrieval.SourceArticle, Version: "content-revision:1", Blocks: blocks}
}

// TestBT33_ModeMatrix: the full cold-cache mode matrix through the real
// selector + adapter + fake transport. Asserts the mode-specific slot budget,
// sweep/lexical allocation, the exact request count, requests <= R, and that
// split never mixes query/document in one request.
func TestBT33_ModeMatrix(t *testing.T) {
	snap := buildMatrixFixture(t, 400)
	rows := []struct {
		name       string
		mode       retrieval.BatchingMode
		r          int
		slotBudget int
		sweep      int
		lexical    int
		requests   int // exact for full-quota rows; -1 = assert formula only
	}{
		{"shared_R0", retrieval.BatchingShared, 0, 0, 0, 0, 0},
		{"shared_R1", retrieval.BatchingShared, 1, 7, 3, 4, 1},
		{"shared_R24", retrieval.BatchingShared, 24, 191, 90, 100, 24},
		{"split_R0", retrieval.BatchingSplit, 0, 0, 0, 0, 0},
		{"split_R1", retrieval.BatchingSplit, 1, 0, 0, 0, 0},
		{"split_R24", retrieval.BatchingSplit, 24, 184, 87, 97, 24},
		{"split_R25", retrieval.BatchingSplit, 25, 192, 90, 100, 25},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			et := newEmbedTransport(t, 4, "bge-m3")
			s := et.settings(retrieval.SurfaceOpenAICompatible)
			if row.mode == retrieval.BatchingSplit {
				s.Surface = retrieval.SurfaceDashScope
				s.ProviderKind = retrieval.ProviderBailian
			}
			s.MaxEmbeddingRequests = row.r
			bt := retrieval.NewBudgetTracker(row.r, 100000)
			emb := NewEmbeddingClient(s, bt, nil)
			cfg := retrieval.SelectorConfig{
				TopK:                100,
				Sweep:               retrieval.SweepConfig{Enabled: true, SweepCandidates: 90},
				Budget:              retrieval.BudgetConfig{Mode: row.mode, MaxRequests: row.r, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000},
				Weights:             retrieval.DefaultWeights(),
				AssemblyBudgetRunes: retrieval.DefaultBudgetRunes,
				MaxBytes:            retrieval.DefaultMaxBytes,
				Mode:                retrieval.ModeHybrid,
			}
			sel := retrieval.NewSelector(&matrixSource{snap: snap}, emb, cfg)
			got, err := sel.Select(context.Background(), snap.ContentID, "量子退相干", 0)
			if err != nil {
				t.Fatal(err)
			}
			if got.SlotBudget != row.slotBudget {
				t.Fatalf("slotBudget = %d, want %d", got.SlotBudget, row.slotBudget)
			}
			if got.Sweep.Slots != row.sweep || got.LexicalSlots != row.lexical {
				t.Fatalf("sweep/lexical slots = %d/%d, want %d/%d", got.Sweep.Slots, got.LexicalSlots, row.sweep, row.lexical)
			}
			requests := et.count()
			if row.r == 0 || row.slotBudget == 0 {
				if requests != 0 {
					t.Fatalf("zero capacity must make 0 requests, got %d", requests)
				}
				if got.Status != retrieval.SelectionLexicalOnly && got.Status != retrieval.SelectionNoMatch {
					t.Fatalf("zero capacity status = %s", got.Status)
				}
				return
			}
			c := got.LexicalSelected + got.Sweep.Sampled
			want := retrieval.ColdCacheRequests(row.mode, c, 8)
			if requests != want {
				t.Fatalf("requests = %d, want formula %d (C=%d)", requests, want, c)
			}
			if row.requests >= 0 && requests != row.requests {
				t.Fatalf("requests = %d, want exact %d (C=%d)", requests, row.requests, c)
			}
			if requests > row.r {
				t.Fatalf("requests %d exceed maxEmbeddingRequests %d", requests, row.r)
			}
			// Split never mixes query and document in one request.
			if row.mode == retrieval.BatchingSplit {
				for _, req := range et.snapshot() {
					if req.TextType != "query" && req.TextType != "document" {
						t.Fatalf("split request must have a single text_type: %+v", req)
					}
					if req.TextType == "query" && len(req.Texts) != 1 {
						t.Fatalf("query request must carry only the question: %+v", req)
					}
				}
			}
		})
	}
}

// TestBT33_InvalidAndDisabled: -1 → invalid_budget before any request;
// sweepCandidates=0 → semantic_sweep_limited with sweep_disabled_by_config.
func TestBT33_InvalidAndDisabled(t *testing.T) {
	snap := buildMatrixFixture(t, 400)
	// Negative request budget.
	et := newEmbedTransport(t, 4, "bge-m3")
	bt := retrieval.NewBudgetTracker(0, 100000)
	emb := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), bt, nil)
	cfg := retrieval.SelectorConfig{
		TopK: 100, Sweep: retrieval.SweepConfig{Enabled: true, SweepCandidates: 90},
		Budget:              retrieval.BudgetConfig{Mode: retrieval.BatchingShared, MaxRequests: -1, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000},
		Weights:             retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes, Mode: retrieval.ModeHybrid,
	}
	sel := retrieval.NewSelector(&matrixSource{snap: snap}, emb, cfg)
	got, err := sel.Select(context.Background(), snap.ContentID, "量子退相干", 0)
	if err != nil || got.Status != retrieval.SelectionInvalidBudget || et.count() != 0 {
		t.Fatalf("invalid budget: status=%s requests=%d err=%v", got.Status, et.count(), err)
	}
	// sweepCandidates=0 → deliberate opt-out label.
	et2 := newEmbedTransport(t, 4, "bge-m3")
	emb2 := NewEmbeddingClient(et2.settings(retrieval.SurfaceOpenAICompatible), retrieval.NewBudgetTracker(24, 100000), nil)
	cfg2 := cfg
	cfg2.Budget.MaxRequests = 24
	cfg2.Budget.SweepCandidates = 0
	cfg2.Sweep.SweepCandidates = 0
	sel2 := retrieval.NewSelector(&matrixSource{snap: snap}, emb2, cfg2)
	got2, err := sel2.Select(context.Background(), snap.ContentID, "量子退相干", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got2.Sweep.ZeroReason != retrieval.SweepReasonDisabledByConfig {
		t.Fatalf("zero reason = %q, want sweep_disabled_by_config", got2.Sweep.ZeroReason)
	}
	if got2.Sweep.Used || got2.Sweep.Sampled != 0 {
		t.Fatalf("disabled sweep must sample nothing: %+v", got2.Sweep)
	}
}

// TestBT33_CharBound: when maxEmbeddingChars binds before slots, both shares
// shrink proportionally and the sweep still receives >= one passage.
func TestBT33_CharBound(t *testing.T) {
	snap := buildMatrixFixture(t, 400)
	et := newEmbedTransport(t, 4, "bge-m3")
	emb := NewEmbeddingClient(et.settings(retrieval.SurfaceOpenAICompatible), retrieval.NewBudgetTracker(24, 3000), nil)
	cfg := retrieval.SelectorConfig{
		TopK: 100, Sweep: retrieval.SweepConfig{Enabled: true, SweepCandidates: 90},
		Budget:              retrieval.BudgetConfig{Mode: retrieval.BatchingShared, MaxRequests: 24, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 3000},
		Weights:             retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes, Mode: retrieval.ModeHybrid,
	}
	sel := retrieval.NewSelector(&matrixSource{snap: snap}, emb, cfg)
	got, err := sel.Select(context.Background(), snap.ContentID, "量子退相干", 0)
	if err != nil {
		t.Fatal(err)
	}
	// Char budget (3000 - question) binds; sweep chars shrink below default.
	if got.Sweep.Chars >= 47368 {
		t.Fatalf("sweep chars must shrink under char pressure: %d", got.Sweep.Chars)
	}
	if got.CharBudget != 3000-retrieval.RuneLen("量子退相干") {
		t.Fatalf("charBudget = %d", got.CharBudget)
	}
	// Sweep still gets >= one passage while lexical candidates are embedded.
	if got.LexicalSelected > 0 && got.Sweep.Sampled < 1 {
		t.Fatal("char pressure must not starve the sweep to zero")
	}
	if et.count() > 24 {
		t.Fatalf("requests exceed budget: %d", et.count())
	}
}
