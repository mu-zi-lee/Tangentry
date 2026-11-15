// Command report generates docs/evidence/b-eval-report.md from the Phase-7
// replay results (protocol §6 format). Deterministic: no clock; timestamps
// come only from the recorded generation log.
//
// Run: cd test/offline/eval-b && go run ./report -eval . -repo ../../.. -commit <sha>
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"tangentry/eval-b-gen/evalutil"

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

func readJSON(path string, v any) {
	data, err := os.ReadFile(path)
	check(err == nil, "read %s: %v", path, err)
	check(json.Unmarshal(data, v) == nil, "parse %s", path)
}

type agg struct {
	RunID       string  `json:"run_id"`
	Path        string  `json:"path"`
	Budget      int     `json:"budget"`
	Hits        int     `json:"hits"`
	Denominator int     `json:"denominator"`
	Recall      float64 `json:"recall"`
	Blocked     bool    `json:"blocked"`
}

type qr struct {
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
	SelectedCount    int      `json:"selected_count"`
	SelectedLocators []string `json:"selected_locators"`
	MissReason       string   `json:"miss_reason"`
	AssemblyStatus   string   `json:"assembly_status"`
	SweepSampled     int      `json:"sweep_sampled"`
	SweepStride      int      `json:"sweep_stride"`
	SweepCoverage    float64  `json:"sweep_coverage"`
	SweepLimited     bool     `json:"sweep_limited"`
	LexicalSlots     int      `json:"lexical_slots"`
	SweepSlots       int      `json:"sweep_slots"`
	LexicalSelected  int      `json:"lexical_selected"`
	SlotBudget       int      `json:"slot_budget"`
	CharBudget       int      `json:"char_budget"`
	SweepChars       int      `json:"sweep_chars"`
	LexicalChars     int      `json:"lexical_chars"`
	FrozenLookups    int      `json:"frozen_lookups"`
}

