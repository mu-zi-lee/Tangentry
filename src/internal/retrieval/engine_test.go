package retrieval

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// engineArticle builds a small article whose blocks share the question terms.
func engineArticle(blocks int) Snapshot {
	snap := Snapshot{
		ContentID: "fixture:engine",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
	}
	for i := 0; i < blocks; i++ {
		snap.Blocks = append(snap.Blocks, Block{Index: i, Kind: "paragraph", Text: "答案证据文本段落。"})
	}
	return snap
}

// TestEngineExplicitZeroDisablesEmbedding: the wire request
// embeddingBudget.maxRequests=0 is preserved (zero = off), never replaced by
// the 24/25 default: zero embedder calls and a disabled budget status. Hybrid
// keeps the lexical fallback passages; embedding-only has no evidence path
// and reports the terminal no_match (still zero embedding requests).
func TestEngineExplicitZeroDisablesEmbedding(t *testing.T) {
	for _, tc := range []struct {
		mode       string
		wantErr    bool
		wantStatus string
	}{
		{"hybrid", false, string(SelectionLexicalOnly)},
		{"embedding", true, string(SelectionNoMatch)},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			var req Request
			body := `{"schemaVersion":1,"enabled":true,"mode":"` + tc.mode + `","embeddingBudget":{"maxRequests":0}}`
			if err := json.Unmarshal([]byte(body), &req); err != nil {
				t.Fatal(err)
			}
			if req.EmbeddingBudget.MaxRequests == nil || *req.EmbeddingBudget.MaxRequests != 0 {
				t.Fatalf("explicit zero must decode to a present 0: %+v", req.EmbeddingBudget.MaxRequests)
			}
			src := &fakeSource{snap: engineArticle(4)}
			emb := newFakeEmbedder(BatchingShared)
			engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler()}
			result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
			}
			if result.Response.Status != tc.wantStatus {
				t.Fatalf("status = %s, want %s", result.Response.Status, tc.wantStatus)
			}
			if emb.requestCount() != 0 {
				t.Fatalf("explicit zero started %d embedding requests, want 0", emb.requestCount())
			}
			if result.Response.Embedding.BudgetStatus != BudgetDisabled || result.Response.Embedding.Requests != 0 {
				t.Fatalf("embedding summary: %+v", result.Response.Embedding)
			}
			if !tc.wantErr && len(result.Response.Passages) == 0 {
				t.Fatal("lexical fallback must still return passages")
			}
		})
	}
}

