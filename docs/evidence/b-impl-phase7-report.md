# B implementation · Phase 7 report — evaluation replay (NFR-02)

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete — **NFR-02: PASS** (hybrid-split, recorded deviation)
- **Preconditions met:**
  1. Evaluation set EXISTS and is human-confirmed: WANG Jiaqi sign-off in
     session ("我是人类，我签署。请你进入phase07"), `questions.yaml` status
     `confirmed`, freeze hashes recorded. Set was AI-drafted at the user's
     request (B-AI-014) with provenance retained; 24 primary + 2 provisional
     OCR questions, all protocol §2 requirements covered.
  2. Explicit protocol §9 authorization for ONE live embedding pass: Aliyun
     Bailian DashScope `text-embedding-v4` (1024 dims, batch 8, split
     text_type), key from `~/.bailian/config.json` (redacted, never written),
     spend cap CNY 10. Actual: 740 requests, 544,390 tokens (≈ CNY 0.27),
     0 errors. Vectors frozen; all replays offline.

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| `test/offline/eval-b/` evaluation set | 7 fictional documents (141k–165k runes each, BMP-only), 26 gold records in protocol §3 format, negative set, run-config matrix, freeze hashes, independent Python cross-validator (696 checks). |
| `gen/` | Deterministic generator using the REAL retrieval splitter/grouping; every gold validated through `retrieval.NewSelector` (exact-phrase locator proof, lexical/sweep reachability, N cross-check). |
| `evalutil/` + `replay/` | Offline replay harness: baseline (`buildChatContext` head/tail) vs lexical-only vs hybrid (frozen vectors) at 120k AND 8k; budget-invariant runs (starved/char-bound/high × shared/split); negative set; B-T12 double-run. |
| `vectorgen/` | The one live pass through the REAL `aichat.EmbeddingClient` adapter; refuses to run without `-authorize`; per-request text_type/status/usage ledger; key never logged. |
| `report/` | Generates `docs/evidence/b-eval-report.md` (protocol §6) + `b-eval-per-question.json` (192 records, full selected IDs/locators). |
| `replay/eval_test.go` | B-T12, B-T13, B-T18, negative set, budget invariants — fail-closed without frozen vectors (verified before the pass). |

No `src/` implementation code changed this phase (evaluation only).

## 2. Results (VERIFIED — full tables in b-eval-report.md)

| path | 120k | 8k |
| --- | --- | --- |
| baseline (head/tail) | 6/24 = 0.2500 | 6/24 = 0.2500 |
| lexical-only | 19/24 = 0.7917 | 19/24 = 0.7917 |
| **hybrid-split** | **23/24 = 0.9583** | **23/24 = 0.9583** |
| hybrid-shared (simulation, diagnostic) | 23/24 = 0.9583 | 23/24 = 0.9583 |

- Only miss: **BQ-021** — intentional coverage-limited outcome (zero-overlap
  gold OFF every sampled sweep index), kept in the denominator, reported
  separately. Zero-overlap paraphrases BQ-018 (same-language) and BQ-019
  (cross-language) HIT via the sweep at recorded coverage ≈ 0.05;
  distractor-saturated BQ-020 (110 query-term passages) HIT.
- 8k assembly: `degraded_budget` explicit on every question (B-T18).
- Negative set: 12/12 pass (no_match, injection-as-data, empty, invalid
  budget ×3, forged locator, pdf_no_text, extract failure, embedding failure
  → lexical_only, dimension/model mismatch rejected by the real adapter).
- Budget runs: shares nonnegative and within budget in all 6 configs;
  char-bound run shrinks both shares (lexical 100→2 selected, sweep 90→12
  sampled) while the sweep keeps ≥1 passage capacity; starved-split
  (slotBudget 0) falls back to lexical_only with zero embedding requests.

## 3. Decision rule (protocol §7) — all PASS

| rule | result |
| --- | --- |
| hybrid recall ≥ 0.80 (primary 120k) | PASS (0.9583) |
| hybrid ≥ baseline | PASS (0.9583 ≥ 0.2500) |
| hybrid ≥ lexical-only | PASS (0.9583 ≥ 0.7917) |
| 8k recorded, ≥ 8k baseline | PASS (0.9583 ≥ 0.2500) |
| every question reported, no post-hoc removal | PASS (24/24, incl. the miss) |
| two frozen runs byte-identical | PASS (sha256 563953f9…90bc) |
| model/vector hashes + weights recorded | PASS (vector payload sha256 78ce366d…d2ce) |

**ADR-002 reopen check: not triggered.** No gold label was changed after
seeing results; no question was dropped; budgets were not altered mid-run.

