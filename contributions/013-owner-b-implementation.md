# 013 · Implement owner B hybrid question-relevant retrieval

- **Commit:** Phase 0 `docs: record B retrieval approval and phase-0 gate`; later phases append here; see this file's Git history.
- **Task owner:** WANG Jiaqi (B).
- **AI tool:** OpenCode (qwen4-max-preview); sessions logged as B-AI-008+ in `docs/ai-use-log.yaml`.
- **Scope:** FR-02, NFR-02, INV-04, INV-05; branch `owner/b-implementation` from `main` `83c7726`.
- **Related:** [ADR-002](../docs/architecture/adr/002-question-relevant-retrieval.md), [implementation plan](../docs/plans/b-retrieval-preimplementation.md), [requirements](../docs/req/requirements.yaml), PR #2 (design approval).
- **Review:** design approved via PR #2 review 5897467590 (orangesummertime, non-author, APPROVED 2026-11-13T20:19:58Z on `da21804`, merged as `83c7726`). Implementation acceptance remains a human non-author review; no self-approval is claimed.

## Phase 0 — approval and preconditions gate (2026-11-14)

### What changed

Documentation-only. Verified the approval chain read-only (git + GitHub REST
API): PR #2 author `Wjq1024`, single APPROVED review `5897467590` by
`orangesummertime` at `2026-11-13T20:19:58Z` on head `da21804`, merged into
`main` as `83c7726` (2026-11-14). Recorded the approval in the ADR-002 Status
header, the implementation-plan Status header and the four B requirement
entries (`approval: pending → approved`), citing the review and merge commit.
No technical content was changed; the requirements registry passes its JSON
schema after the edit.

### Verification (all commands actually run; raw logs retained)

- `go test ./... -count=1` in `src`: 43 ok packages, 11 no-test packages, exit 0
  (`docs/evidence/b-impl-phase0-baseline-go.log`).
- `npm ci --no-audit --no-fund` (159 packages), `npm run build` (exit 0,
  chunk-size warning only), `npm test -- --run`: 62 files / 251 tests passed,
  exit 0 (`docs/evidence/b-impl-phase0-baseline-vitest.log`). The prompt's
  61/231 baseline predates A's PR #6 merge; current main carries A's tests.
- Toolchains: go1.27.1 linux/amd64, node v26.13.0, npm 11.20.0 (match the
  stated baselines; invoked via per-command PATH prefixes, no persistent
  environment change).
- Latest published migration `081_selected_subtitle_index.sql`; B's proposed
  082/083/084 are free today (re-check at merge).
- `src/internal/retrieval/` absent (greenfield); A's budget files present and
  untouched (`git diff main` empty for `internal/ai/budget.go`, `ledger.go`,
  `adapters/aichat/budget.go`).
- Approval evidence: `docs/evidence/b-impl-phase0-approval.json` (raw API
  payloads) and `b-impl-phase0-approval.log` (commands + exit codes).
- Phase 0 report: `docs/evidence/b-impl-phase0-report.md`.

### Limits and open items

- No implementation code exists yet; this record claims no retrieval behavior.
- One residual documentation inconsistency is flagged for human confirmation:
  the plan's overview paragraphs (`docs/plans/b-retrieval-preimplementation.md`
  "Baseline and proposed behavior" item 2 and "Frontend / backend
  responsibilities") still describe a conditional sweep trigger, while ADR-002
  §Decision 1b and the plan's detailed budget section require the unconditional
  sweep. ADR precedence resolves it; no technical text was edited in Phase 0.
- Phase 7 depends on the ≥20-question evaluation set with gold labels prepared
  personally by WANG Jiaqi; its existence was asked in the Phase 0 report.
  Phase 7 waits for that set; no questions or labels are invented.
- Network activity: read-only GitHub API GETs and npm registry reads only; no
  push, no provider call, no browser.

## Phase 1 — domain core (2026-11-14)

### What changed

