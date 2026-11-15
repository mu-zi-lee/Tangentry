# B implementation · Phase 0 report — approval and preconditions gate

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation` (created from `main` `83c7726`, which equals `origin/main`)
- **Phase status:** complete (awaiting human confirmation before Phase 1)
- **Session:** B-AI-008 (`ses_e27efbad7ffeY2pIG6EzRIOgOQ`)

## 1. Approval chain — VERIFIED

| Item | Value | Evidence |
| --- | --- | --- |
| PR | #2 `owner/b-retrieval` → `main`, "Owner B: hybrid retrieval, configurable embeddings, and PDF/PaddleOCR review package" | `b-impl-phase0-approval.json` (GitHub API `pulls/2`) |
| PR author | `Wjq1024` (JiaQi Wang) | same |
| Approving review | id **5897467590**, state **APPROVED**, submitted **2026-11-13T20:19:58Z**, commit `da21804bbc7154ebb60d1c1769294b2dea56da43` | GitHub API `pulls/2/reviews`; assertion PASS in `b-impl-phase0-approval.log` |
| Reviewer | **orangesummertime** (Kefan CHEN) — **non-author** (≠ `Wjq1024`) | same |
| Review URL | https://github.com/orangesummertime/CS5351_SE_Group2/pull/2#pullrequestreview-5897467590 | same |
| Merge | `merged: true`, `merged_at: 2026-11-14T03:02:32Z`, `merge_commit_sha: 83c7726fab2dd06006df12db4a2f8e01bae9d2cc` | GitHub API `pulls/2`; `git show -s 83c7726` shows parents `ec7ab55` + `da21804` |
| Local main | `git log --oneline -5 main` head = `83c7726 Merge pull request #2: ...`; `main == origin/main` | `b-impl-phase0-approval.log` |
| A-only confirmation | requirements.yaml note: "the group confirmed implementation under the existing A plan on 2026-11-13" (lines 12–14 pre-edit) | `docs/req/requirements.yaml` |

Review history: 5 DISMISSED change-request rounds, 3 COMMENTED re-reviews, 1
DISMISSED "approved on technical grounds" re-review of `33016ce`, then the
final APPROVED review of `da21804`. All by orangesummertime. The approval rides
on this PR #2 review; no approval from another branch/repository is carried
forward.

## 2. Status header updates (docs-only) — VERIFIED

- `docs/architecture/adr/002-question-relevant-retrieval.md`: Status header →
  approved with review/merge citation; Decision heading status marker updated;
  Review-gate section gained an appended "Approval recorded" paragraph
  (original text retained).
- `docs/plans/b-retrieval-preimplementation.md`: Status header → approved with
  citation; Approval-gate section gained an appended record (original `pending`
  sentence retained as history, per the append-only convention used for A).
- `docs/req/requirements.yaml`: `FR-02`, `NFR-02`, `INV-04`, `INV-05`
  `approval: pending → approved` (exactly 4 replacements); approval reference
  appended to the top-level `note` (the strict schema forbids per-entry extra
  fields). **No technical content changed.**
- Validation: `yaml.safe_load` + `jsonschema.validate` against
  `docs/req/req-schema.json` → PASS (command output in session; B-AI-008).

## 3. Open decisions — confirmed defaults, no re-opening — VERIFIED (read)

All defaults below are consistently stated in ADR-002, the plan, the provider
notes and the eval protocol; the APPROVED review covers them. No contradiction
found among the authoritative sources on these points:

- Local-first embedding: recommended `bge-m3`/1024, Ollama-style loopback
  (`http://127.0.0.1:11434/v1`), user-overridable; no silent download.
- Weights 0.35/0.65/0 (rerank off) or 0.25/0.55/0.20 (rerank on); normalized.
- topK 100 (accepted 20–1000); sweepCandidates 90 (separate knob).
- Mode-specific `maxEmbeddingRequests`: 24 shared / 25 split; batch 8;
  `maxEmbeddingChars` 100000; `maxRerankRequests` 0; rerank off by default.
- Local PaddleOCR default (recommended `PaddleOCR-VL-1.6`, user-installed);
  cloud explicit opt-in + consent, feature-flagged off pending legal review.
