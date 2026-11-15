package retrieval

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestBT02_MiddleAnswer: fixed 156,032-rune article, gold at ~78,000, budget
// 120,000: hybrid selects the gold passage; the original head/tail baseline
// misses it on the same fixture and budget.
func TestBT02_MiddleAnswer(t *testing.T) {
	source, gold, offset := fixture156k(t)
	snap := Snapshot{
		ContentID: "fixture:article-mid",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks:    []Block{{Index: 0, Kind: "paragraph", Text: source}},
	}
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	emb.goldMarkers = []string{gold}
	cfg := defaultSelectorConfig()
	sel := NewSelector(src, emb, cfg)
	got, err := sel.Select(context.Background(), snap.ContentID, "中段检索目标是什么？", 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range got.Passages {
		if strings.Contains(p.Text, gold) {
			found = true
			if p.Source != SourceArticle || p.ContentID != snap.ContentID {
				t.Fatalf("bad provenance: %+v", p)
			}
			if p.TextSHA256 != TextSHA256(p.Text) {
				t.Fatal("hash mismatch")
			}
		}
	}
	if !found {
		t.Fatalf("hybrid missed the gold passage (status=%s, passages=%d, offset=%d)", got.Status, len(got.Passages), offset)
	}
	// The original baseline misses the gold on the same fixture/budget.
	baseline := baselineBuildContext(source, 120000)
	if strings.Contains(baseline, gold) {
		t.Fatal("baseline unexpectedly contains the gold (fixture changed?)")
	}
	if len(baseline) <= DefaultMaxBytes {
		t.Fatalf("baseline byte-cap fixture changed: %d bytes", len(baseline))
	}
}

// TestBT06_Dedupe: same sentence twice and same cue text in two languages →
// one normalized duplicate retained; deterministic across two runs.
func TestBT06_Dedupe(t *testing.T) {
	snap := Snapshot{
		ContentID: "fixture:dup",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks: []Block{
			{Index: 0, Kind: "paragraph", Text: "重复的句子。"},
			{Index: 1, Kind: "paragraph", Text: "重复的句子。"},
			{Index: 2, Kind: "paragraph", Text: "不同的内容。"},
		},
	}
	src := &fakeSource{snap: snap}
	sel := NewSelector(src, nil, defaultSelectorConfig())
	got, err := sel.Select(context.Background(), snap.ContentID, "重复的句子", 0)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, p := range got.Passages {
		if p.Text == "重复的句子。" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("duplicate retained %d times, want 1", count)
	}

	// Same cue text in two languages → one retained.
	cueText := "完全相同的字幕内容"
	mkTrack := func(lang string) SubtitleTrack {
		var cues []Cue
		for i := 0; i < 4; i++ {
			cues = append(cues, Cue{ID: lang + string(rune('0'+i)), Language: lang, StartMs: int64(i * 2000), EndMs: int64(i*2000 + 1900), Text: cueText})
		}
		return SubtitleTrack{Language: lang, Revision: 1, Cues: cues}
	}
	subSnap := Snapshot{
		ContentID: "fixture:dup-sub", Kind: SourceSubtitle,
		Tracks: []SubtitleTrack{mkTrack("zh"), mkTrack("en")},
	}
	src2 := &fakeSource{snap: subSnap}
	sel2 := NewSelector(src2, nil, defaultSelectorConfig())
	got2, err := sel2.Select(context.Background(), subSnap.ContentID, "完全相同的字幕内容", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got2.Passages) != 1 {
		t.Fatalf("cross-language duplicate retained %d times, want 1", len(got2.Passages))
	}

	// Two runs byte-identical.
	a, _ := sel.Select(context.Background(), snap.ContentID, "重复的句子", 0)
	b, _ := sel.Select(context.Background(), snap.ContentID, "重复的句子", 0)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Fatal("non-deterministic selection across runs")
	}
}

