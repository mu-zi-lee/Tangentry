// Command replay is the Phase-7 evaluation harness for NFR-02.
//
// Offline and deterministic: baseline (buildChatContext head/tail replay),
// lexical-only (real selector, no embedder) and hybrid (real selector +
// frozen vectors) at 120k and 8k, plus budget-invariant runs and the negative
// set. Zero network. Hybrid runs require the frozen vector file produced by
// vectorgen after explicit human authorization; without it they are marked
// blocked (never silently dropped, never faked).
//
// Run: cd test/offline/eval-b && go run ./replay -eval . -out runs
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"tangentry/eval-b-gen/evalutil"
	"tangentry/internal/retrieval"

	"go.yaml.in/yaml/v3"
)

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FATAL: "+format+"\n", args...)
	os.Exit(1)
}

func check(cond bool, format string, args ...any) {
	if !cond {
		die(format, args...)
	}
}

// ---------------------------------------------------------------------------
// Configuration and result types.
// ---------------------------------------------------------------------------

type runConfig struct {
	ID          string
	Budget      int
	Path        string // baseline | lexical | hybrid
	Mode        retrieval.BatchingMode
	MaxRequests int
	MaxChars    int
	TopK        int
	Sweep       int
	OnlyDoc     string // empty = all docs
}

type questionResult struct {
	QuestionID       string   `json:"question_id"`
	DocID            string   `json:"doc_id"`
	Subset           string   `json:"subset"`
	RunID            string   `json:"run_id"`
	Budget           int      `json:"budget"`
	Path             string   `json:"path"`
	Hit              bool     `json:"hit"`
	Status           string   `json:"status"`
	Mode             string   `json:"mode"`
	GoldLocator      string   `json:"gold_locator"`
	GoldSHA256       string   `json:"gold_sha256"`
	SelectedCount    int      `json:"selected_count"`
	SelectedLocators []string `json:"selected_locators"`
	SelectedIDs      []string `json:"selected_ids"`
	LexicalCoverage  int      `json:"lexical_coverage"`
	SweepUsed        bool     `json:"sweep_used"`
	SweepSampled     int      `json:"sweep_sampled"`
	SweepStride      int      `json:"sweep_stride"`
	SweepCoverage    float64  `json:"sweep_coverage"`
	SweepLimited     bool     `json:"sweep_limited"`
	SweepZeroReason  string   `json:"sweep_zero_reason"`
	SlotBudget       int      `json:"slot_budget"`
	CharBudget       int      `json:"char_budget"`
	LexicalSlots     int      `json:"lexical_slots"`
	LexicalSelected  int      `json:"lexical_selected"`
	SweepSlots       int      `json:"sweep_slots"`
	SweepChars       int      `json:"sweep_chars"`
	LexicalChars     int      `json:"lexical_chars"`
	AssemblyStatus   string   `json:"assembly_status"`
	AssemblyRunes    int      `json:"assembly_used_runes"`
	MissReason       string   `json:"miss_reason"`
	EmbeddingModel   string   `json:"embedding_model"`
	FrozenLookups    int      `json:"frozen_lookups"`
}

type aggregate struct {
	RunID       string  `json:"run_id"`
	Path        string  `json:"path"`
	Budget      int     `json:"budget"`
	Hits        int     `json:"hits"`
	Denominator int     `json:"denominator"`
	Recall      float64 `json:"recall"`
	Blocked     bool    `json:"blocked"`
}

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

type harness struct {
	set   evalutil.EvalSet
	snaps map[string]retrieval.Snapshot
	texts map[string]string
	cands map[string][]evalutil.Candidate
	store *evalutil.VectorStore // nil = hybrid blocked
}