New stdlib-only domain package `src/internal/retrieval/` implementing the
approved ADR-002/plan contracts: exact plan domain types (`Passage`,
`Selection`, `Embedder`, `PassageSelector`, `ContextAssembler`, …) and ports
(`PassageSource`, `PDFText`); sentence/segment splitter (CJK+Latin
terminators, abbreviations, quotes, code fences, emoji; 1–3 sentences /
200–800 runes; subtitle cue groups 3–8 cues / 15–60 s; headings/pages never
crossed); deterministic lexical scorer (exact phrase, distinct-term coverage,
saturating TF, proximity); unconditional position-stratified sweep sampler
(indices `floor(k*N/S)`, `Stride=ceil(N/S)`, `Coverage=S/N`); mode-aware
proportional capped budget mathematics with code-asserted invariants; hybrid
scoring with weight validation/normalization and the stable tie-break;
whitespace-normalized dedupe; six-layer assembler (rune + 200,000-byte caps,
drop sequence, degraded 8k profile, constraint re-injection); INV-04 preflight
and INV-05 re-read verifier; selector orchestrating validate → preflight →
load/split → lexical → sweep → embed → dedupe/verify.

### Verification (test-first; raw logs retained)

- First run RED: 8 failure groups recorded in
  `docs/evidence/b-impl-phase1-red.log`; fixed within phase scope
  (implementation bugs: ellipsis re-scan, grouping min-check order, wrapped
  sentinel comparison, zero-capacity lexical fallback, reminder re-injection
  flag; plus documented test-expectation corrections).
- GREEN: 31 test functions covering B-T02, B-T06, B-T08, B-T10, B-T14, B-T15,
  B-T16, B-T17, B-T19, B-T21 (both halves), B-T22, B-T29, B-T39, B-T40 (A/B/C)
  plus budget worked examples, sweep/weights/dedupe/no-match/empty-input/
  embedder-failure/determinism (`b-impl-phase1-retrieval.log`).
- Gates: focused packages exit 0 (`b-impl-phase1-focused.log`); full Go suite
  44 ok / 11 no-test exit 0 (`b-impl-phase1-go-full.log`); layering + vet +
  A-budget empty-diff proof (`b-impl-phase1-layering.log`); frontend unchanged
  62 files / 251 tests + build exit 0 (`b-impl-phase1-web.log`); two-run
  determinism diff identical (`b-impl-phase1-determinism.log`).
- Phase report: `docs/evidence/b-impl-phase1-report.md`.

### Limits

- Adapters (SQLite source, PDF, embedding/rerank), transport and frontend are
  later phases; the domain is exercised through fakes only. Fake hash vectors
  are unit-test-only, never an NFR-02 claim. B-T33's full fake-transport mode
  matrix runs in Phase 4 (budget math half already reproduced here).
- NFC normalization is deferred (stdlib-only constraint); matching uses
  lowercase + whitespace/line-ending normalization on precomposed fixtures.
- No recall measurement yet; Phase 7 waits for WANG Jiaqi's evaluation set.

## Phase 2 — source loading and content version (2026-11-14)

### What changed

- **Migration 084** (`084_content_revision.sql` + Go step `addContentVersion`):
  adds `content_revision` (monotonic INTEGER, default 1) and `content_hash`
  (SHA-256 of the normalized snapshot) to `saved_content`; backfills legacy
  rows with revision 1 + computed hash; pragma-checked and idempotent. B owns
  the column set; a test asserts exactly one migration introduces it.
- **`content.Item`**: new server-owned `ContentRevision`/`ContentHash`
  (`omitempty`), exposed through Get/List/Page and the library JSON API.
  `Store.Save` ignores client-supplied values, increments the revision on
  every successful update, replaces the hash, and never embeds the fields in
  the payload.
- **`retrieval.SnapshotHash` / `SnapshotRange`** (domain): canonical
  normalized-snapshot hash (whitespace/line-ending normalized, case
  preserved, version/contentID excluded) and exact locator-range re-read.
- **`sqlite.RetrievalSource`**: implements the `retrieval.PassageSource` port
  — normalized article/discussion snapshots, saved subtitle tracks (cue IDs
  are deterministic language-qualified indices; saved cues have no DB ID),
  and fresh re-reads for INV-05. PDF page text joins in Phase 3.

### Verification (test-first; raw logs retained)