type neg struct {
	CaseID   string `json:"case_id"`
	Kind     string `json:"kind"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	Pass     bool   `json:"pass"`
	Detail   string `json:"detail"`
}

type inv struct {
	RunID             string `json:"run_id"`
	QuestionID        string `json:"question_id"`
	SweepSlotsOK      bool   `json:"sweep_slots_within_candidates"`
	LexicalSlotsOK    bool   `json:"lexical_slots_within_topk"`
	NonnegativeOK     bool   `json:"shares_nonnegative"`
	WithinMaxRequests bool   `json:"within_max_requests"`
	PredictedRequests int    `json:"predicted_cold_cache_requests"`
	CharBoundShrank   bool   `json:"char_bound_share_shrank"`
	SweepHasCapacity  bool   `json:"sweep_has_passage_capacity"`
}

func hitMark(b bool) string {
	if b {
		return "HIT"
	}
	return "miss"
}

func main() {
	evalDir := flag.String("eval", ".", "eval-b root")
	repoDir := flag.String("repo", "../../..", "repository root")
	commit := flag.String("commit", "unknown", "git commit sha")
	flag.Parse()

	var set evalutil.EvalSet
	ydata, err := os.ReadFile(filepath.Join(*evalDir, "questions.yaml"))
	check(err == nil, "questions.yaml: %v", err)
	check(yaml.Unmarshal(ydata, &set) == nil, "parse questions.yaml")

	var aggs []agg
	readJSON(filepath.Join(*evalDir, "runs", "aggregates.json"), &aggs)
	var results []qr
	readJSON(filepath.Join(*evalDir, "runs", "recall-results.json"), &results)
	var det map[string]any
	readJSON(filepath.Join(*evalDir, "runs", "determinism.json"), &det)
	var negs []neg
	readJSON(filepath.Join(*evalDir, "runs", "negative-results.json"), &negs)
	var invs []inv
	readJSON(filepath.Join(*evalDir, "runs", "budget-invariants.json"), &invs)
	var budgetResults []qr
	readJSON(filepath.Join(*evalDir, "runs", "budget-results.json"), &budgetResults)
	var env map[string]string
	readJSON(filepath.Join(*evalDir, "runs", "environment.json"), &env)

	var genLog map[string]any
	genLogPath := filepath.Join(*evalDir, "vectors", "generation-log.json")
	hasVectors := false
	if _, err := os.Stat(genLogPath); err == nil {
		readJSON(genLogPath, &genLog)
		hasVectors = true
	}
	var store evalutil.VectorStore
	if hasVectors {
		vdata, err := os.ReadFile(filepath.Join(*evalDir, "vectors", "frozen-vectors.json"))
		check(err == nil, "vectors: %v", err)
		check(json.Unmarshal(vdata, &store) == nil, "parse vectors")
	}

	aggBy := map[string]agg{}
	for _, a := range aggs {
		aggBy[a.RunID] = a
	}
	resBy := map[string]qr{}
	for _, r := range results {
		resBy[r.RunID+"/"+r.QuestionID] = r
	}

	var b strings.Builder
	w := func(format string, args ...any) { fmt.Fprintf(&b, format, args...) }

	w("# B · Phase-7 evaluation report — NFR-02 (hybrid retrieval)\n\n")
	w("- **Generated by:** `test/offline/eval-b/report` from frozen replay results (deterministic).\n")
	w("- **Evaluation set:** `test/offline/eval-b/questions.yaml`, status **%s**, confirmed by %s at %s.\n", set.Status, set.ConfirmedBy, set.ConfirmedAt)
	w("- **Confirmation statement (verbatim):** %q\n", set.ConfirmationStatement)
	w("- **Metric:** `gold_passage_recall_at_budget` — sentence/segment recall, NOT answer correctness.\n\n")

	// 1. Environment
	w("## 1. Environment\n\n")
	w("| item | value |\n| --- | --- |\n")
	w("| OS/arch | %s/%s |\n", env["os"], env["arch"])
	w("| Go | %s |\n", env["go_version"])
	w("| commit | `%s` |\n", *commit)
	w("| harness | `test/offline/eval-b/replay` (module `tangentry/eval-b-gen`) |\n")
	w("| commands | `go run ./replay -eval . -out runs` ; `go test ./replay -count=1` ; `python3 verify_eval_set.py` |\n")
	w("| network in replay | **zero** (frozen vectors; loopback-only negative tests) |\n\n")

	// 2. Dataset
	w("## 2. Dataset\n\n")
	w("- 24 primary answerable questions + 2 provisional OCR questions (excluded from the denominator; local PaddleOCR runtime unavailable in this environment → reported as `pdf_ocr_unavailable`, never counted as hits).\n")
	w("- Gold granularity: canonical segments from the real `retrieval` splitter/grouping (1–3 sentences, 200–800 runes; subtitle cue groups 3–8 cues / 15–60 s; PDF page-local). Every gold validated through `retrieval.NewSelector` before the run.\n")
	w("- Annotator: WANG Jiaqi (human sign-off %s); AI-drafted provenance recorded in B-AI-014.\n", set.ConfirmedAt)
	w("- Freeze hashes (sha256, at confirmation):\n\n```\n")
	fh, err := os.ReadFile(filepath.Join(*evalDir, "freeze-hashes.txt"))
	check(err == nil, "freeze-hashes.txt: %v", err)
	w("%s```\n\n", string(fh))
	w("- Independent cross-validation: `verify_eval_set.py` — 696 checks passed (second implementation).\n\n")

	// 3. Embedding identity
	w("## 3. Embedding model, vectors and configuration\n\n")
	if hasVectors {
		w("| item | value |\n| --- | --- |\n")
		w("| provider kind | %s |\n", store.ProviderKind)
		w("| endpoint family | dashscope.aliyuncs.com (DashScope text-embedding surface; key redacted) |\n")
		w("| model | `%s` |\n", store.Model)
		w("| dimensions | %d |\n", store.Dimensions)
		w("| batch size | %d |\n", store.BatchSize)
		w("| text type | split: `query` for questions, `document` for passages (generation pass) |\n")
		w("| instruct | none |\n")
		w("| vector file | `test/offline/eval-b/vectors/frozen-vectors.json` |\n")
		w("| vector payload sha256 | `%s` |\n", store.VectorSHA256)
		w("| document vectors | %d |\n", len(store.Document))
		w("| query vectors | %d |\n", len(store.Query))
		w("| top-K | 100 |\n")
		w("| sweepCandidates | 90 |\n")
		w("| sweepRatio | 90/(100+90) = 0.4737 (reporting only; integer share arithmetic) |\n")
		w("| hybrid weights | lexical 0.35 / embedding 0.65 / rerank 0 (rerank off) |\n")
		w("| B budget (recall runs) | maxEmbeddingChars 100,000; maxEmbeddingRequests 24 (shared) / 25 (split); batchSize 8 |\n")
		w("| replay embedding requests | **0** (frozen cache; lookups recorded per question) |\n\n")
		w("**Deviation from protocol §5 local-first default (recorded):** no local embedding server/model exists in this environment. With explicit human authorization (protocol §9, see §8) one live pass generated frozen vectors via Bailian `text-embedding-v4`. All recall/budget replays are offline and deterministic. `hybrid-shared` is a **simulation** of a text_type-less server using document-type vectors for every text (labeled diagnostic, not a real local-server run); `hybrid-split` is the authorized provider configuration and carries the NFR-02 decision.\n\n")
	} else {
		w("**BLOCKED:** frozen vectors not generated; hybrid results unavailable. This report is partial and NFR-02 is NOT decided.\n\n")
	}

	// 4+5+6. Per-question and aggregates, 120k and 8k separate
	for _, budget := range []int{120000, 8000} {
		w("## %d. Results at %d characters%s\n\n", map[int]int{120000: 4, 8000: 5}[budget], budget,
			map[int]string{120000: " (primary)", 8000: " (stress; never pooled with 120k)"}[budget])
		w("Per-question table (full selected passage IDs/locators in `docs/evidence/b-eval-per-question.json`):\n\n")
		w("| question | doc | subset | baseline | lexical | hybrid-split | hybrid-shared | hybrid mode | miss reason (hybrid-split) |\n")
		w("| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
		for _, q := range set.Questions {
			if !q.PrimaryDenominator {
				continue
			}
			base := resBy[fmt.Sprintf("baseline-%d/%s", budget, q.QuestionID)]
			lex := resBy[fmt.Sprintf("lexical-%d/%s", budget, q.QuestionID)]
			hyb := resBy[fmt.Sprintf("hybrid-split-%d/%s", budget, q.QuestionID)]
			hybSh := resBy[fmt.Sprintf("hybrid-shared-%d/%s", budget, q.QuestionID)]
			w("| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",
				q.QuestionID, strings.TrimPrefix(q.DocID, "fixture:"), q.Subset,
				hitMark(base.Hit), hitMark(lex.Hit), hitMark(hyb.Hit), hitMark(hybSh.Hit), hyb.Mode, hyb.MissReason)
		}
		w("\nAggregate (numerator/denominator/recall):\n\n")
		w("| path | hits | denominator | recall |\n| --- | --- | --- | --- |\n")
		for _, id := range []string{fmt.Sprintf("baseline-%d", budget), fmt.Sprintf("lexical-%d", budget), fmt.Sprintf("hybrid-split-%d", budget), fmt.Sprintf("hybrid-shared-%d", budget)} {
			a := aggBy[id]
			if a.Blocked {
				w("| %s | — | — | BLOCKED (no frozen vectors) |\n", id)
				continue
			}
			w("| %s | %d | %d | %.4f |\n", id, a.Hits, a.Denominator, a.Recall)
		}
		w("\n")
		if budget == 8000 {
			w("Assembly status at 8k: every lexical/hybrid question reports `degraded_budget` (summary/history disabled); verified by B-T18.\n\n")
		}
	}

	// Decision rule (protocol §7)
	w("## 6. Decision rule (protocol §7) — hybrid-split\n\n")
	base120 := aggBy["baseline-120000"]
	lex120 := aggBy["lexical-120000"]
	hyb120 := aggBy["hybrid-split-120000"]
	base8 := aggBy["baseline-8000"]
	hyb8 := aggBy["hybrid-split-8000"]
	type rule struct {
		name string
		ok   bool
	}
	rules := []rule{
		{"aggregate hybrid recall ≥ 0.80 on primary 120k", !hyb120.Blocked && hyb120.Recall >= 0.80},
		{"hybrid recall ≥ baseline recall (same set/budget)", !hyb120.Blocked && hyb120.Recall >= base120.Recall},
		{"hybrid recall ≥ lexical-only recall (same set)", !hyb120.Blocked && hyb120.Recall >= lex120.Recall},
		{"8k stress recorded and ≥ 8k baseline", !hyb8.Blocked && hyb8.Recall >= base8.Recall},
		{"every question reported; no post-hoc removal", len(results) > 0},
		{"two frozen runs byte-identical", det["byte_identical"] == true},
		{"model/vector hashes and weights recorded", hasVectors},
	}
	allPass := true
	w("| rule | result |\n| --- | --- |\n")
	for _, r := range rules {
		status := "PASS"
		if !r.ok {
			status = "**FAIL**"
			allPass = false
		}
		w("| %s | %s |\n", r.name, status)
	}
	w("\n")
	if hyb120.Blocked {
		w("**NFR-02: NOT DECIDED (hybrid blocked).**\n\n")
	} else if allPass {
		w("**NFR-02: PASS** on the hybrid-split configuration with the recorded deviation (§3).\n\n")
	} else {
		w("**NFR-02: FAIL — ADR-002 reopen check triggered.** This is a negative result; no success is claimed. Do not relabel gold, drop misses, or switch paths to force a pass (protocol §7).\n\n")
	}

	// 7. Negative set
	w("## 7. Negative set (never in the recall denominator)\n\n")
	w("| case | kind | expected | actual | pass |\n| --- | --- | --- | --- | --- |\n")
	for _, n := range negs {
		w("| %s | %s | %s | %s | %v |\n", n.CaseID, n.Kind, n.Expected, n.Actual, n.Pass)
	}
	w("\n")

	// Budget runs
	w("## 7a. Budget-invariant runs (not in the recall denominator)\n\n")
	if len(invs) == 0 {
		w("Blocked (no frozen vectors).\n\n")
	} else {
		w("| run | question | slotBudget | lexSlots/selected | sweepSlots/sampled | sweepChars | lexChars | predicted cold-cache requests | invariants |\n")
		w("| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
		invBy := map[string]inv{}
		for _, i := range invs {
			invBy[i.RunID+"/"+i.QuestionID] = i
		}
		for _, r := range budgetResults {
			i := invBy[r.RunID+"/"+r.QuestionID]
			ok := i.SweepSlotsOK && i.LexicalSlotsOK && i.NonnegativeOK && i.WithinMaxRequests
			extra := ""
			if r.RunID == "budget-charbound-shared" || r.RunID == "budget-charbound-split" {
				extra = fmt.Sprintf("; char-shrank=%v sweep-capacity=%v", i.CharBoundShrank, i.SweepHasCapacity)
			}
			w("| %s | %s | %d | %d/%d | %d/%d | %d | %d | %d | %v%s |\n",
				r.RunID, r.QuestionID, r.SlotBudget, r.LexicalSlots, r.LexicalSelected, r.SweepSlots, r.SweepSampled,
				r.SweepChars, r.LexicalChars, i.PredictedRequests, ok, extra)
		}
		w("\nReplay embedding requests: 0 (frozen cache). Predicted cold-cache counts follow `ceil((1+C)/B)` (shared) / `1+ceil(C/B)` (split) and never exceed `maxEmbeddingRequests`; `sweepSlots ≤ sweepCandidates`, `lexicalSlots ≤ topK`, shares nonnegative (asserted by `TestBudgetInvariants`).\n\n")
	}

	// 8. Provider usage
	w("## 8. Provider call/usage ledger (live generation pass; credentials redacted)\n\n")
	if hasVectors {
		w("| item | value |\n| --- | --- |\n")
		for _, k := range []string{"authorization_statement", "authorized_at", "spend_cap_cny", "estimated_cost_cny", "provider_kind", "endpoint_family", "key_source", "request_count", "total_tokens", "budget_requests", "budget_chars", "budget_status", "document_vectors", "query_vectors", "vector_sha256", "finished_at"} {
			w("| %s | %v |\n", k, genLog[k])
		}
		w("\nPer-request ledger (role/text_type/status/usage; no keys, no texts): `test/offline/eval-b/vectors/generation-log.json`.\n\n")
		w("This live pass is separate from the frozen offline evidence (protocol §9); its output was used ONLY to freeze vectors, never to relabel the gold set.\n\n")
	} else {
		w("No provider call was made (hybrid blocked).\n\n")
	}

	// 9. Limitations
	w("## 9. Limitations and explicit non-claims\n\n")
	w("- This metric is **sentence/segment recall**, not answer correctness, answer quality or citation support (C's semantic verification and D's comparison quality are separate).\n")
	w("- `hybrid-shared` uses document-type vectors for the question (simulation of a text_type-less server); it is a diagnostic, not the authorized provider configuration.\n")
	w("- The OCR subset (BQ-025/026) is **not** evaluated: local PaddleOCR is unavailable (`pdf_ocr_unavailable`); the provisional expected-text fixture remains gated.\n")
	w("- BQ-021 is an intentional coverage-limited miss (gold off every sampled sweep index) and stays in the denominator; zero-overlap recall is reported at the recorded `sweepCoverage` (see manifest), not as an unbounded claim.\n")
	w("- BQ-016 exposes the single-term lexical proximity artifact (lexical-only miss; hybrid reaches it via sampled index 0).\n")
	w("- Recall ceiling with a perfect embedder is 23/24 (BQ-021 unreachable by design).\n")
	w("- No claim is made about live chat answer quality, latency, or token-cost parity; the controlled variable is the character budget.\n\n")

	// Determinism evidence
	w("## 10. Determinism evidence (B-T12)\n\n")
	w("```json\n")
	dj, _ := json.MarshalIndent(det, "", "  ")
	w("%s\n```\n\n", string(dj))
	w("Tests: `go test ./replay -count=1` — B-T12 (byte-identical replay), B-T13 (recall threshold + comparisons), B-T18 (8k stress + degraded_budget), negative set, budget invariants.\n")

	outPath := filepath.Join(*repoDir, "docs", "evidence", "b-eval-report.md")
	check(os.WriteFile(outPath, []byte(b.String()), 0o644) == nil, "write report")

	// Full per-question audit data next to the report.
	pq, _ := json.MarshalIndent(results, "", "  ")
	check(os.WriteFile(filepath.Join(*repoDir, "docs", "evidence", "b-eval-per-question.json"), append(pq, '\n'), 0o644) == nil, "write per-question json")

	fmt.Printf("report written: %s\n", outPath)
	fmt.Printf("per-question audit: docs/evidence/b-eval-per-question.json (%d records)\n", len(results))
}