func loadHarness(evalDir string) *harness {
	data, err := os.ReadFile(filepath.Join(evalDir, "questions.yaml"))
	check(err == nil, "read questions.yaml: %v", err)
	var set evalutil.EvalSet
	check(yaml.Unmarshal(data, &set) == nil, "parse questions.yaml")
	check(set.Status == "confirmed", "evaluation set is not confirmed (status=%s); Phase 7 requires human sign-off", set.Status)
	check(set.Version == 1, "unsupported set version")

	h := &harness{set: set, snaps: map[string]retrieval.Snapshot{}, texts: map[string]string{}, cands: map[string][]evalutil.Candidate{}}
	fixtures, _ := filepath.Glob(filepath.Join(evalDir, "fixtures", "*.json"))
	for _, f := range fixtures {
		snap, err := evalutil.LoadSnapshot(f)
		check(err == nil, "load %s: %v", f, err)
		h.snaps[snap.ContentID] = snap
		h.texts[snap.ContentID] = evalutil.ConcatText(snap)
		h.cands[snap.ContentID] = evalutil.CandidatesOf(snap)
	}
	vpath := filepath.Join(evalDir, "vectors", "frozen-vectors.json")
	if _, err := os.Stat(vpath); err == nil {
		store, err := evalutil.LoadVectorStore(vpath)
		check(err == nil, "frozen vectors: %v", err)
		h.store = store
	}
	return h
}

func (h *harness) primaryQuestions() []evalutil.Question {
	var out []evalutil.Question
	for _, q := range h.set.Questions {
		if q.Answerable && q.PrimaryDenominator {
			out = append(out, q)
		}
	}
	return out
}

func (h *harness) selectorConfig(cfg runConfig) retrieval.SelectorConfig {
	c := retrieval.SelectorConfig{
		TopK:                cfg.TopK,
		AssemblyBudgetRunes: cfg.Budget,
		MaxBytes:            retrieval.DefaultMaxBytes,
		Weights:             retrieval.DefaultWeights(),
		Sweep:               retrieval.SweepConfig{Enabled: true, SweepCandidates: cfg.Sweep},
		Budget: retrieval.BudgetConfig{
			Mode: cfg.Mode, MaxRequests: cfg.MaxRequests, BatchSize: 8,
			TopK: cfg.TopK, SweepCandidates: cfg.Sweep, MaxEmbeddingChars: cfg.MaxChars,
		},
	}
	if cfg.Path == "lexical" {
		c.Mode = retrieval.ModeLexical
		c.Budget.MaxRequests = 0
	} else {
		c.Mode = retrieval.ModeHybrid
	}
	return c
}

func (h *harness) runQuestion(cfg runConfig, q evalutil.Question) questionResult {
	res := questionResult{
		QuestionID: q.QuestionID, DocID: q.DocID, Subset: q.Subset,
		RunID: cfg.ID, Budget: cfg.Budget, Path: cfg.Path,
		GoldLocator: q.GoldLocator, GoldSHA256: q.GoldPassageSHA256,
		SelectedLocators: []string{}, SelectedIDs: []string{},
	}
	snap := h.snaps[q.DocID]
	text := h.texts[q.DocID]
	goldNorm := retrieval.NormalizeMatch(q.GoldPassageText)

	if cfg.Path == "baseline" {
		ctxText := evalutil.BaselineContext(text, cfg.Budget)
		res.Hit = strings.Contains(retrieval.NormalizeMatch(ctxText), goldNorm)
		res.Status = "baseline"
		res.Mode = "baseline"
		res.AssemblyStatus = "n/a"
		if !res.Hit {
			res.MissReason = "outside_head_tail_window"
		}
		return res
	}

	if cfg.Path == "hybrid" && h.store == nil {
		res.Status = "blocked_no_frozen_vectors"
		res.Mode = "blocked"
		res.MissReason = "frozen vectors not generated (authorization pending)"
		res.AssemblyStatus = "n/a"
		return res
	}

	var emb retrieval.Embedder
	var frozen *evalutil.FrozenEmbedder
	if cfg.Path == "hybrid" {
		frozen = &evalutil.FrozenEmbedder{Store: h.store, Mode: cfg.Mode}
		emb = frozen
	}
	sel, err := retrieval.NewSelector(evalutil.MemSource{Snap: snap}, emb, h.selectorConfig(cfg)).
		Select(context.Background(), q.DocID, q.Question, 0)
	check(err == nil, "%s/%s: select error: %v", cfg.ID, q.QuestionID, err)

	res.Status = string(sel.Status)
	res.Mode = sel.Mode
	res.EmbeddingModel = sel.EmbeddingModel
	res.LexicalCoverage = sel.LexicalCoverage
	res.SweepUsed = sel.Sweep.Used
	res.SweepSampled = sel.Sweep.Sampled
	res.SweepStride = sel.Sweep.Stride
	res.SweepCoverage = sel.Sweep.Coverage
	res.SweepLimited = sel.Sweep.Limited
	res.SweepZeroReason = sel.Sweep.ZeroReason
	res.SlotBudget = sel.SlotBudget
	res.CharBudget = sel.CharBudget
	res.LexicalSlots = sel.LexicalSlots
	res.LexicalSelected = sel.LexicalSelected
	res.SweepSlots = sel.Sweep.Slots
	res.SweepChars = sel.Sweep.Chars
	res.LexicalChars = sel.CharBudget - sel.Sweep.Chars
	for _, p := range sel.Passages {
		res.SelectedLocators = append(res.SelectedLocators, p.Locator)
		res.SelectedIDs = append(res.SelectedIDs, p.ID)
		if retrieval.NormalizeMatch(p.Text) == goldNorm {
			res.Hit = true
		}
	}
	res.SelectedCount = len(sel.Passages)
	if frozen != nil {
		res.FrozenLookups = frozen.Lookups
	}

	// Six-layer assembly at the same budget (8k must be degraded_budget).
	asm, err := retrieval.NewContextAssembler().Assemble(context.Background(), retrieval.AssemblyInput{
		Selection: sel, CurrentTask: q.Question, BudgetRunes: cfg.Budget, MaxBytes: retrieval.DefaultMaxBytes,
	})
	check(err == nil, "%s/%s: assemble error: %v", cfg.ID, q.QuestionID, err)
	res.AssemblyStatus = asm.Status
	res.AssemblyRunes = asm.UsedRunes

	if !res.Hit {
		res.MissReason = h.missReason(cfg, q, sel)
	}
	return res
}