## 4. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| `go run ./replay -eval . -out runs` | 0 | full replay, determinism ✓, negatives 12/12 | `b-impl-phase7-replay.log` |
| `go test ./replay -count=1 -v` | 0 | B-T12/13/18 + negatives + budget invariants PASS | `b-impl-phase7-eval-tests.log` |
| `go test ./... -count=1` (src) | 0 | 46 ok / 11 no-test (no regression) | `b-impl-phase7-go-full.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase7-go-full.log` |
| `python3 verify_eval_set.py` | 0 | 696 independent checks | eval-b README |
| `go run ./vectorgen …` (live, authorized) | 0 | 740 requests / 544,390 tokens / 0 errors | `vectors/generation-log.json`, `b-impl-phase7-vectorgen.log` |

## 5. Structured report

```json
{
  "phase": "7-evaluation",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-7 commit> feat(eval): phase-7 NFR-02 evaluation replay with confirmed set and frozen vectors"],
  "files_changed": [
    "test/offline/eval-b/** (evaluation set, gen, evalutil, replay, vectorgen, report, vectors, runs)",
    "docs/evidence/b-eval-report.md, b-eval-per-question.json",
    "docs/evidence/b-impl-phase7-{report.md,replay.log,eval-tests.log,go-full.log}",
    "test/offline/README.md (eval-b pointer)",
    "docs/ai-use-log.yaml (B-AI-014, B-AI-015)",
    "contributions/013-owner-b-implementation.md (Phase 7 section)"
  ],
  "tests_added": ["B-T12 (frozen replay byte-identical)", "B-T13 (recall threshold + comparisons)", "B-T18 (8k stress + degraded_budget)", "negative set (12 cases)", "budget invariants (6 configs)"],
  "test_results": [
    {"command": "cd test/offline/eval-b && go test ./replay -count=1 -v", "exit_code": 0, "summary": "5 tests PASS", "evidence": "docs/evidence/b-impl-phase7-eval-tests.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "46 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase7-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase7-go-full.log"}
  ],
  "invariants_verified": [
    "NFR-02 decision rule: all 7 conditions PASS (hybrid-split 23/24 = 0.9583)",
    "B-T12: two frozen replays byte-identical (sha256 recorded)",
    "B-T18: 8k degraded_budget explicit; not pooled with 120k",
    "budget shares nonnegative/capped in shared AND split; sweep keeps capacity under char pressure",
    "INV-05: every selected passage re-read verified (forged locator negative case drops source_unverified)",
    "gold granularity = real splitter/grouping; every gold validated through NewSelector pre-run"
  ],
  "constraints_checked": [
    "human sign-off recorded BEFORE the run; set frozen (hashes); no post-hoc relabeling",
    "protocol §9 authorization recorded verbatim; key never written to disk/logs; ledger redacted",
    "replay zero-network (frozen vectors); live pass separate and labeled",
    "no src/ implementation change; A budget files untouched",
    "OCR subset excluded (PaddleOCR unavailable) and reported as pdf_ocr_unavailable, never pooled",
    "no push in this session; PR + non-author review remain human actions"
  ],
  "ai_use_log_entry": "B-AI-015 (evaluation set draft: B-AI-014)",
  "deviations_from_spec": [
    "Embedding source: Bailian text-embedding-v4 (split) instead of local bge-m3 — no local server/model in environment; explicitly authorized, recorded in report §3/§8",
    "hybrid-shared is a labeled simulation (document-type vectors for all texts), not a real local-server run; hybrid-split carries the decision",
    "OCR subset provisional: expected-text fixture only; real PaddleOCR run pending (runtime unavailable)"
  ],
  "open_questions": [
    "PR #7 opened (https://github.com/orangesummertime/CS5351_SE_Group2/pull/7); non-author human review required (do NOT self-approve/merge) — reviewer arranged by the human owner",
    "OCR subset: install local PaddleOCR, render scanned pages, verify recognized text, then confirm BQ-025/026 labels",
    "Optional: repeat the evaluation with a pinned local bge-m3 to remove the provider deviation"
  ],
  "next_phase": "post-Phase-7: non-author human review of PR #7 + merge decision (implementation phases 0-7 complete)",
  "claim_tags": "every factual claim above is VERIFIED by cited evidence logs/files; recall numbers come from the frozen replay, not estimates"
}
```

## 6. Stop condition

Phase 7 ends here. Implementation Phases 0–7 are complete. PR
`owner/b-implementation → main` was opened at the human owner's request:
**https://github.com/orangesummertime/CS5351_SE_Group2/pull/7** (9 commits,
full evidence package). **Non-author human review** is arranged by the owner;
the agent does not self-approve or merge.