// TestBT39_ZeroOverlapDegenerateLexical: gold middle passage shares no query
// term; lexical shortlist has zero coverage; the unconditional sweep still
// places the gold in the embedded set and hybrid selects it; lexical-only
// misses it. Exact sampled index set, stride, coverage and request count.
func TestBT39_ZeroOverlapDegenerateLexical(t *testing.T) {
	snap, gold, goldIdx := buildZeroOverlapArticle(t, true, 0)
	if RuneLen(snap.Blocks[0].Text) != 156000 {
		t.Fatalf("fixture total = %d, want 156000", RuneLen(snap.Blocks[0].Text))
	}
	terms := QueryTerms(questionZeroOverlap)
	if r := ScoreLexical(questionZeroOverlap, terms, gold); r.Coverage != 0 {
		t.Fatalf("gold shares query terms: %+v", r)
	}
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	emb.goldMarkers = []string{"环境诱导的相位随机化"}
	sel := NewSelector(src, emb, defaultSelectorConfig())
	got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.LexicalSelected != 0 || got.LexicalCoverage != 0 {
		t.Fatalf("lexical stage must be degenerate: selected=%d coverage=%d", got.LexicalSelected, got.LexicalCoverage)
	}
	if !got.Sweep.Used {
		t.Fatal("sweep must run unconditionally")
	}
	// Exact sampled index set / stride / coverage.
	s := &selector{cfg: defaultSelectorConfig().withDefaults()}
	cands, _ := s.segments(snap, DefaultMaxSegmentRunes)
	n := len(cands)
	sample := SampleSweep(n, 90)
	if got.Sweep.Sampled != 90 {
		t.Fatalf("Sampled = %d, want 90", got.Sweep.Sampled)
	}
	if got.Sweep.Stride != sample.Stride {
		t.Fatalf("Stride = %d, want %d", got.Sweep.Stride, sample.Stride)
	}
	if got.Sweep.Coverage != float64(90)/float64(n) {
		t.Fatalf("Coverage = %v, want %v", got.Sweep.Coverage, float64(90)/float64(n))
	}
	if !got.Sweep.Limited {
		t.Fatal("S < N must report Limited")
	}
	// Gold is in the sampled set and selected by hybrid.
	onSample := false
	for _, idx := range sample.Indices {
		if idx == goldIdx {
			onSample = true
		}
	}
	if !onSample {
		t.Fatal("fixture construction failed: gold not sampled")
	}
	found := false
	for _, p := range got.Passages {
		if strings.Contains(p.Text, "环境诱导的相位随机化") {
			found = true
		}
	}
	if !found {
		t.Fatalf("hybrid missed the zero-overlap gold (status=%s)", got.Status)
	}
	if got.Status != SelectionSweepLimited {
		t.Fatalf("status = %q, want semantic_sweep_limited", got.Status)
	}
	// Shared-mode cold-cache request count: ceil((1+C)/B) with C=90, B=8.
	// The question shares the document batches (no separate query request).
	wantCalls := (1 + 90 + 7) / 8
	if emb.requestCount() != wantCalls {
		t.Fatalf("embed calls = %d, want %d", emb.requestCount(), wantCalls)
	}
	if !emb.embeddedQuestion() {
		t.Fatal("question must be embedded")
	}
	// Lexical-only misses the gold entirely.
	selLex := NewSelector(&fakeSource{snap: snap}, nil, defaultSelectorConfig())
	gotLex, err := selLex.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil {
		t.Fatal(err)
	}
	if gotLex.Status != SelectionNoMatch || len(gotLex.Passages) != 0 {
		t.Fatalf("lexical-only must miss: status=%s passages=%d", gotLex.Status, len(gotLex.Passages))
	}
}