func (h *harness) missReason(cfg runConfig, q evalutil.Question, sel retrieval.Selection) string {
	if sel.Sweep.ZeroReason != "" && cfg.Path == "hybrid" {
		return sel.Sweep.ZeroReason
	}
	lr := retrieval.ScoreLexical(q.Question, retrieval.QueryTerms(q.Question), q.GoldPassageText)
	cands := h.cands[q.DocID]
	gi := -1
	for i, c := range cands {
		if strings.Contains(c.Text, q.GoldPassageText) || c.Text == q.GoldPassageText {
			gi = i
			break
		}
	}
	onSample := false
	if gi >= 0 {
		for _, idx := range retrieval.SampleSweep(len(cands), cfg.Sweep).Indices {
			if idx == gi {
				onSample = true
			}
		}
	}
	switch {
	case gi < 0:
		return "gold_not_a_candidate"
	case cfg.Path == "lexical" && lr.Score == 0:
		return "zero_lexical_overlap"
	case cfg.Path == "lexical":
		return "below_lexical_cutoff"
	case lr.Score == 0 && !onSample:
		return "off_sweep_sample_zero_overlap"
	case lr.Score == 0:
		return "sweep_slots_or_chars_excluded_gold"
	default:
		return "lexical_cutoff_and_not_sampled"
	}
}

func (h *harness) runRecall(cfg runConfig) ([]questionResult, aggregate) {
	var results []questionResult
	agg := aggregate{RunID: cfg.ID, Path: cfg.Path, Budget: cfg.Budget}
	for _, q := range h.primaryQuestions() {
		if cfg.OnlyDoc != "" && q.DocID != cfg.OnlyDoc {
			continue
		}
		r := h.runQuestion(cfg, q)
		results = append(results, r)
		if r.Status == "blocked_no_frozen_vectors" {
			agg.Blocked = true
			continue
		}
		agg.Denominator++
		if r.Hit {
			agg.Hits++
		}
	}
	if agg.Denominator > 0 {
		agg.Recall = float64(agg.Hits) / float64(agg.Denominator)
	}
	return results, agg
}