- Namespaced `retrieval` wire object (schemaVersion 1); C confirmation of final
  spelling remains a C-side action, not a B blocker.
- `content_revision`/`content_hash` migration owned by B (proposed 084);
  082 `pdf_page_text`; 083 `passage_embeddings` only if persistent cache approved.

## 4. Environment preconditions — VERIFIED

| Check | Result | Evidence |
| --- | --- | --- |
| Go | go1.27.1 linux/amd64 (matches baseline). Not on default non-interactive PATH; found at `~/sdk/go1.27.1/bin/go`; used per-command PATH prefix, no persistent change | `b-impl-phase0-approval.log` |
| Node / npm | v26.13.0 / 11.20.0 (match baselines), at `~/.local/bin`; per-command PATH prefix | same |
| Go baseline | `go test ./... -count=1`: **43 ok / 11 no-test files**, exit 0, no failures, no skips | `b-impl-phase0-baseline-go.log` |
| npm ci | 159 packages, exit 0 | `b-impl-phase0-baseline-vitest.log` |
| Frontend build | exit 0 (chunk-size warning only) | same |
| vitest | **62 files / 251 tests passed**, exit 0 | same |
| Migrations | latest published `081_selected_subtitle_index.sql`; **082/083/084 free today**; re-check at merge; never edit published | `b-impl-phase0-approval.log` |
| Greenfield | `src/internal/retrieval/` does not exist | same |
| A budget read-only | `internal/ai/budget.go`, `internal/ai/ledger.go`, `internal/adapters/aichat/budget.go` exist; `git diff main` for them is empty | same |

**Baseline-count note (VERIFIED discrepancy vs the kickoff prompt, not a
failure):** the prompt's vitest baseline "61 files / 231 tests" predates A's
PR #6 merge (`ec7ab55`). Current `main` includes A's budget tests; B-AI-007
recorded 62/251 on the same reconciled tree, and this run reproduces 62/251.
The Go baseline 43/11 matches exactly. Both suites pass unfiltered.

**Code-landmark drift (VERIFIED, cosmetic):** the 200,000-byte context cap is
now at `src/internal/ai/chat.go:159` (spec cites 138–141 from before A's
merge); the check `len(contextText) > 200000 || strings.ContainsAny(..., "\x00")`
is unchanged in substance. Other landmarks verified present:
`content_types.go:86-98` (ArticleBlock), `saved.go:22-44` (SavedTrack/Service),
`store.go:91-103` (upsert updates payload only), `settings.go:175` ValidEndpoint
(https or loopback http), `ai_common.go` DisallowUnknownFields decoder,
`feature_services.go` composition root, `layering_test.go` domain rule
(covers any new domain package automatically), `chatContext.ts` head/tail
truncation with 35% summary share.

## 5. Residual documentation inconsistency — flagged, not silently resolved

The plan's overview prose still carries the pre-review **conditional** sweep
trigger, while the approved design is **unconditional**:

