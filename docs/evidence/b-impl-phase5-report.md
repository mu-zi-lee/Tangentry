# B implementation · Phase 5 report — AI service + transport integration

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete (awaiting human confirmation before Phase 6)
- **Session:** B-AI-013 (continuous session `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 4 confirmed (no blocking issues).

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| Wire object (`retrieval/wire.go`) | Namespaced `Request`/`Response`/`PassageRef`/`EmbeddingSummary`/`RerankSummary` (schemaVersion 1); `StatusError` carries a distinct status; `validateRequest` (assembly + embedding budgets, labelled default on omission). |
| Engine (`retrieval/engine.go`) | `Run`: validate → preflight → select → assemble → response; `budgetedEmbedder` counts requests + enforces B budget; terminal statuses return StatusError (zero chat); degraded budget surfaced. |
| AI service (`ai/chat.go`, `translation_types.go`) | `ChatRequest.Retrieval`/`ChatResult.Retrieval` (omitempty); optional `SetRetrievalEngine`; enabled branch runs engine before any chat POST, ignores client context, uses assembled context as system-message source; rejection → zero chat POST + response. |
| Transport (`http/ai_retrieval.go`, `ai_summary.go`) | Distinct HTTP status/code/copy per status; SSE rejection terminal data frame carries retrieval object, never `event: done`; strict decoder rejects unknown retrieval fields. |
| Composition root (`app`) | `newRetrievalEngine` (SQLite source, local-first embedder, process-local cache) wired via `SetRetrievalEngine`. |

## 2. Test-first evidence (VERIFIED)

| B-Txx | Test | Assertion |
| --- | --- | --- |
| B-T01 | `TestBT01_RetrievalOffGolden` | retrieval nil/disabled: provider receives client context byte-identically; response has no `retrieval` key; selector/embedder never called |
| B-T05 | `TestBT05_NoMatch` | unrelated question → no_match, zero passages, zero chat POST |
| B-T07 | `TestBT07_InjectionIsData` | injection text retained as quoted data; no secret exposed; passage kept; chat runs once |
| B-T09 | `TestBT09_InvalidInputs` | empty/whitespace/NUL → rejected, zero chat POST; astral → no panic |
| B-T17 | `TestBT17_ByteCap` | 300×500-CJK source: provider never receives >200,000 bytes (reduced or rejected) |
| B-T25 | `TestBT25_HTTPStatusMapping` (12 statuses), `TestBT25_SSENoDoneOnRejection`, `TestBT25_SweepLimitedNotNoMatch`, `TestBT25_UnknownFieldRejected` | distinct HTTP/code/copy; no done on rejection; sweep-limited ≠ no_match with passages kept; unknown field → 400 |
| B-T11 | full suite | 45 ok / 11 no-test Go; 62 files / 251 tests frontend; retrieval-off golden green |
| extra | `TestBT_RetrievalOnUsesAssembledContext` | enabled: client context ignored; six-layer context (## identity … ## task) used; response schemaVersion 1 |

- One test-assertion fix during red→green: B-T01's field-set check now inspects
  the JSON key (`"retrieval"`) rather than a substring (the contentId
  `rss:retrieval` contains the word). No assertion weakened.

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| focused (retrieval/ai/transport) `-count=1` | 0 | 3 ok | `b-impl-phase5-focused.log` |
| `go test ./... -count=1` | 0 | 45 ok / 11 no-test | `b-impl-phase5-go-full.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase5-layering.log` |
| `npm test -- --run` | 0 | 62 files / 251 tests | `b-impl-phase5-web.log` |
| `npm run build` | 0 | built | `b-impl-phase5-web.log` |
| `go vet` / gofmt | 0 | clean | `b-impl-phase5-layering.log` |
| two-run determinism | 0 | identical (10 PASS/run) | `b-impl-phase5-determinism.log` |
| `git diff main` A budget + protocol.go | 0 | empty | `b-impl-phase5-layering.log` |
| secret scan | — | clean | session output |

## 4. Design decisions recorded (INFERRED within spec latitude)

1. **Optional setter integration:** `SetRetrievalEngine` mirrors
   `SetSummaryNoteWriter`; unset → legacy path byte-identical (B-T01).
2. **ai → retrieval import:** domain→domain, no cycle (retrieval stays
   stdlib-only). The AI layer maps ChatMessage→HistoryTurn.
3. **Terminal vs outcome statuses:** budget/input faults → 4xx; renderable
   outcomes (no_match, pdf_*, no_verified_passages, source_unverified) → 200
   with the status in the retrieval object; stale_source → 409;
   pdf_extracting → 202. All carry distinct code/copy.
4. **Context source:** retrieval enabled replaces the provider system-message
   source with the assembled six-layer context; history stays separate
   messages (existing contract). Client context ignored + not validated when
   enabled.
5. **Rerank:** off by default; response reports rerank disabled. Rerank-in-
   selector scoring is a refinement (adapter tested in Phase 4).
6. **Engine defaults:** topK=100/batch=8; request budgets default to 24/25
   mode-specific, 100000 chars, sweep 90 when omitted. Full settings-driven
   selector config is a frontend-phase refinement.

## 5. Structured report

```json
{
  "phase": "5-ai-transport",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-5 commit> feat(retrieval): integrate retrieval into chat service and transport"],
  "files_changed": [
    "src/internal/retrieval/wire.go, engine.go",
    "src/internal/ai/translation_types.go, chat.go (+chat_retrieval_test.go)",
    "src/internal/transport/http/ai_retrieval.go (+test), ai_summary.go",
    "src/internal/app/wire_services.go, feature_services.go"
  ],
  "tests_added": ["B-T01 (golden)","B-T05","B-T07","B-T09","B-T17","B-T25","B-T11 (regression)","assembled-context"],
  "test_results": [
    {"command": "cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... -count=1", "exit_code": 0, "summary": "3 ok", "evidence": "docs/evidence/b-impl-phase5-focused.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "45 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase5-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase5-layering.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "62 files / 251 tests", "evidence": "docs/evidence/b-impl-phase5-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built", "evidence": "docs/evidence/b-impl-phase5-web.log"}
  ],
  "invariants_verified": [
    "INV-04: preflight + assembly rejection start zero chat POST; retrieval-off legacy byte-identical (B-T01)",
    "INV-04 wire sub-limit: provider never receives >200,000 bytes (B-T17)",
    "INV-05: passages re-read via the source port (engine uses selector verification)",
    "B-T25: distinct status/copy, no event:done on rejection, sweep-limited != no_match"
  ],
  "constraints_checked": [
    "layering green; ai->domain retrieval (no cycle); retrieval stdlib-only",
    "A budget.go/ledger.go/protocol.go byte-identical to main",
    "no published migration edited; no migration added this phase",
    "no real provider/credential/network; fake provider/source/embedder/AIService",
    "offline determinism (two-run identical); -count=1; gofmt + vet clean; no push"
  ],
  "ai_use_log_entry": "B-AI-013",
  "deviations_from_spec": [
    "B-T01 field-set assertion corrected to inspect the JSON key (contentId contains the word 'retrieval'); documented",
    "Rerank-in-selector scoring deferred (off by default; adapter tested Phase 4)",
    "Engine uses fixed topK/batch defaults; settings-driven selector config refined in frontend phase"
  ],
  "open_questions": [
    "Phase-7 evaluation set still in progress (re-ask at Phase 6/7)",
    "C must confirm the final retrieval.passages spelling (B's object is stable; C may add top-level citations)",
    "Live provider measurement needs separate authorization"
  ],
  "next_phase": "6-frontend",
  "claim_tags": "all factual claims VERIFIED via cited evidence logs/commands; section 4 items are INFERRED design decisions within spec latitude"
}
```

## 6. Stop condition

Phase 5 ends here. Waiting for human confirmation before Phase 6 (frontend
wiring: send contentId/question/retrieval object; settings UI for embedding/
rerank providers, dimensions, weights, budgets; passage chips + explicit
status rendering incl. semantic_sweep_limited ≠ no_match; PDF extracting/
no-text states with retry hint; pdf.js stays display-only; legacy
buildChatContext untouched when off; vitest/component tests B-T01, B-T05,
B-T25, B-T31, B-T32, B-T35 frontend sides).