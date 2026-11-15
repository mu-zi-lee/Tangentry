# B implementation · Phase 4 report — embedding/rerank adapters + B budget

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete (awaiting human confirmation before Phase 5)
- **Session:** B-AI-012 (continuous session `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 3 confirmed (no blocking issues).

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| B-only budget (`retrieval/embedding_budget.go`) | `BudgetTracker`: Reserve before each POST; request limit + usage-unknown stop further calls; concurrent-safe (no overshoot); statuses completed/limited/exhausted/usage_unknown/disabled. Independent of A's ledger. |
| Vector cache (`retrieval/vector_cache.go`, `sqlite/vector_cache.go`) | Process-local default + opt-in persistent SQLite (migration 083). Key (contentId, sourceVersion, passageId, modelId, dimensions); identity change ⇒ miss; dimension mismatch rejected; copies isolate caller mutation. |
| Embedding settings (`retrieval/embedding_settings.go`) | Local-first default (bge-m3/1024, loopback, batch 8, topK 100, 0.35/0.65/0, rerank off, 24 shared). Per-model Bailian dimension/row limits (v4 10 rows, v2 fixed 1536/25 rows, qwen3.7 20 rows). Weight/budget validation; local-loopback enforcement; `Mask()` → hasKey/hasRerankKey only. |
| Embedding adapter (`aichat/embedding.go`) | `retrieval.Embedder` over OpenAI-compatible (`{base}/embeddings`) + DashScope surfaces; role-correct text_type (split never mixes), query-only instruct, float/base64, dimension + model-identity fail-closed, usage-unknown marks budget, redacted errors, fixed-string `TestConnection`. B budget; never A's reserveCompletion. |
| Rerank adapter (`aichat/rerank.go`) | Off by default; DashScope + compatible surfaces; request-relative scores clamped [0,1]; B-budgeted; failure → error (rerank_unavailable degradation). |
| Selector batching (`retrieval/selector.go`) | `embedUnion`: shared combines question+docs → ceil((1+C)/B); split reserves query → 1+ceil(C/B). |
| Settings persistence (`sqlite/retrieval_settings.go`, migration 085) | Save/reload preserves all fields; unsaved → labelled default; invalid rejected; key never returned. |

## 2. Test-first evidence (VERIFIED)

- **26-test determinism set**, identical across two runs. B-Txx coverage:

| B-Txx | Tests |
| --- | --- |
| B-T24 | `TestBT24_BBudgetAndALedger`, `TestBudgetTrackerReserve`, `TestBudgetTrackerConcurrent` (no overshoot); A ledger empty-diff + no reserveCompletion call |
| B-T26 | `TestBT26_AdapterFailures` (wrong dim/model/usage/auth/redaction), `TestSelectorEmbedderFailure` (both modes) |
| B-T30 | `TestBT30_VectorCache` (process), `TestBT30_PersistentCache` (SQLite) |
| B-T31 | `TestBT31_SettingsValidation`, `TestBT31_AdapterRoleAndSurface` (split text_type, query-only instruct, shared omits) |
| B-T32 | `TestBT32_SettingsWeights`, `TestWeightsValidation` |
| B-T33 | `TestBT33_ModeMatrix` (exact counts: shared R24=24, split R25=25, split R24=24; zero-capacity 0 requests; split never mixes roles), `TestBT33_InvalidAndDisabled` (-1, sweep=0), `TestBT33_CharBound` + budget-math worked examples |
| B-T35 | `TestBT35_MaskedSettings`, `TestBT35_SettingsPersistence` |
| B-T36 | `TestBT36_Rerank` (off→0 POST, bailian/custom, failure, budget), `TestBT36_ScoreClamp` |
| B-T37 (embedding) | `TestBT37_LocalFirstEmbedding` (local loopback default; non-loopback local rejected) |

- **Selector refactor note:** Phase-1 B-T39's provisional call-count assertion
  used the split formula; it was aligned to the shared formula ceil((1+C)/B)
  (documented, not weakened). The fake embedder now identifies the question by
  text so both batching modes work.

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| focused (retrieval/ai/transport/aichat/sqlite) `-count=1` | 0 | 5 ok | `b-impl-phase4-focused.log` |
| `go test ./... -count=1` | 0 | 45 ok / 11 no-test | `b-impl-phase4-go-full.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase4-layering.log` |
| `npm test -- --run` | 0 | 62 files / 251 tests | `b-impl-phase4-web.log` |
| `npm run build` | 0 | built | `b-impl-phase4-web.log` |
| `go vet` / gofmt | 0 | clean | `b-impl-phase4-layering.log` |
| two-run determinism | 0 | identical (26 PASS/run) | `b-impl-phase4-determinism.log` |
| `git diff main` A budget + protocol.go | 0 | empty | `b-impl-phase4-layering.log` |
| B adapters reserveCompletion | — | comment only (never called) | `b-impl-phase4-layering.log` |
| published migrations | — | unchanged; 082/083/084/085 added | `b-impl-phase4-layering.log` |
| secret scan | — | clean (synthetic fixtures only) | session output |

## 4. Design decisions recorded (INFERRED within spec latitude)

1. **Request counting = HTTP requests.** Shared mode batches question+docs so
   the count is ceil((1+C)/B); the question rides in the first combined batch
   (role label is wire-irrelevant in shared). Split reserves a query request.
2. **Usage-unknown:** the current call's vectors are returned, the budget is
   marked unknown, and subsequent Reserve calls fail (stops further calls).
3. **Model identity:** a returned model that differs from the requested model
   is rejected (fail closed); DashScope may omit model (accepted).
4. **Vector cache wiring:** the port + both implementations + unit tests are
   complete; per-passage selector integration lands in Phase 5 (passages have
   IDs only after selection).
5. **Settings storage:** local SQLite singleton (migration 085); key stored
   locally, never returned (Mask). Consistent with existing local settings.
6. **Migration numbers:** 083 (passage_embeddings) and 085 (retrieval_settings)
   are B-owned and additive; renumber at merge if taken.

## 5. Structured report

```json
{
  "phase": "4-embedding-rerank",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-4 commit> feat(retrieval): add embedding/rerank adapters with B-only budget and vector cache (migrations 083/085)"],
  "files_changed": [
    "src/internal/retrieval/embedding_budget.go, vector_cache.go, embedding_settings.go (+test), types.go, selector.go",
    "src/internal/adapters/aichat/embedding.go, rerank.go (+3 test files)",
    "src/internal/adapters/sqlite/migrations/083_passage_embeddings.sql, 085_retrieval_settings.sql, vector_cache.go, retrieval_settings.go (+test)",
    "src/internal/retrieval/fixtures_test.go, selector_test.go (mode-aware alignment)"
  ],
  "tests_added": ["B-T24","B-T26","B-T30","B-T31","B-T32","B-T33 (full matrix)","B-T35","B-T36","B-T37 (embedding)"],
  "test_results": [
    {"command": "cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... ./internal/adapters/aichat/ ./internal/adapters/sqlite/ -count=1", "exit_code": 0, "summary": "5 ok", "evidence": "docs/evidence/b-impl-phase4-focused.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "45 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase4-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase4-layering.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "62 files / 251 tests", "evidence": "docs/evidence/b-impl-phase4-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built", "evidence": "docs/evidence/b-impl-phase4-web.log"}
  ],
  "invariants_verified": [
    "B budget reserves before each POST; never exceeds limit; usage-unknown stops further calls; concurrent no-overshoot",
    "A ledger untouched (empty git diff; B adapters never call reserveCompletion)",
    "B-T33 exact request counts per mode; split never mixes roles; -1 invalid before any request; sweep=0 distinct label",
    "dimension/model fail-closed; cache identity isolation; secrets masked/redacted"
  ],
  "constraints_checked": [
    "layering green; domain stdlib-only; adapters implement ports",
    "A budget.go/ledger.go/protocol.go byte-identical to main",
    "no published migration edited; 083/085 additive/idempotent",
    "no real provider/credential/network; httptest fakes count requests + role/text_type",
    "offline determinism (two-run identical); -count=1; gofmt + vet clean; no push"
  ],
  "ai_use_log_entry": "B-AI-012",
  "deviations_from_spec": [
    "Phase-1 B-T39 call-count assertion aligned from provisional split formula to shared ceil((1+C)/B) (documented)",
    "Selector-level vector-cache wiring deferred to Phase 5 (port + implementations + tests complete here)"
  ],
  "open_questions": [
    "Phase-7 evaluation set still in progress (re-ask at Phase 6/7)",
    "Live provider measurement needs separate authorization (not run here)",
    "C/E must not duplicate B's column sets (content-version, pdf_page_text, passage_embeddings, retrieval_settings)"
  ],
  "next_phase": "5-ai-transport",
  "claim_tags": "all factual claims VERIFIED via cited evidence logs/commands; section 4 items are INFERRED design decisions within spec latitude"
}
```

## 6. Stop condition

Phase 4 ends here. Waiting for human confirmation before Phase 5 (AI service +
transport integration: chat endpoint accepts the namespaced `retrieval` object
on both decoder sides; budget validation + preflight before the selector;
ignore client `context` when enabled; last user message = question; six-layer
assembly into the system message; constraint re-injection; status → HTTP/SSE
mapping with no done-event on rejection; retrieval-off legacy path
byte-identical; tests B-T01 golden, B-T05, B-T07, B-T09, B-T17, B-T25,
regression B-T11).