- Red run retained (`b-impl-phase2-red.log`); green after implementation.
- New tests: B-T03 (144,011-rune subtitle fixture, gold cue 2,999, locator
  `subtitle:zh:2992-2999`, cue IDs, exact text once), B-T19 storage half
  (update → `stale_source`, fresh selection carries revision 2), B-T28
  revision part (old reference invalid, new verifies), B-T38 (old-DB upgrade
  backfill, increment, idempotent re-open, single column owner, API shape),
  domain hash/range determinism (`b-impl-phase2-tests.log`).
- Gates: focused exit 0 (`b-impl-phase2-focused.log`); full 44 ok / 11
  no-test exit 0 (`b-impl-phase2-go-full.log`); layering + vet + A-budget
  empty diff + published migrations unchanged (`b-impl-phase2-layering.log`);
  frontend 62 files / 251 tests + build exit 0 (`b-impl-phase2-web.log`);
  two-run determinism identical (`b-impl-phase2-determinism.log`).
- Two existing upgrade tests (progress, subscriptions) now assert the
  backfill fields explicitly, then compare every original field unchanged;
  the library card projection exposes the version fields consistently.
- Phase report: `docs/evidence/b-impl-phase2-report.md`.

### Limits

- PDF page-text store/extraction is Phase 3; the PDF snapshot kind currently
  carries no pages. Embedding/rerank adapters and the B budget are Phase 4.
- `content_hash` covers the article/discussion snapshot in `saved_content`;
  subtitle versions use the existing saved-track revision, PDF uses the
  document hash + extractor provenance (per plan).

## Phase 3 — PDF extraction (2026-11-14)

### What changed

- **Domain ports + service** (`retrieval/pdf.go`): `PDFTextExtractor`,
  `OCRProvider`, `PDFTextStore`; `PDFExtractionService` orchestrates hash →
  idempotency → native extraction → OCR fallback for text-less pages →
  page-count validation → store. Statuses `ready`/`pdf_extracting`/
  `pdf_ocr_unavailable`/`pdf_no_text`/`pdf_extract_failed`; at most one active
  extraction per content+hash; no fabricated text. New `ErrStaleSource`
  sentinel maps to `stale_source` in the verifier.
- **Migration 082** `pdf_page_text`: `(content_id, page)` key +
  document_sha256, page_count, text, text_sha256, extractor, extractor_version,
  ocr_job_id, ocr_state, extracted_at; indexes on content_id and
  document_sha256. Saving a new hash replaces old rows (invalidates old refs).
- **Native extractor** (`adapters/pdftext/native.go`): vetted pure-Go
  `github.com/ledongthuc/pdf` (BSD-3-Clause, zero deps, pinned; license in
  `docs/licenses`). Per-page text, streamed document SHA-256, encrypted/corrupt
  → explicit error, ctx honored.
- **Local PaddleOCR** (`local_ocr.go`): user-installed runtime/model paths,
  recommended `PaddleOCR-VL-1.6`, no token/upload; missing runtime/model →
  unavailable; fake `CommandRunner` for tests.
- **Cloud PaddleOCR** (`cloud_ocr.go`): feature-flagged OFF + consent required;
  submit → bounded poll pending/running/done → download `resultUrl.jsonUrl` →
  parse `result.layoutParsingResults[].markdown.text`; page-count validation;
  token in header only, error bodies redacted.
- **`RetrievalSource`** now loads stored PDF pages and reports `stale_source`
  when a PDF locator's document hash was replaced.

### Verification (test-first; raw logs retained)

- Red run retained (`b-impl-phase3-red.log`); green after implementation.
- New tests (20 in the determinism set): B-T04 (orchestration + native +
  end-to-end page-50 selection), B-T27 (variants incl. encrypted/corrupt/
  timeout/mismatch), B-T28 (domain + adapter hash invalidation), B-T34 (local
  fake runtime, cloud fake job flow/failures/redaction), B-T37 (local-first +
  cloud guards), concurrency, schema (`b-impl-phase3-determinism.log`).
- Gates: focused exit 0 (`b-impl-phase3-focused.log`); full 45 ok / 11 no-test
  exit 0 (`b-impl-phase3-go-full.log`); layering + vet + gofmt + A-budget empty
  diff + published migrations unchanged (`b-impl-phase3-layering.log`);
  frontend 62 files / 251 tests + build exit 0 (`b-impl-phase3-web.log`).