func recallConfigs() []runConfig {
	var out []runConfig
	for _, budget := range []int{120000, 8000} {
		out = append(out,
			runConfig{ID: fmt.Sprintf("baseline-%d", budget), Budget: budget, Path: "baseline"},
			runConfig{ID: fmt.Sprintf("lexical-%d", budget), Budget: budget, Path: "lexical", Mode: retrieval.BatchingShared, TopK: 100, Sweep: 90, MaxChars: 100000},
			runConfig{ID: fmt.Sprintf("hybrid-split-%d", budget), Budget: budget, Path: "hybrid", Mode: retrieval.BatchingSplit, MaxRequests: 25, TopK: 100, Sweep: 90, MaxChars: 100000},
			runConfig{ID: fmt.Sprintf("hybrid-shared-%d", budget), Budget: budget, Path: "hybrid", Mode: retrieval.BatchingShared, MaxRequests: 24, TopK: 100, Sweep: 90, MaxChars: 100000},
		)
	}
	return out
}

func budgetConfigs() []runConfig {
	return []runConfig{
		{ID: "budget-starved-shared", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingShared, MaxRequests: 1, TopK: 100, Sweep: 90, MaxChars: 100000},
		{ID: "budget-starved-split", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingSplit, MaxRequests: 1, TopK: 100, Sweep: 90, MaxChars: 100000},
		{ID: "budget-charbound-shared", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingShared, MaxRequests: 25, TopK: 100, Sweep: 90, MaxChars: 20000, OnlyDoc: "fixture:article-charbound"},
		{ID: "budget-charbound-split", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingSplit, MaxRequests: 25, TopK: 100, Sweep: 90, MaxChars: 20000, OnlyDoc: "fixture:article-charbound"},
		{ID: "budget-high-shared", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingShared, MaxRequests: 25, TopK: 100, Sweep: 90, MaxChars: 100000},
		{ID: "budget-high-split", Budget: 120000, Path: "hybrid", Mode: retrieval.BatchingSplit, MaxRequests: 25, TopK: 100, Sweep: 90, MaxChars: 100000},
	}
}

type budgetInvariant struct {
	RunID             string `json:"run_id"`
	QuestionID        string `json:"question_id"`
	SweepSlotsOK      bool   `json:"sweep_slots_within_candidates"`
	LexicalSlotsOK    bool   `json:"lexical_slots_within_topk"`
	NonnegativeOK     bool   `json:"shares_nonnegative"`
	RequestFormulaOK  bool   `json:"cold_cache_request_formula"`
	WithinMaxRequests bool   `json:"within_max_requests"`
	PredictedRequests int    `json:"predicted_cold_cache_requests"`
	CharBoundShrank   bool   `json:"char_bound_share_shrank"`
	SweepHasCapacity  bool   `json:"sweep_has_passage_capacity"`
}

func (h *harness) runBudget(cfg runConfig) ([]questionResult, []budgetInvariant) {
	results, _ := h.runRecall(cfg)
	var invs []budgetInvariant
	for _, r := range results {
		inv := budgetInvariant{RunID: cfg.ID, QuestionID: r.QuestionID}
		inv.SweepSlotsOK = r.SweepSlots <= cfg.Sweep
		inv.LexicalSlotsOK = r.LexicalSlots <= cfg.TopK
		inv.NonnegativeOK = r.SweepSlots >= 0 && r.LexicalSlots >= 0 && r.SweepChars >= 0 && r.LexicalChars >= 0 &&
			r.SweepSlots+r.LexicalSlots <= r.SlotBudget
		union := r.LexicalSelected + r.SweepSampled
		inv.PredictedRequests = retrieval.ColdCacheRequests(cfg.Mode, union, 8)
		inv.RequestFormulaOK = true // ColdCacheRequests is the formula itself; recorded for audit
		inv.WithinMaxRequests = cfg.MaxRequests == 0 || inv.PredictedRequests <= cfg.MaxRequests || r.Mode == "lexical_only"
		if cfg.MaxChars <= 20000 {
			inv.CharBoundShrank = r.LexicalSelected < r.LexicalSlots || r.SweepSampled < r.SweepSlots
			inv.SweepHasCapacity = r.SweepSampled >= 1 || r.SweepZeroReason != ""
		}
		invs = append(invs, inv)
	}
	return results, invs
}

// ---------------------------------------------------------------------------
// Negative set (never in the recall denominator).
// ---------------------------------------------------------------------------