// TestBT40_DistractorSaturated: full lexical shortlist of query-term
// distractors never suppresses the sweep.
func TestBT40_DistractorSaturated(t *testing.T) {
	t.Run("A_gold_on_sample", func(t *testing.T) {
		snap, _, goldIdx := buildZeroOverlapArticle(t, true, 24)
		src := &fakeSource{snap: snap}
		emb := newFakeEmbedder(BatchingShared)
		emb.goldMarkers = []string{"环境诱导的相位随机化"}
		sel := NewSelector(src, emb, defaultSelectorConfig())
		got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
		if err != nil {
			t.Fatal(err)
		}
		if got.LexicalSelected < 20 {
			t.Fatalf("LexicalSelected = %d, want >= 20", got.LexicalSelected)
		}
		if got.LexicalCoverage == 0 {
			t.Fatal("best distractor must have nonzero coverage (no trigger condition holds)")
		}
		if !got.Sweep.Used {
			t.Fatal("sweep must run even with a full lexical shortlist")
		}
		if got.Sweep.Slots != 90 || got.LexicalSlots != 100 || got.SlotBudget != 191 {
			t.Fatalf("shares not reserved: sweep=%d lexical=%d slotBudget=%d", got.Sweep.Slots, got.LexicalSlots, got.SlotBudget)
		}
		s := &selector{cfg: defaultSelectorConfig().withDefaults()}
		cands, _ := s.segments(snap, DefaultMaxSegmentRunes)
		sample := SampleSweep(len(cands), 90)
		onSample := false
		for _, idx := range sample.Indices {
			if idx == goldIdx {
				onSample = true
			}
		}
		if !onSample {
			t.Fatal("variant A requires gold on a sampled index")
		}
		found := false
		for _, p := range got.Passages {
			if strings.Contains(p.Text, "环境诱导的相位随机化") {
				found = true
			}
		}
		if !found {
			t.Fatal("hybrid must select the sampled gold")
		}
		// Lexical-only misses the gold.
		selLex := NewSelector(&fakeSource{snap: snap}, nil, defaultSelectorConfig())
		gotLex, _ := selLex.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
		for _, p := range gotLex.Passages {
			if strings.Contains(p.Text, "环境诱导的相位随机化") {
				t.Fatal("lexical-only must miss the zero-overlap gold")
			}
		}
	})

	t.Run("B_gold_off_sample", func(t *testing.T) {
		snap, _, _ := buildZeroOverlapArticle(t, false, 24)
		src := &fakeSource{snap: snap}
		emb := newFakeEmbedder(BatchingShared)
		emb.goldMarkers = []string{"环境诱导的相位随机化"}
		sel := NewSelector(src, emb, defaultSelectorConfig())
		got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != SelectionSweepLimited {
			t.Fatalf("status = %q, want semantic_sweep_limited (coverage limitation)", got.Status)
		}
		if got.Status == SelectionNoMatch {
			t.Fatal("coverage limitation must never render as no_match")
		}
		if got.Sweep.Coverage >= 1 {
			t.Fatal("coverage must be < 1")
		}
		if len(got.Passages) == 0 {
			t.Fatal("valid selected passages must not be suppressed")
		}
		for _, p := range got.Passages {
			if strings.Contains(p.Text, "环境诱导的相位随机化") {
				t.Fatal("off-sample gold must not be selected")
			}
		}
	})

	t.Run("C_char_pressure", func(t *testing.T) {
		snap, _, _ := buildZeroOverlapArticle(t, true, 24)
		src := &fakeSource{snap: snap}
		emb := newFakeEmbedder(BatchingShared)
		emb.goldMarkers = []string{"环境诱导的相位随机化"}
		cfg := defaultSelectorConfig()
		cfg.Budget.MaxEmbeddingChars = 6000 // chars bind before the 191 slots
		sel := NewSelector(src, emb, cfg)
		got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
		if err != nil {
			t.Fatal(err)
		}
		// Both shares shrink proportionally with the char budget.
		wantCharBudget := 6000 - RuneLen(questionZeroOverlap)
		if got.CharBudget != wantCharBudget {
			t.Fatalf("CharBudget = %d, want %d", got.CharBudget, wantCharBudget)
		}
		wantSweepChars := wantCharBudget * 90 / 190
		if got.Sweep.Chars != wantSweepChars {
			t.Fatalf("Sweep.Chars = %d, want %d", got.Sweep.Chars, wantSweepChars)
		}
		if got.Sweep.Chars >= 47368 {
			t.Fatal("sweep char share must shrink under char pressure")
		}
		// The sweep still receives >= one passage and is never zeroed while
		// lexical candidates remain embedded.
		if got.LexicalSelected < 20 {
			t.Fatalf("lexical candidates lost: %d", got.LexicalSelected)
		}
		if got.Sweep.Sampled < 1 {
			t.Fatal("char pressure must not starve the sweep to zero")
		}
		if got.Sweep.ZeroReason != "" {
			t.Fatalf("unexpected zero reason %q", got.Sweep.ZeroReason)
		}
		// Char budget binds before slots: union < slot budget.
		if got.LexicalSelected+got.Sweep.Sampled >= got.SlotBudget {
			t.Fatal("char budget must bind before the slot budget in this fixture")
		}
	})
}