- Phase report: `docs/evidence/b-impl-phase3-report.md`.

### Limits

- No real OCR runtime/model is bundled or downloaded; local OCR needs user
  installation. Cloud OCR stays feature-flagged off pending legal/terms review
  (B-D05). The native fixture uses ASCII text (font-independent); CJK PDFs are
  exercised through the OCR path with fakes.
- Embedding/rerank adapters + B budget are Phase 4; transport/AI integration
  Phase 5; frontend Phase 6; evaluation Phase 7 (waits for WANG Jiaqi's set).

## Phase 4 — embedding/rerank adapters + B budget (2026-11-14)

### What changed

- **B-only budget** (`retrieval/embedding_budget.go`): `BudgetTracker` reserves
  a slot before every remote POST; request limit / usage-unknown stop further
  calls; statuses completed/embedding_budget_limited/embedding_budget_exhausted/
  embedding_usage_unknown. Independent of A's completion ledger.
- **Vector cache** (`retrieval/vector_cache.go` + `sqlite/vector_cache.go`):
  process-local default and opt-in persistent SQLite (migration 083), keyed by
  (contentId, sourceVersion, passageId, modelId, dimensions); identity change ⇒
  miss; dimension mismatch rejected.
- **Embedding settings** (`retrieval/embedding_settings.go`): local-first
  default (bge-m3/1024, loopback), per-model Bailian dimension/row limits,
  weight/budget validation, local-loopback enforcement, masked API shape
  (hasKey/hasRerankKey only).
- **Embedding adapter** (`aichat/embedding.go`): implements `retrieval.Embedder`
  over OpenAI-compatible and DashScope surfaces; role-correct text_type (split
  never mixes roles), query-only instruct, float/base64, dimension + model
  identity validation (fail closed), usage-unknown handling, redacted errors,
  fixed-string connection test. Uses B's budget, never A's reserveCompletion.
- **Rerank adapter** (`aichat/rerank.go`): off by default; DashScope/compatible
  surfaces; request-relative scores clamped [0,1]; B-budgeted; failure → error
  for rerank_unavailable degradation.
- **Selector mode-aware batching** (`retrieval/selector.go`): shared combines
  question+docs → ceil((1+C)/B) requests; split reserves a query request →
  1+ceil(C/B). Phase-1 provisional call-count assertions aligned.
- **Settings persistence** (`sqlite/retrieval_settings.go`, migration 085):
  save/reload preserves all fields; unsaved load returns the labelled default;
  invalid settings rejected; key never returned.

### Verification (test-first; raw logs retained)

- B-T33 full mode matrix through real selector+adapter+httptest: exact request
  counts (shared R24=24, split R25=25, split R24=24), zero-capacity rows make 0
  requests, split never mixes roles, -1 → invalid_budget, sweepCandidates=0 →
  sweep_disabled_by_config, char-bound shrinks both shares.
- B-T24/B-T26/B-T30/B-T31/B-T32/B-T35/B-T36/B-T37(embedding) all green; 26-test
  determinism set identical across two runs.
- Gates: focused exit 0 (`b-impl-phase4-focused.log`); full 45 ok / 11 no-test
  exit 0 (`b-impl-phase4-go-full.log`); layering + vet + gofmt + A-budget empty
  diff + B adapters never call reserveCompletion (`b-impl-phase4-layering.log`);
  frontend 62 files / 251 tests + build exit 0 (`b-impl-phase4-web.log`);
  determinism (`b-impl-phase4-determinism.log`).
- Phase report: `docs/evidence/b-impl-phase4-report.md`.

### Limits

- All provider tests use httptest fakes; no real embedding/rerank call or
  credential. Live provider measurement is a separate authorized run.
- Selector-level vector-cache wiring (per-passage keys) lands in Phase 5; the
  cache port + both implementations + unit tests are complete here.
- Cloud embedding requires an explicit provider switch (local-first default).

## Phase 5 — AI service + transport integration (2026-11-14)

### What changed

- **Wire object** (`retrieval/wire.go`): namespaced `Request`/`Response`/
  `PassageRef`/`EmbeddingSummary`/`RerankSummary` (schemaVersion 1) and a
  `StatusError` carrying a distinct retrieval status.
- **Engine** (`retrieval/engine.go`): `Run` orchestrates validate budgets →
  preflight → select → assemble → wire response, with a budget-counting
  embedder wrapper; returns the assembled six-layer context + response, or a
  StatusError (zero chat) on rejection.
- **AI service** (`ai/chat.go`, `translation_types.go`): `ChatRequest.Retrieval`
  / `ChatResult.Retrieval` (omitempty); optional `SetRetrievalEngine` (legacy
  path unchanged when unset); when enabled, runs the engine before any chat
  POST, ignores the client context, uses the assembled context as the system
  message source, and attaches the response. Rejections return zero chat POST.
- **Transport** (`http/ai_retrieval.go`, `ai_summary.go`): each status maps to
  a distinct HTTP status/code/copy; SSE rejection emits a terminal data frame
  with the retrieval object and never `event: done`; unknown retrieval fields
  rejected by the strict decoder.
- **Composition root** (`app/wire_services.go`, `feature_services.go`): wires
  the engine (SQLite source, local-first embedder, process-local cache).

### Verification (test-first; raw logs retained)

- B-T01 retrieval-off golden (byte-identical context, unchanged field set,
  selector/embedder never called); B-T05 no_match zero chat; B-T07 injection
  is data; B-T09 invalid inputs zero POST; B-T17 byte cap; B-T25 HTTP/SSE
  mapping (12 statuses), no-done-on-rejection, sweep-limited != no_match,
  unknown-field rejection.
- B-T11 regression: full Go suite 45 ok / 11 no-test, frontend 62 files / 251
  tests, all green.
- Gates: focused exit 0 (`b-impl-phase5-focused.log`); full exit 0
  (`b-impl-phase5-go-full.log`); layering + vet + gofmt + A-budget empty diff
  (`b-impl-phase5-layering.log`); frontend (`b-impl-phase5-web.log`);
  two-run determinism identical (`b-impl-phase5-determinism.log`).
- Phase report: `docs/evidence/b-impl-phase5-report.md`.

### Limits

- Rerank-in-selector scoring is not wired (rerank off by default; the adapter
  is tested in Phase 4); the response reports rerank disabled.
- The Engine uses fixed topK=100/batch=8 defaults from the request; full
  settings-driven selector config (weights/topK from saved settings) is a
  refinement for the frontend phase.
- No real provider call; fake provider/source/embedder and fake AIService.

## Phase 6 — frontend wiring (2026-11-14)

### What changed

- **Pure modules** (`retrieval.ts`, `retrievalSettings.ts`,
  `retrievalPresentation.ts`): the namespaced wire types + request fragment
  (empty when off → byte-compatible legacy body); local-first settings with
  per-model Bailian dimension choices, weight/budget validation, rerank-zero
  guard and secret masking (hasKey only); distinct status copy/tone and
  passage-chip labels (semantic_sweep_limited ≠ no_match).
- **Components** (`RetrievalStatus.tsx`, `RetrievalSettings.tsx`): explicit
  status + verifiable passage chips (coverage-limited keeps passages); a
  settings form with per-model dimensions and the rerank guard.
- **AIChatPanel wiring** (`AIInsights.tsx`, `ai.css`): an opt-in retrieval
  toggle (default off), the retrieval request fragment, response capture
  (JSON + SSE), and RetrievalStatus rendering. The legacy buildChatContext
  path is untouched when off; pdf.js remains display-only.

### Verification (test-first; raw logs retained)

- 27 new vitest tests: B-T01 (off byte-compatible, legacy context untouched),
  B-T05 (no_match marker, zero chips), B-T25 (distinct status copy,
  sweep-limited ≠ no_match with passages kept, PDF retry hints), B-T31
  (per-model dims/row limits, local loopback), B-T32 (weights), B-T35
  (masking, no key leak).
- Gates: frontend 66 files / 278 tests + build (incl. tsc --noEmit) exit 0
  (`b-impl-phase6-web.log`); Go regression 45 ok / 11 no-test + layering exit 0
  (`b-impl-phase6-go.log`); two-run frontend determinism identical
  (`b-impl-phase6-determinism.log`).
- Phase report: `docs/evidence/b-impl-phase6-report.md`.

### Limits

- The settings panel is a self-contained component; full integration into the
  AISettings page navigation and live save/reload against the backend
  settings endpoint is a follow-up (the validation/masking logic is complete
  and tested).
- No browser/E2E run (node-environment vitest + renderToStaticMarkup only).
- Phase 7 evaluation still waits for WANG Jiaqi's gold-labeled set.
## Phase 7 — evaluation replay (2026-11-14)

### What changed

- **Evaluation set** (`test/offline/eval-b/`): AI-drafted at the user's
  request (B-AI-014), then **human-confirmed and frozen** (WANG Jiaqi
  sign-off in session, 2026-11-14; freeze hashes recorded). 24 primary
  answerable questions + 2 provisional OCR questions across 7 fictional
  documents (article / saved subtitle / PDF page text; 141k–165k runes each,
  BMP-only): middle-third golds + head/tail controls, heading trap, repeated
  sentence/cue, same-language and cross-language zero-overlap paraphrases
  (B-T39), two distractor-saturated documents with gold on/off the sampled
  sweep index (B-T40), sweep-clamp and character-bound fixtures, plus a
  12-case negative set. Gold granularity uses the REAL retrieval
  splitter/grouping; every gold was validated through `retrieval.NewSelector`
  before the run; an independent Python cross-validator re-checks 696 items.
- **Replay harness** (`evalutil/`, `replay/`, `vectorgen/`, `report/`):
  baseline (`buildChatContext` head/tail) vs lexical-only vs hybrid at 120k
  AND 8k (never pooled), budget-invariant runs (starved / char-bound /
  high-budget × shared/split), negative set, and B-T12 double-run.
  `vectorgen` is the ONE live pass (protocol §9 gate: refuses without
  `-authorize`), through the real `aichat.EmbeddingClient`; the key is read
  at runtime and never written to any file or log.

### Verification (raw logs retained)

- **NFR-02: PASS** — hybrid-split 120k **23/24 = 0.9583** (≥0.80, ≥ baseline
  0.2500, ≥ lexical-only 0.7917); 8k 23/24 with explicit `degraded_budget`;
  the only miss (BQ-021) is the intentional coverage-limited outcome and
  stays in the denominator. Zero-overlap paraphrases and the on-sample
  distractor gold all hit via the bounded sweep at recorded coverage.
- B-T12 (byte-identical frozen replay), B-T13 (threshold + comparisons),
  B-T18 (8k stress), negative set 12/12, budget invariants in all 6 configs:
  `go test ./replay -count=1` exit 0 (`b-impl-phase7-eval-tests.log`).
- Go regression 46 ok / 11 no-test + layering exit 0
  (`b-impl-phase7-go-full.log`); no `src/` implementation change this phase.
- Live pass (explicitly authorized): Bailian DashScope `text-embedding-v4`,
  1024 dims, split text_type; 740 requests, 544,390 tokens (≈ CNY 0.27, cap
  CNY 10), 0 errors; vectors frozen with payload hash; replays zero-network.
- Report: `docs/evidence/b-eval-report.md` (+ `b-eval-per-question.json`,
  192 records with full selected passage IDs); phase report:
  `docs/evidence/b-impl-phase7-report.md`.

### Limits

- Recorded deviation: no local embedding server/model exists in this
  environment, so the authorized Bailian provider replaces the local-first
  default; `hybrid-shared` is a labeled simulation, `hybrid-split` carries
  the decision. A pinned-local bge-m3 rerun remains an optional follow-up.
- OCR subset (BQ-025/026) not evaluated: local PaddleOCR runtime unavailable
  (`pdf_ocr_unavailable`); provisional expected-text fixture stays gated and
  out of the primary denominator.
- This is sentence/segment recall, not answer correctness; C's citation
  verification and D's comparison quality are separate.
- PR opened at the owner's request:
  https://github.com/orangesummertime/CS5351_SE_Group2/pull/7 — non-author
  human review is arranged by the owner; the agent does not self-approve or
  merge.