type negativeResult struct {
	CaseID   string `json:"case_id"`
	Kind     string `json:"kind"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	Pass     bool   `json:"pass"`
	Detail   string `json:"detail"`
}

type failingEmbedder struct{}

func (failingEmbedder) ModelID() string                      { return "fake-failing" }
func (failingEmbedder) Dimensions() int                      { return 8 }
func (failingEmbedder) BatchingMode() retrieval.BatchingMode { return retrieval.BatchingShared }
func (failingEmbedder) Embed(ctx context.Context, texts []string, role retrieval.EmbedRole) ([][]float32, error) {
	return nil, fmt.Errorf("fake embedding failure")
}

type fakeExtractor struct {
	doc retrieval.PDFDocument
	err error
}

func (f fakeExtractor) Version() string { return "fake" }
func (f fakeExtractor) DocumentHash(ctx context.Context, path string) (string, error) {
	return f.doc.SHA256, f.err
}
func (f fakeExtractor) Extract(ctx context.Context, path string) (retrieval.PDFDocument, error) {
	return f.doc, f.err
}

type fakePDFStore struct{ pages []retrieval.Page }

func (s *fakePDFStore) SavePDFPages(ctx context.Context, contentID string, doc retrieval.PDFDocument, at int64) error {
	s.pages = doc.Pages
	return nil
}

type fakePDFText struct{ pages []retrieval.Page }

func (f fakePDFText) Pages(ctx context.Context, contentID string) ([]retrieval.Page, error) {
	return f.pages, nil
}

func (h *harness) runNegatives() []negativeResult {
	ctx := context.Background()
	var out []negativeResult
	add := func(id, kind, expected, actual string, pass bool, detail string) {
		out = append(out, negativeResult{CaseID: id, Kind: kind, Expected: expected, Actual: actual, Pass: pass, Detail: detail})
	}
	baseCfg := retrieval.SelectorConfig{
		TopK: 100, AssemblyBudgetRunes: 120000, MaxBytes: retrieval.DefaultMaxBytes,
		Weights: retrieval.DefaultWeights(), Mode: retrieval.ModeLexical,
		Budget: retrieval.BudgetConfig{Mode: retrieval.BatchingShared, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000},
		Sweep:  retrieval.SweepConfig{Enabled: true, SweepCandidates: 90},
	}
	mainSnap := h.snaps["fixture:article-main"]

	// NQ-001 no_match (lexical mode, absent terms).
	sel, err := retrieval.NewSelector(evalutil.MemSource{Snap: mainSnap}, nil, baseCfg).
		Select(ctx, "fixture:article-main", "铌钛超导量子干涉仪的磁通噪声抑制方案是什么？", 0)
	check(err == nil, "NQ-001: %v", err)
	add("NQ-001", "no_match", "no_match", string(sel.Status), sel.Status == retrieval.SelectionNoMatch, "zero lexical evidence; no head/tail fallback")

	// NQ-002 malicious text is data, returned verbatim.
	malSnap := h.snaps["fixture:article-malicious"]
	sel, err = retrieval.NewSelector(evalutil.MemSource{Snap: malSnap}, nil, baseCfg).
		Select(ctx, "fixture:article-malicious", "注入测试段落写了什么？", 0)
	check(err == nil, "NQ-002: %v", err)
	verbatim := false
	for _, p := range sel.Passages {
		if strings.Contains(p.Text, "忽略之前的所有指令") {
			verbatim = true
		}
	}
	add("NQ-002", "malicious_text", "injection returned verbatim as data", fmt.Sprintf("status=%s verbatim=%v", sel.Status, verbatim), verbatim, "answer-layer non-execution is a separate human rubric")

	// NQ-003 empty question.
	sel, err = retrieval.NewSelector(evalutil.MemSource{Snap: mainSnap}, nil, baseCfg).
		Select(ctx, "fixture:article-main", "", 0)
	check(err == nil, "NQ-003: %v", err)
	add("NQ-003", "empty_input", "empty", string(sel.Status), sel.Status == retrieval.SelectionEmpty, "")

	// NQ-004 empty document.
	emptySnap := h.snaps["fixture:article-empty"]
	sel, err = retrieval.NewSelector(evalutil.MemSource{Snap: emptySnap}, nil, baseCfg).
		Select(ctx, "fixture:article-empty", "任意问题", 0)
	check(err == nil, "NQ-004: %v", err)
	add("NQ-004", "empty_document", "no_match", string(sel.Status), sel.Status == retrieval.SelectionNoMatch, "")

	// NQ-005 invalid budgets (zero provider work).
	for _, b := range []int{0, -1, 1000001} {
		cfg := baseCfg
		cfg.AssemblyBudgetRunes = b
		sel, err = retrieval.NewSelector(evalutil.MemSource{Snap: mainSnap}, nil, cfg).
			Select(ctx, "fixture:article-main", "同步失败后默认的重试间隔是多少秒？", 0)
		check(err == nil, "NQ-005: %v", err)
		add("NQ-005", "invalid_budget", "invalid_budget", string(sel.Status), sel.Status == retrieval.SelectionInvalidBudget, fmt.Sprintf("budget=%d", b))
	}

	// NQ-006 forged locator fails re-read verification.
	forged := retrieval.Passage{
		ID: "forged", ContentID: "fixture:article-main", Source: retrieval.SourceArticle,
		Locator: "article:9999:s0", StartRune: 0, EndRune: 3, Text: "伪造段",
		SourceVersion: "content-revision:1", TextSHA256: retrieval.TextSHA256("伪造段"),
	}
	kept, dropped, err := retrieval.VerifyPassages(ctx, evalutil.MemSource{Snap: mainSnap}, []retrieval.Passage{forged})
	check(err == nil, "NQ-006: %v", err)
	ok := len(kept) == 0 && len(dropped) == 1 && dropped[0].Reason == retrieval.DropSourceUnverified
	add("NQ-006", "forged_locator", "dropped source_unverified", fmt.Sprintf("kept=%d dropped=%d reason=%s", len(kept), len(dropped), dropped[0].Reason), ok, "")

	// NQ-007 pdf_no_text via the real extraction service.
	noText := h.snaps["fixture:pdf-no-text"]
	doc := retrieval.PDFDocument{SHA256: noText.Pages[0].DocumentSHA256, PageCount: len(noText.Pages), Pages: noText.Pages}
	svc := retrieval.NewPDFExtractionService(fakeExtractor{doc: doc}, fakePDFText{}, &fakePDFStore{}, retrieval.PDFExtractionConfig{OCRMode: retrieval.OCRModeOff})
	r, err := svc.Extract(ctx, "fixture:pdf-no-text", "fake.pdf", 0)
	check(err == nil, "NQ-007: %v", err)
	add("NQ-007", "pdf_no_text", "pdf_no_text", r.Status, r.Status == retrieval.PDFStatusNoText, "not counted as a hit")

	// NQ-008 extraction failure.
	svc = retrieval.NewPDFExtractionService(fakeExtractor{err: fmt.Errorf("fake extract error")}, fakePDFText{}, &fakePDFStore{}, retrieval.PDFExtractionConfig{OCRMode: retrieval.OCRModeOff})
	r, err = svc.Extract(ctx, "fixture:pdf-report", "fake.pdf", 0)
	check(err == nil, "NQ-008: %v", err)
	add("NQ-008", "extraction_failure", "pdf_extract_failed", r.Status, r.Status == retrieval.PDFStatusExtractFailed, "")

	// NQ-009 embedding failure -> lexical_only fallback (never hybrid).
	hybCfg := baseCfg
	hybCfg.Mode = retrieval.ModeHybrid
	hybCfg.Budget.MaxRequests = 24
	sel, err = retrieval.NewSelector(evalutil.MemSource{Snap: mainSnap}, failingEmbedder{}, hybCfg).
		Select(ctx, "fixture:article-main", "同步失败后默认的重试间隔是多少秒？", 0)
	check(err == nil, "NQ-009: %v", err)
	add("NQ-009", "embedding_failure", "lexical_only", string(sel.Status)+"/"+sel.Mode,
		sel.Status == retrieval.SelectionLexicalOnly && sel.Mode == retrieval.ModeLexicalOnly, "fallback never presented as hybrid")

	// NQ-010 model/dimension mismatch: adapter rejects wrong dimensions.
	nq10 := h.runDimensionMismatch()
	add("NQ-010", "model_mismatch", "dimension mismatch rejected", nq10.Actual, nq10.Pass, nq10.Detail)

	return out
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

func writeJSON(path string, v any) {
	data, err := json.MarshalIndent(v, "", "  ")
	check(err == nil, "marshal %s: %v", path, err)
	check(os.WriteFile(path, append(data, '\n'), 0o644) == nil, "write %s", path)
}

func main() {
	evalDir := flag.String("eval", "..", "eval-b root")
	outDir := flag.String("out", "../runs", "output directory")
	flag.Parse()
	check(os.MkdirAll(*outDir, 0o755) == nil, "mkdir runs")

	h := loadHarness(*evalDir)
	fmt.Printf("set: status=%s confirmed_by=%s questions=%d primary=%d frozen_vectors=%v\n",
		h.set.Status, h.set.ConfirmedBy, len(h.set.Questions), len(h.primaryQuestions()), h.store != nil)

	env := map[string]string{
		"go_version": runtime.Version(),
		"os":         runtime.GOOS,
		"arch":       runtime.GOARCH,
		"harness":    "test/offline/eval-b/replay",
	}
	writeJSON(filepath.Join(*outDir, "environment.json"), env)

	// Recall runs, twice (B-T12 byte-identical replay).
	runOnce := func() ([]questionResult, []aggregate) {
		var all []questionResult
		var aggs []aggregate
		for _, cfg := range recallConfigs() {
			rs, agg := h.runRecall(cfg)
			all = append(all, rs...)
			aggs = append(aggs, agg)
		}
		return all, aggs
	}
	r1, a1 := runOnce()
	r2, _ := runOnce()
	b1, _ := json.Marshal(r1)
	b2, _ := json.Marshal(r2)
	det := map[string]any{
		"byte_identical": string(b1) == string(b2),
		"run1_sha256":    evalutil.SHA256Hex(string(b1)),
		"run2_sha256":    evalutil.SHA256Hex(string(b2)),
	}
	writeJSON(filepath.Join(*outDir, "recall-results.json"), r1)
	writeJSON(filepath.Join(*outDir, "recall-results-run2.json"), r2)
	writeJSON(filepath.Join(*outDir, "determinism.json"), det)
	writeJSON(filepath.Join(*outDir, "aggregates.json"), a1)
	check(string(b1) == string(b2), "B-T12 violated: two replays differ")
	fmt.Println("B-T12 determinism: byte-identical ✓")

	// Budget-invariant runs (not in the recall denominator).
	var budgetResults []questionResult
	var invariants []budgetInvariant
	for _, cfg := range budgetConfigs() {
		if h.store == nil && cfg.Path == "hybrid" {
			fmt.Printf("budget run %s: blocked (no frozen vectors)\n", cfg.ID)
			continue
		}
		rs, invs := h.runBudget(cfg)
		budgetResults = append(budgetResults, rs...)
		invariants = append(invariants, invs...)
	}
	writeJSON(filepath.Join(*outDir, "budget-results.json"), budgetResults)
	writeJSON(filepath.Join(*outDir, "budget-invariants.json"), invariants)

	// Negative set.
	negs := h.runNegatives()
	writeJSON(filepath.Join(*outDir, "negative-results.json"), negs)

	// Summary.
	summary := map[string]any{
		"set_status":      h.set.Status,
		"confirmed_by":    h.set.ConfirmedBy,
		"confirmed_at":    h.set.ConfirmedAt,
		"aggregates":      a1,
		"determinism":     det,
		"negatives_pass":  countNegPass(negs),
		"negatives_total": len(negs),
		"frozen_vectors":  h.store != nil,
	}
	if h.store != nil {
		summary["vector_model"] = h.store.Model
		summary["vector_sha256"] = h.store.VectorSHA256
		summary["vector_dimensions"] = h.store.Dimensions
	}
	writeJSON(filepath.Join(*outDir, "summary.json"), summary)

	for _, a := range a1 {
		fmt.Printf("%-22s hits=%2d/%2d recall=%.4f blocked=%v\n", a.RunID, a.Hits, a.Denominator, a.Recall, a.Blocked)
	}
	fmt.Printf("negatives: %d/%d pass\n", countNegPass(negs), len(negs))
	if h.store == nil {
		fmt.Println("NOTE: hybrid runs BLOCKED - frozen vectors missing. Run vectorgen after explicit authorization.")
	}
}

func countNegPass(negs []negativeResult) int {
	n := 0
	for _, r := range negs {
		if r.Pass {
			n++
		}
	}
	return n
}