// TestEngineOmittedBudgetUsesDefaults: an omitted maxRequests keeps the
// mode-aware default (24 shared / 25 split) and embedding runs.
func TestEngineOmittedBudgetUsesDefaults(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode BatchingMode
		body string
	}{
		{"shared", BatchingShared, `{"schemaVersion":1,"enabled":true,"mode":"hybrid"}`},
		{"split", BatchingSplit, `{"schemaVersion":1,"enabled":true,"mode":"hybrid","embeddingBudget":{"batchingMode":"split"}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var req Request
			if err := json.Unmarshal([]byte(tc.body), &req); err != nil {
				t.Fatal(err)
			}
			if req.EmbeddingBudget.MaxRequests != nil {
				t.Fatal("omitted maxRequests must stay nil")
			}
			src := &fakeSource{snap: engineArticle(4)}
			emb := newFakeEmbedder(tc.mode)
			engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler()}
			result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
			if err != nil {
				t.Fatal(err)
			}
			if emb.requestCount() == 0 {
				t.Fatal("omitted budget must use the default and embed")
			}
			if result.Response.Embedding.BudgetStatus == BudgetDisabled {
				t.Fatalf("omitted budget must not be disabled: %+v", result.Response.Embedding)
			}
		})
	}
}

// TestEngineExplicitPositiveBudgetRespected: an explicit small limit shapes
// the allocation (slot budget R*B-1) instead of being replaced by the
// default: limit 1 admits at most 7 candidates and one shared batch, where
// the default 24 would embed the full 20-block union in three batches.
func TestEngineExplicitPositiveBudgetRespected(t *testing.T) {
	var req Request
	body := `{"schemaVersion":1,"enabled":true,"mode":"hybrid","embeddingBudget":{"maxRequests":1}}`
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatal(err)
	}
	snap := engineArticle(0)
	for i := 0; i < 20; i++ {
		snap.Blocks = append(snap.Blocks, Block{Index: i, Kind: "paragraph", Text: "答案证据文本段落编号" + string(rune('A'+i)) + "。"})
	}
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler()}
	result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatal(err)
	}
	if emb.requestCount() != 1 || result.Response.Embedding.Requests != 1 {
		t.Fatalf("explicit limit 1: embedder=%d summary=%d", emb.requestCount(), result.Response.Embedding.Requests)
	}
	if len(result.Response.Passages) == 0 || len(result.Response.Passages) > 7 {
		t.Fatalf("explicit limit 1 must admit at most slotBudget=7 candidates, got %d passages", len(result.Response.Passages))
	}
}

// TestEngineNegativeBudgetRejected: a negative explicit maxRequests is
// invalid_budget before any work.
func TestEngineNegativeBudgetRejected(t *testing.T) {
	var req Request
	if err := json.Unmarshal([]byte(`{"enabled":true,"embeddingBudget":{"maxRequests":-1}}`), &req); err != nil {
		t.Fatal(err)
	}
	src := &fakeSource{snap: engineArticle(2)}
	emb := newFakeEmbedder(BatchingShared)
	engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler()}
	result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
	if err == nil || result.Response.Status != string(SelectionInvalidBudget) {
		t.Fatalf("negative budget: status=%s err=%v", result.Response.Status, err)
	}
	if emb.requestCount() != 0 {
		t.Fatal("invalid budget must start zero embedding requests")
	}
}

// TestEngineSetEmbedderRuntimeSwap: saved settings swap the adapter without a
// restart; each run uses the adapter present at its start.
func TestEngineSetEmbedderRuntimeSwap(t *testing.T) {
	src := &fakeSource{snap: engineArticle(2)}
	first := newFakeEmbedder(BatchingShared)
	engine := &Engine{Source: src, Embedder: first, Assembler: NewContextAssembler()}
	req := Request{SchemaVersion: 1, Enabled: true, Mode: ModeHybrid}
	if _, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req}); err != nil {
		t.Fatal(err)
	}
	if first.requestCount() == 0 {
		t.Fatal("first adapter must be used")
	}
	second := newFakeEmbedder(BatchingShared)
	second.model = "replacement-model"
	engine.SetEmbedder(second)
	result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatal(err)
	}
	if second.requestCount() == 0 || result.Response.Embedding.Model != "replacement-model" {
		t.Fatalf("swapped adapter not used: %+v", result.Response.Embedding)
	}
	engine.SetEmbedder(nil)
	result, err = engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatal(err)
	}
	if result.Response.Embedding.BudgetStatus != BudgetDisabled || !strings.Contains(result.Context, "答案证据") {
		t.Fatalf("nil adapter must fall back to lexical: %+v", result.Response.Embedding)
	}
}

// frontendRequest is the ordinary UI request shape (defaultRetrievalRequest):
// the client supplies its own 24 requests / 100000 chars defaults.
func frontendRequest(t *testing.T) Request {
	t.Helper()
	var req Request
	body := `{"schemaVersion":1,"enabled":true,"mode":"hybrid","maxChars":120000,"embeddingBudget":{"batchingMode":"shared","maxRequests":24,"maxChars":100000,"sweepCandidates":90},"rerankBudget":{"maxRequests":0}}`
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatal(err)
	}
	return req
}

// distinctArticle builds blocks with distinct texts (dedupe keeps them all).
func distinctArticle(blocks int) Snapshot {
	snap := Snapshot{ContentID: "fixture:engine", Kind: SourceArticle, Version: "content-revision:1"}
	for i := 0; i < blocks; i++ {
		snap.Blocks = append(snap.Blocks, Block{Index: i, Kind: "paragraph", Text: "答案证据文本段落编号" + string(rune('A'+i)) + "。"})
	}
	return snap
}

// TestResolveRunBudgetPrecedence: saved settings are the baseline; explicit
// request overrides may only tighten them, and a saved 0 (off) is never
// re-enabled by the client's defaults. Without saved settings the built-in
// mode-aware defaults and as-is request values apply.
func TestResolveRunBudgetPrecedence(t *testing.T) {
	ptr := func(v int) *int { return &v }
	saved := DefaultEmbeddingSettings()
	for _, tc := range []struct {
		name        string
		saved       *EmbeddingSettings
		mode        BatchingMode
		wire        EmbeddingBudgetWire
		wantReqs    int
		wantChars   int
		wantBatch   int
		wantTopK    int
		wantLexical float64
	}{
		{"no settings omitted shared", nil, BatchingShared, EmbeddingBudgetWire{}, 24, 100000, 8, 100, 0.35},
		{"no settings omitted split", nil, BatchingSplit, EmbeddingBudgetWire{}, 25, 100000, 8, 100, 0.35},
		{"no settings explicit zero", nil, BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(0)}, 0, 100000, 8, 100, 0.35},
		{"no settings explicit values", nil, BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(3), MaxChars: 500}, 3, 500, 8, 100, 0.35},
		{"saved zero beats frontend default", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingRequests = 0; return &s }(), BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(24), MaxChars: 100000}, 0, 100000, 8, 100, 0.35},
		{"saved limit caps frontend default", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingRequests = 2; return &s }(), BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(24), MaxChars: 100000}, 2, 100000, 8, 100, 0.35},
		{"request tightens saved limit", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingRequests = 24; return &s }(), BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(1)}, 1, 100000, 8, 100, 0.35},
		{"omitted request keeps saved limit", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingRequests = 5; return &s }(), BatchingSplit, EmbeddingBudgetWire{}, 5, 100000, 8, 100, 0.35},
		{"saved chars cap frontend default", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingChars = 5000; return &s }(), BatchingShared, EmbeddingBudgetWire{MaxRequests: ptr(24), MaxChars: 100000}, 24, 5000, 8, 100, 0.35},
		{"request chars tighten saved", func() *EmbeddingSettings { s := saved; s.MaxEmbeddingChars = 5000; return &s }(), BatchingShared, EmbeddingBudgetWire{MaxChars: 900}, 24, 900, 8, 100, 0.35},
		{"saved batch and topK", func() *EmbeddingSettings { s := saved; s.BatchSize = 4; s.TopK = 40; return &s }(), BatchingShared, EmbeddingBudgetWire{}, 24, 100000, 4, 40, 0.35},
		{"saved weights normalized", func() *EmbeddingSettings { s := saved; s.LexicalWeight = 0.9; s.EmbeddingWeight = 0.1; return &s }(), BatchingShared, EmbeddingBudgetWire{}, 24, 100000, 8, 100, 0.9},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveRunBudget(tc.saved, tc.mode, tc.wire)
			if got.maxRequests != tc.wantReqs || got.embChars != tc.wantChars || got.batchSize != tc.wantBatch || got.topK != tc.wantTopK {
				t.Fatalf("budget = %+v, want requests=%d chars=%d batch=%d topK=%d", got, tc.wantReqs, tc.wantChars, tc.wantBatch, tc.wantTopK)
			}
			if got.weights.Lexical != tc.wantLexical {
				t.Fatalf("lexical weight = %v, want %v", got.weights.Lexical, tc.wantLexical)
			}
		})
	}
}

// TestEngineSavedSettingsZeroDisablesEmbedding: saving maxEmbeddingRequests=0
// turns embedding off for the ordinary frontend request (which supplies its
// own default 24 requests / 100000 chars): zero embedder calls, a disabled
// budget summary, and the lexical fallback still returns passages.
func TestEngineSavedSettingsZeroDisablesEmbedding(t *testing.T) {
	src := &fakeSource{snap: engineArticle(4)}
	emb := newFakeEmbedder(BatchingShared)
	saved := DefaultEmbeddingSettings()
	saved.MaxEmbeddingRequests = 0
	engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(), Settings: &saved}
	result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: frontendRequest(t)})
	if err != nil {
		t.Fatal(err)
	}
	if emb.requestCount() != 0 {
		t.Fatalf("saved zero started %d embedding requests, want 0", emb.requestCount())
	}
	if result.Response.Status != string(SelectionLexicalOnly) || result.Response.Embedding.BudgetStatus != BudgetDisabled || result.Response.Embedding.Requests != 0 {
		t.Fatalf("saved zero must disable embedding: %+v", result.Response)
	}
	if len(result.Response.Passages) == 0 {
		t.Fatal("lexical fallback must still return passages")
	}
}

// TestEngineSavedLimitsShapeRun: the saved request limit, batch size, topK
// and character budget shape the actual invocation instead of the engine's
// former hardcoded 24/8/100/100000.
func TestEngineSavedLimitsShapeRun(t *testing.T) {
	t.Run("requests and batch capped", func(t *testing.T) {
		src := &fakeSource{snap: distinctArticle(20)}
		emb := newFakeEmbedder(BatchingShared)
		saved := DefaultEmbeddingSettings()
		saved.MaxEmbeddingRequests = 2
		saved.BatchSize = 2
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(), Settings: &saved}
		result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: frontendRequest(t)})
		if err != nil {
			t.Fatal(err)
		}
		// slotBudget = 2*2-1 = 3 candidates → question + 3 texts in batches
		// of 2 → exactly 2 requests; the frontend's 24/8 never applies.
		if emb.requestCount() != 2 || result.Response.Embedding.Requests != 2 {
			t.Fatalf("saved limit 2: embedder=%d summary=%d", emb.requestCount(), result.Response.Embedding.Requests)
		}
		for i, call := range emb.calls {
			if len(call.Texts) > 2 {
				t.Fatalf("call %d sent %d texts, saved batchSize is 2", i, len(call.Texts))
			}
		}
		if len(result.Response.Passages) == 0 || len(result.Response.Passages) > 3 {
			t.Fatalf("saved limit 2 must admit at most slotBudget=3 candidates, got %d passages", len(result.Response.Passages))
		}
	})
	t.Run("topK from saved settings", func(t *testing.T) {
		src := &fakeSource{snap: distinctArticle(30)}
		emb := newFakeEmbedder(BatchingShared)
		saved := DefaultEmbeddingSettings()
		saved.TopK = 20
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(), Settings: &saved}
		// Omitted embeddingBudget: no sweep, the saved topK caps the
		// lexical shortlist (the hardcoded 100 would admit all 30).
		req := Request{SchemaVersion: 1, Enabled: true, Mode: ModeHybrid}
		result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Response.Passages) != 20 {
			t.Fatalf("saved topK 20 must cap the shortlist, got %d passages", len(result.Response.Passages))
		}
	})
	t.Run("chars from saved settings", func(t *testing.T) {
		src := &fakeSource{snap: distinctArticle(4)}
		emb := newFakeEmbedder(BatchingShared)
		saved := DefaultEmbeddingSettings()
		saved.MaxEmbeddingChars = 27
		engine := &Engine{Source: src, Embedder: emb, Assembler: NewContextAssembler(), Settings: &saved}
		result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: frontendRequest(t)})
		if err != nil {
			t.Fatal(err)
		}
		// charBudget = 27 - question(4) = 23, split 10 sweep / 13 lexical:
		// one 12-rune block fits the lexical share, the second does not,
		// and no block fits the sweep share; the frontend's 100000 never
		// applies (it would admit all four blocks).
		if len(result.Response.Passages) != 1 {
			t.Fatalf("saved char budget must constrain candidates, got %d passages", len(result.Response.Passages))
		}
	})
}

// TestEngineSavedWeightsChangeRanking: the saved scoring weights are used by
// the hybrid score. The lexical-heavy block outranks the embedding-only
// block under saved 0.9/0.1 weights, while the built-in 0.35/0.65 defaults
// rank the embedding match first.
func TestEngineSavedWeightsChangeRanking(t *testing.T) {
	snap := Snapshot{ContentID: "fixture:engine", Kind: SourceArticle, Version: "content-revision:1"}
	snap.Blocks = []Block{
		{Index: 0, Kind: "paragraph", Text: "答案证据答案证据答案证据。"},
		{Index: 1, Kind: "paragraph", Text: "黄金标记无关内容段落。"},
	}
	run := func(settings *EmbeddingSettings) []PassageRef {
		emb := newFakeEmbedder(BatchingShared)
		emb.goldMarkers = []string{"黄金标记"}
		engine := &Engine{Source: &fakeSource{snap: snap}, Embedder: emb, Assembler: NewContextAssembler(), Settings: settings}
		result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: frontendRequest(t)})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Response.Passages) != 2 {
			t.Fatalf("both blocks must be selected (lexical + sweep): %+v", result.Response.Passages)
		}
		return result.Response.Passages
	}
	defaults := run(nil)
	if !strings.HasPrefix(defaults[0].Locator, "article:1:") {
		t.Fatalf("default weights must rank the embedding match first: %+v", defaults)
	}
	saved := DefaultEmbeddingSettings()
	saved.LexicalWeight = 0.9
	saved.EmbeddingWeight = 0.1
	weighted := run(&saved)
	if !strings.HasPrefix(weighted[0].Locator, "article:0:") {
		t.Fatalf("saved lexical-heavy weights must rank the lexical match first: %+v", weighted)
	}
}

// TestEngineApplySettingsRuntimeSwap: a settings save swaps the operational
// settings and the adapter together without a restart; the next run uses
// both (here: a saved zero disables the freshly swapped adapter).
func TestEngineApplySettingsRuntimeSwap(t *testing.T) {
	src := &fakeSource{snap: engineArticle(2)}
	first := newFakeEmbedder(BatchingShared)
	engine := &Engine{Source: src, Embedder: first, Assembler: NewContextAssembler()}
	req := frontendRequest(t)
	if _, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req}); err != nil {
		t.Fatal(err)
	}
	if first.requestCount() == 0 {
		t.Fatal("first adapter must be used")
	}
	second := newFakeEmbedder(BatchingShared)
	second.model = "replacement-model"
	saved := DefaultEmbeddingSettings()
	saved.MaxEmbeddingRequests = 0
	engine.ApplySettings(&saved, second)
	result, err := engine.Run(context.Background(), RunInput{ContentID: "fixture:engine", Question: "答案证据", Request: req})
	if err != nil {
		t.Fatal(err)
	}
	if second.requestCount() != 0 || result.Response.Embedding.BudgetStatus != BudgetDisabled {
		t.Fatalf("applied zero must disable the swapped adapter: %+v", result.Response.Embedding)
	}
	if result.Response.Embedding.Model != "replacement-model" {
		t.Fatalf("swapped adapter identity lost: %+v", result.Response.Embedding)
	}
}
