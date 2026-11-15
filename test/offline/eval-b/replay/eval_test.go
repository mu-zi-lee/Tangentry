package main

// Phase-7 acceptance tests (plan B-T12 / B-T13 / B-T18).
//
// These tests require the frozen vector file (vectors/frozen-vectors.json)
// produced by vectorgen after explicit human authorization. Without it they
// FAIL CLOSED with an actionable message - never skip, never fake vectors.
//
// Run: cd test/offline/eval-b && go test ./replay -count=1 -v

import (
	"encoding/json"
	"testing"

	"tangentry/eval-b-gen/evalutil"
)

const evalRoot = ".."

func requireVectors(t *testing.T) *harness {
	t.Helper()
	h := loadHarness(evalRoot)
	if h.store == nil {
		t.Fatalf("frozen vectors missing: run vectorgen with explicit human authorization first (protocol §5/§9); fake vectors are never acceptable for the NFR-02 claim")
	}
	return h
}

func aggFor(t *testing.T, h *harness, runID string) ([]questionResult, aggregate) {
	t.Helper()
	for _, cfg := range recallConfigs() {
		if cfg.ID == runID {
			return h.runRecall(cfg)
		}
	}
	t.Fatalf("unknown run %s", runID)
	return nil, aggregate{}
}

// B-T12: two frozen-vector replays produce byte-identical per-question JSON.
func TestBT12FrozenReplayByteIdentical(t *testing.T) {
	h := requireVectors(t)
	run := func() []byte {
		var all []questionResult
		for _, cfg := range recallConfigs() {
			rs, _ := h.runRecall(cfg)
			all = append(all, rs...)
		}
		b, err := json.Marshal(all)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	b1, b2 := run(), run()
	if string(b1) != string(b2) {
		t.Fatalf("B-T12 violated: replays differ (sha %s vs %s)", sha(b1), sha(b2))
	}
	t.Logf("B-T12 PASS: byte-identical replay, sha256=%s", sha(b1))
}

// B-T13: hybrid recall >= 0.80, >= baseline, >= lexical-only on the primary
// 120k set; per-question results and vector identity recorded.
func TestBT13RecallThreshold(t *testing.T) {
	h := requireVectors(t)
	_, base := aggFor(t, h, "baseline-120000")
	_, lex := aggFor(t, h, "lexical-120000")
	rs, hyb := aggFor(t, h, "hybrid-split-120000")
	if hyb.Denominator < 20 {
		t.Fatalf("primary denominator %d < 20", hyb.Denominator)
	}
	t.Logf("baseline %d/%d=%.4f lexical %d/%d=%.4f hybrid %d/%d=%.4f",
		base.Hits, base.Denominator, base.Recall, lex.Hits, lex.Denominator, lex.Recall, hyb.Hits, hyb.Denominator, hyb.Recall)
	if hyb.Recall < 0.80 {
		t.Fatalf("B-T13 FAIL: hybrid recall %.4f < 0.80 - ADR reopen check triggered; report the negative result, never claim success", hyb.Recall)
	}
	if hyb.Recall < base.Recall {
		t.Fatalf("B-T13 FAIL: hybrid recall %.4f < baseline %.4f", hyb.Recall, base.Recall)
	}
	if hyb.Recall < lex.Recall {
		t.Fatalf("B-T13 FAIL: hybrid recall %.4f < lexical-only %.4f (regression to investigate)", hyb.Recall, lex.Recall)
	}
	for _, r := range rs {
		if r.GoldSHA256 == "" || r.GoldLocator == "" {
			t.Fatalf("per-question audit fields missing for %s", r.QuestionID)
		}
	}
	if h.store.VectorSHA256 == "" || h.store.Model == "" {
		t.Fatal("vector identity not recorded")
	}
	t.Logf("B-T13 PASS: model=%s dims=%d vector_sha256=%s", h.store.Model, h.store.Dimensions, h.store.VectorSHA256)
}

// B-T18: 8k stress recorded separately, not below the 8k baseline, and
// degraded_budget is explicit.
func TestBT18Stress8k(t *testing.T) {
	h := requireVectors(t)
	_, base := aggFor(t, h, "baseline-8000")
	rsLex, lex := aggFor(t, h, "lexical-8000")
	rsHyb, hyb := aggFor(t, h, "hybrid-split-8000")
	t.Logf("8k: baseline %d/%d=%.4f lexical %d/%d=%.4f hybrid %d/%d=%.4f",
		base.Hits, base.Denominator, base.Recall, lex.Hits, lex.Denominator, lex.Recall, hyb.Hits, hyb.Denominator, hyb.Recall)
	if hyb.Recall < base.Recall {
		t.Fatalf("B-T18 FAIL: 8k hybrid %.4f < 8k baseline %.4f", hyb.Recall, base.Recall)
	}
	if lex.Recall < base.Recall {
		t.Fatalf("B-T18 FAIL: 8k lexical %.4f < 8k baseline %.4f", lex.Recall, base.Recall)
	}
	for _, r := range append(rsLex, rsHyb...) {
		if r.AssemblyStatus != "degraded_budget" {
			t.Fatalf("B-T18 FAIL: %s/%s assembly status %q, want degraded_budget", r.RunID, r.QuestionID, r.AssemblyStatus)
		}
	}
	t.Log("B-T18 PASS: 8k not pooled with 120k; degraded_budget explicit")
}

// Negative set: every case behaves as defined (never in the recall denominator).
func TestNegativeSet(t *testing.T) {
	h := loadHarness(evalRoot)
	negs := h.runNegatives()
	for _, r := range negs {
		if !r.Pass {
			t.Errorf("negative case %s (%s): expected %q, got %q (%s)", r.CaseID, r.Kind, r.Expected, r.Actual, r.Detail)
		}
	}
	t.Logf("negative set: %d/%d pass", countNegPass(negs), len(negs))
}

// Budget invariants: shares nonnegative and within budget in every mode;
// char-bound run shrinks a share while the sweep keeps >= 1 passage capacity.
func TestBudgetInvariants(t *testing.T) {
	h := requireVectors(t)
	for _, cfg := range budgetConfigs() {
		_, invs := h.runBudget(cfg)
		if len(invs) == 0 {
			t.Fatalf("%s: no results", cfg.ID)
		}
		for _, inv := range invs {
			if !inv.SweepSlotsOK || !inv.LexicalSlotsOK || !inv.NonnegativeOK || !inv.WithinMaxRequests {
				t.Fatalf("%s/%s: invariant violated: %+v", cfg.ID, inv.QuestionID, inv)
			}
			if cfg.MaxChars <= 20000 {
				if !inv.CharBoundShrank {
					t.Fatalf("%s/%s: char-bound config did not shrink any share", cfg.ID, inv.QuestionID)
				}
				if !inv.SweepHasCapacity {
					t.Fatalf("%s/%s: sweep lost all capacity under char pressure", cfg.ID, inv.QuestionID)
				}
			}
		}
		t.Logf("%s: %d questions, invariants OK", cfg.ID, len(invs))
	}
}

func sha(b []byte) string {
	return evalutil.SHA256Hex(string(b))
}