// TestBT21_PreflightZeroRequests: a budget below the mandatory minimum is
// rejected before candidate generation — zero embedding requests and the
// selector never enters the source. Invalid budgets likewise.
func TestBT21_PreflightZeroRequests(t *testing.T) {
	snap, _, _ := buildZeroOverlapArticle(t, true, 0)
	for _, tc := range []struct {
		name   string
		budget int
		status SelectionStatus
	}{
		{"below_minimum", MandatoryMinimumRunes() - 1, SelectionContextBudgetExceeded},
		{"zero", 0, SelectionInvalidBudget},
		{"negative", -5, SelectionInvalidBudget},
		{"above_max", 1000001, SelectionInvalidBudget},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeSource{snap: snap}
			emb := newFakeEmbedder(BatchingShared)
			cfg := defaultSelectorConfig()
			cfg.AssemblyBudgetRunes = tc.budget
			sel := NewSelector(src, emb, cfg)
			got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.status {
				t.Fatalf("status = %q, want %q", got.Status, tc.status)
			}
			if emb.requestCount() != 0 {
				t.Fatalf("embedding requests = %d, want 0", emb.requestCount())
			}
			if src.snapshotCalls != 0 {
				t.Fatal("selector entered the source before preflight rejection")
			}
		})
	}
	// Invalid embedding budget (-1) → invalid_budget before any request.
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	cfg := defaultSelectorConfig()
	cfg.Budget.MaxRequests = -1
	sel := NewSelector(src, emb, cfg)
	got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != SelectionInvalidBudget || emb.requestCount() != 0 || src.snapshotCalls != 0 {
		t.Fatalf("invalid embedding budget must reject before any work: %+v", got)
	}
}

// TestSelectorSweepDisabledByConfig: sweepCandidates=0 is a deliberate
// opt-out with its own label, distinct from budget-starved zero slots.
func TestSelectorSweepDisabledByConfig(t *testing.T) {
	snap, _, _ := buildZeroOverlapArticle(t, true, 0)
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	cfg := defaultSelectorConfig()
	cfg.Sweep.SweepCandidates = 0
	cfg.Budget.SweepCandidates = 0
	sel := NewSelector(src, emb, cfg)
	got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Sweep.ZeroReason != SweepReasonDisabledByConfig {
		t.Fatalf("ZeroReason = %q, want sweep_disabled_by_config", got.Sweep.ZeroReason)
	}
	if got.Sweep.Used || got.Sweep.Sampled != 0 || got.Sweep.Coverage != 0 {
		t.Fatalf("disabled sweep must sample nothing: %+v", got.Sweep)
	}
}

// TestSelectorNoMatch: unrelated question, no embedder → no_match, zero
// passages, zero provider calls, no head/tail fallback.
func TestSelectorNoMatch(t *testing.T) {
	source, _, _ := fixture156k(t)
	snap := Snapshot{
		ContentID: "fixture:article-mid", Kind: SourceArticle, Version: "content-revision:1",
		Blocks: []Block{{Index: 0, Kind: "paragraph", Text: source}},
	}
	src := &fakeSource{snap: snap}
	sel := NewSelector(src, nil, defaultSelectorConfig())
	got, err := sel.Select(context.Background(), snap.ContentID, "完全不相关的外星问题 xyzzy", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != SelectionNoMatch || len(got.Passages) != 0 {
		t.Fatalf("status=%s passages=%d, want no_match/0", got.Status, len(got.Passages))
	}
	if src.readCalls != 0 {
		t.Fatal("no verification reads expected for an empty candidate set")
	}
}

// TestSelectorEmptyAndInvalidInput (B-T09 domain half): empty, whitespace,
// NUL and astral inputs never panic and start zero provider work.
func TestSelectorEmptyAndInvalidInput(t *testing.T) {
	snap, _, _ := buildZeroOverlapArticle(t, true, 0)
	for _, tc := range []struct {
		name     string
		question string
		status   SelectionStatus
	}{
		{"empty", "", SelectionEmpty},
		{"whitespace", "   \n\t", SelectionEmpty},
		{"nul", "问题\x00注入", SelectionInvalidInput},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeSource{snap: snap}
			emb := newFakeEmbedder(BatchingShared)
			sel := NewSelector(src, emb, defaultSelectorConfig())
			got, err := sel.Select(context.Background(), snap.ContentID, tc.question, 0)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tc.status {
				t.Fatalf("status = %q, want %q", got.Status, tc.status)
			}
			if emb.requestCount() != 0 || src.snapshotCalls != 0 {
				t.Fatal("invalid input must start zero work")
			}
		})
	}
	// Astral question: no panic, valid processing.
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	sel := NewSelector(src, emb, defaultSelectorConfig())
	got, err := sel.Select(context.Background(), snap.ContentID, "😀🎉 量子退相干 😀", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range got.Passages {
		if !utf8.ValidString(p.Text) {
			t.Fatal("invalid UTF-8 in passage")
		}
	}
}