- `docs/plans/b-retrieval-preimplementation.md:21-24` ("adds ... when the
  lexical shortlist is too small or shares no query term") and `:223-226`
  ("when the lexical shortlist is small or has zero query-term overlap, add
  ...").
- Contradicted by `docs/plans/b-retrieval-preimplementation.md:414-417` ("The
  sweep runs unconditionally whenever an embedder is configured. There is no
  'shortlist too small' or 'zero coverage' trigger...") and
  `docs/architecture/adr/002-question-relevant-retrieval.md:70-93` (Decision
  1b, unconditional), plus the third-round review body (review 5877534488:
  "The unconditional sweep and B-T40 resolve the lexical-distractor trigger
  problem").

Resolution applied: **ADR > plan** conflict rule; the plan's own detailed
section and the review history agree with the ADR, so implementation will use
the unconditional sweep. The stale overview sentences were **not** edited
(Phase 0 is status-only). **Asking the human to confirm this reading at the
Phase 0 gate** (and optionally authorize a later docs-only cleanup of those two
paragraphs).

## 6. Evaluation-set dependency (Phase 7 blocker, flagged early)

The ≥20-question evaluation set with gold sentence/segment labels is prepared
**personally by WANG Jiaqi**; the agent must not invent questions or labels
(b-eval-protocol.md §2–3, plan open decision 10). **Question asked at this
gate: does the set exist yet?** If not, Phase 7 waits for it; Phases 1–6 are
not blocked by it. Unit-test fixtures in Phases 1–6 use gold labels defined by
the test specs themselves (B-T02/B-T39/B-T40), which is explicitly separate
from the Phase-7 human-owned set.

## 7. Structured report

```json
{
  "phase": "0-approval-preconditions",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["docs: record B retrieval approval and phase-0 gate (see git log owner/b-implementation; SHA recorded in the session phase report)"],
  "files_changed": [
    "docs/architecture/adr/002-question-relevant-retrieval.md",
    "docs/plans/b-retrieval-preimplementation.md",
    "docs/req/requirements.yaml",
    "docs/ai-use-log.yaml",
    "docs/evidence/b-impl-phase0-approval.json",
    "docs/evidence/b-impl-phase0-approval.log",
    "docs/evidence/b-impl-phase0-baseline-go.log",
    "docs/evidence/b-impl-phase0-baseline-vitest.log",
    "docs/evidence/b-impl-phase0-report.md",
    "contributions/013-owner-b-implementation.md",
    "contributions/README.md"
  ],
  "tests_added": [],
  "test_results": [
    {"command": "cd src && go test ./... -count=1", "exit_code": 0,
     "summary": "43 ok packages, 11 no-test packages, no failures",
     "evidence": "docs/evidence/b-impl-phase0-baseline-go.log"},
    {"command": "cd src/web && npm ci --no-audit --no-fund", "exit_code": 0,
     "summary": "159 packages", "evidence": "docs/evidence/b-impl-phase0-baseline-vitest.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0,
     "summary": "built, chunk-size warning only", "evidence": "docs/evidence/b-impl-phase0-baseline-vitest.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0,
     "summary": "62 files / 251 tests passed", "evidence": "docs/evidence/b-impl-phase0-baseline-vitest.log"}
  ],
  "invariants_verified": [
    "approval chain: non-author APPROVED review 5897467590 at 2026-11-13T20:19:58Z on da21804, merged as 83c7726",
    "baseline suites green before any change",
    "A budget files untouched (git diff main empty)"
  ],
  "constraints_checked": [
    "layering: baseline go test includes internal/layering ok (full gate re-run at Phase 1)",
    "A ledger untouched (git diff proof in b-impl-phase0-approval.log)",
    "no secrets in code/logs (read-only API GETs; no tokens used)",
    "offline determinism: no provider calls, no browser; npm registry reads only",
    "no push to main, no force-push; branch owner/b-implementation from main 83c7726",
    "no published migration edited; 082/083/084 free",
    "docs-only change: no technical content altered; requirements schema PASS"
  ],
  "ai_use_log_entry": "B-AI-008",
  "deviations_from_spec": [
    "vitest baseline is 62 files/251 tests on current main (prompt's 61/231 predates A's PR #6 merge); suites pass",
    "chat.go byte cap now at line 159 (spec cited 138-141 pre-merge); substance unchanged"
  ],
  "open_questions": [
    "Confirm unconditional-sweep reading of the two stale plan overview paragraphs (ADR precedence applied; no technical edit made)",
    "Does WANG Jiaqi's >=20-question gold-labeled evaluation set exist yet? Phase 7 waits for it",
    "Vector cache v1: process-local (default per plan) or persistent migration 083? Plan leaves reviewer choice; defaulting to process-local unless directed otherwise"
  ],
  "next_phase": "1-domain-core",
  "claim_tags": "every factual claim above is VERIFIED by the cited evidence file/command; the sweep-reading resolution is INFERRED from ADR precedence + review history and awaits human confirmation"
}
```

## 8. Stop condition

Phase 0 ends here. **No implementation code has been written.** Waiting for
human confirmation (and answers to §5/§6 questions) before starting Phase 1
(domain core, tests B-T02/06/08/10/14/15/16/21/22/29/39/40 first).