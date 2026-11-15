# B implementation · Phase 6 report — frontend wiring

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete (awaiting human confirmation before Phase 7)
- **Session:** B-AI-014 (continuous session `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 5 confirmed (no blocking issues).

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| `retrieval.ts` | Wire types (Request/Response/PassageRef/summaries, schemaVersion 1); `defaultRetrievalRequest`; `retrievalRequestFragment(enabled)` → `{}` when off (byte-compatible legacy body). |
| `retrievalSettings.ts` | Local-first defaults (bge-m3/1024 loopback); `BAILIAN_MODEL_DIMENSIONS` per-model choices + row limits; `validateRetrievalSettings` (dims/batch/topK/weights/budgets, local-loopback, rerank-zero guard); `validateWeights`; `maskRetrievalSettings` (hasKey/hasRerankKey only); `batchingMode`. |
| `retrievalPresentation.ts` | `retrievalStatusView` (distinct copy/tone per status, PDF retry hints); `isCoverageLimited`; `passageChipLabel`; `hasPassages`. semantic_sweep_limited ≠ no_match. |
| `RetrievalStatus.tsx` | Renders the server status + verifiable passage chips; coverage-limited keeps passages; never fabricates. |
| `RetrievalSettings.tsx` | Settings form: provider/baseUrl/masked key/model/per-model dimensions/batch/topK/weights/budgets/rerank with the zero-budget guard. |
| `AIInsights.tsx` + `ai.css` | Opt-in retrieval toggle (default off), request fragment, response capture (JSON + SSE done frame), RetrievalStatus render. Legacy buildChatContext untouched when off; pdf.js display-only. |

## 2. Test-first evidence (VERIFIED)

27 new vitest tests (4 files):

| B-Txx | Tests |
| --- | --- |
| B-T01 (frontend) | `retrieval.test.ts`: off → `{}` byte-compatible, no retrieval key, legacy buildChatContext unchanged; on → namespaced object |
| B-T05 | `retrievalPresentation.test.ts` + `RetrievalStatus.test.tsx`: no_match marker, zero chips |
| B-T25 | distinct copy/tone for 12 statuses; sweep-limited ≠ no_match with passages kept; PDF retry hints; component data-status rendering |
| B-T31 | per-model Bailian dims/row limits, fixed v2 1536, local loopback, topK/dims/batch validation |
| B-T32 | weight normalization + all-zero/negative/NaN/Inf/out-of-range rejection |
| B-T35 | masking hasKey/hasRerankKey, no key in JSON, non-secret fields survive, batching mode |

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| `npm test -- --run` | 0 | 66 files / 278 tests (+27 new) | `b-impl-phase6-web.log` |
| `npm run build` (incl. `tsc --noEmit`) | 0 | built, type-check clean | `b-impl-phase6-web.log` |
| `go test ./... -count=1` | 0 | 45 ok / 11 no-test (no regression) | `b-impl-phase6-go.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase6-go.log` |
| two-run frontend determinism | 0 | identical (27 PASS/run) | `b-impl-phase6-determinism.log` |
| `git diff main` A budget | 0 | empty | `b-impl-phase6-go.log` |
| secret scan | — | clean | session output |

## 4. Design decisions recorded (INFERRED within spec latitude)

1. **Opt-in toggle default off:** preserves the legacy path byte-identically
   (B-T01); the retrieval fragment is empty when off.
2. **Frontend is display-only:** it sends the request and renders the server's
   response; never the authority for retrieval/embeddings/locators; never
   fabricates a passage.
3. **Component tests via renderToStaticMarkup:** matches the repo's
   node-environment vitest convention (no jsdom/browser).
4. **Settings panel self-contained:** validation/masking complete and tested;
   full AISettings-page navigation integration + live save/reload is a
   follow-up refinement.
5. **Status copy mirrors the backend** distinct wording; coverage-limited is a
   warning, never no_match.

## 5. Structured report

```json
{
  "phase": "6-frontend",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-6 commit> feat(retrieval): wire frontend retrieval toggle, settings and status rendering"],
  "files_changed": [
    "src/web/src/features/ai/retrieval.ts (+test), retrievalSettings.ts (+test), retrievalPresentation.ts (+test)",
    "src/web/src/features/ai/RetrievalStatus.tsx (+test), RetrievalSettings.tsx",
    "src/web/src/features/ai/AIInsights.tsx, ai.css"
  ],
  "tests_added": ["B-T01 (frontend)","B-T05","B-T25","B-T31","B-T32","B-T35"],
  "test_results": [
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "66 files / 278 tests", "evidence": "docs/evidence/b-impl-phase6-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built + tsc --noEmit clean", "evidence": "docs/evidence/b-impl-phase6-web.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "45 ok / 11 no-test (no regression)", "evidence": "docs/evidence/b-impl-phase6-go.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase6-go.log"}
  ],
  "invariants_verified": [
    "B-T01: retrieval off → byte-compatible legacy body + untouched buildChatContext",
    "B-T25: distinct status rendering; semantic_sweep_limited != no_match; valid passages kept",
    "B-T35: secrets masked (hasKey only); no key in responses",
    "frontend never fabricates passages/locators; pdf.js display-only"
  ],
  "constraints_checked": [
    "no backend code changed; A budget files byte-identical to main",
    "no real provider/credential/network; node vitest + renderToStaticMarkup (no browser)",
    "offline determinism (two-run identical); gofmt/tsc clean; no push",
    "legacy buildChatContext untouched when off"
  ],
  "ai_use_log_entry": "B-AI-014",
  "deviations_from_spec": [
    "Settings panel is self-contained; full AISettings-page navigation + live save/reload is a follow-up refinement (validation/masking complete and tested)"
  ],
  "open_questions": [
    "Phase-7 evaluation set: in progress per Phase-0 answer; RE-ASK NOW at the Phase 6/7 boundary",
    "Live provider measurement needs separate authorization",
    "C must confirm the final retrieval.passages spelling"
  ],
  "next_phase": "7-evaluation (blocked on the human-owned evaluation set)",
  "claim_tags": "all factual claims VERIFIED via cited evidence logs/commands; section 4 items are INFERRED design decisions within spec latitude"
}
```

## 6. Stop condition + Phase 7 dependency

Phase 6 ends here. **Phase 7 (evaluation replay) requires WANG Jiaqi's ≥20-question
gold-labeled evaluation set**, which was "in progress" at Phase 0. Per the
protocol the agent must NOT invent questions or gold labels. Re-asking now at
the Phase 6/7 boundary: does the set exist yet? If not, Phase 7 is marked
blocked-on-input and waits; the implementation (Phases 0–6) is complete and
ready for human review.