// TestSelectorEmbedderFailure: embedder unavailable → lexical_only with
// explicit status, never a silent hybrid claim (B-T26 domain half).
func TestSelectorEmbedderFailure(t *testing.T) {
	snap, _, _ := buildZeroOverlapArticle(t, true, 24)
	src := &fakeSource{snap: snap}
	emb := newFakeEmbedder(BatchingShared)
	emb.failQuery, emb.failDocs = true, true // fail regardless of batching mode
	sel := NewSelector(src, emb, defaultSelectorConfig())
	got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != SelectionLexicalOnly || got.Mode != ModeLexicalOnly {
		t.Fatalf("status=%s mode=%s, want lexical_only", got.Status, got.Mode)
	}
	if len(got.Passages) == 0 {
		t.Fatal("lexical fallback must still return the distractor passages")
	}
	// Split mode: a failed reserved query request also degrades to lexical.
	embSplit := newFakeEmbedder(BatchingSplit)
	embSplit.failQuery = true
	selSplit := NewSelector(&fakeSource{snap: snap}, embSplit, defaultSelectorConfig())
	gotSplit, err := selSplit.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
	if err != nil || gotSplit.Status != SelectionLexicalOnly {
		t.Fatalf("split failure: %+v %v", gotSplit, err)
	}
}

// TestDeterminismTwoRuns: frozen fake vectors, two full runs produce
// byte-identical selection JSON and assembly context (B-T12-style check).
func TestDeterminismTwoRuns(t *testing.T) {
	snap, _, _ := buildZeroOverlapArticle(t, true, 24)
	run := func() (string, string) {
		src := &fakeSource{snap: snap}
		emb := newFakeEmbedder(BatchingShared)
		emb.goldMarkers = []string{"环境诱导的相位随机化"}
		sel := NewSelector(src, emb, defaultSelectorConfig())
		got, err := sel.Select(context.Background(), snap.ContentID, questionZeroOverlap, 0)
		if err != nil {
			t.Fatal(err)
		}
		j, _ := json.Marshal(got)
		asm := NewContextAssembler()
		out, err := asm.Assemble(context.Background(), AssemblyInput{
			Selection: got, CurrentTask: questionZeroOverlap,
			BudgetRunes: 120000, MaxBytes: DefaultMaxBytes,
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(j), out.Context
	}
	j1, c1 := run()
	j2, c2 := run()
	if j1 != j2 {
		t.Fatal("selection JSON differs across runs")
	}
	if c1 != c2 {
		t.Fatal("assembly context differs across runs")
	}
}

// TestSweepSampler: exact stratified indices, stride, coverage, boundaries.
func TestSweepSampler(t *testing.T) {
	s := SampleSweep(156, 90)
	if len(s.Indices) != 90 || s.Stride != 2 || s.Coverage != float64(90)/156 || !s.Limited {
		t.Fatalf("sample = %+v", s)
	}
	for k, idx := range s.Indices {
		if idx != k*156/90 {
			t.Fatalf("index %d = %d, want %d", k, idx, k*156/90)
		}
	}
	full := SampleSweep(10, 20)
	if len(full.Indices) != 10 || full.Stride != 1 || full.Coverage != 1 || full.Limited {
		t.Fatalf("full coverage = %+v", full)
	}
	empty := SampleSweep(10, 0)
	if len(empty.Indices) != 0 || empty.Coverage != 0 {
		t.Fatalf("empty = %+v", empty)
	}
	// Deterministic: two calls identical.
	a, b := SampleSweep(1000, 90), SampleSweep(1000, 90)
	for i := range a.Indices {
		if a.Indices[i] != b.Indices[i] {
			t.Fatal("non-deterministic sample")
		}
	}
}

// TestWeightsValidation (B-T32 math half): range, normalization, rejection.
func TestWeightsValidation(t *testing.T) {
	w, err := ValidateWeights(Weights{Lexical: 0.35, Embedding: 0.65})
	if err != nil || w.Lexical != 0.35 || w.Embedding != 0.65 {
		t.Fatalf("default weights: %+v %v", w, err)
	}
	w2, err := ValidateWeights(Weights{Lexical: 1, Embedding: 1, Rerank: 1})
	if err != nil || w2.Lexical != 1.0/3 {
		t.Fatalf("normalization: %+v %v", w2, err)
	}
	for _, bad := range []Weights{
		{}, {Lexical: -0.1, Embedding: 0.5}, {Lexical: 1.5},
		{Lexical: math.NaN()}, {Embedding: math.Inf(1)},
	} {
		if _, err := ValidateWeights(bad); err == nil {
			t.Fatalf("expected rejection for %+v", bad)
		}
	}
}
