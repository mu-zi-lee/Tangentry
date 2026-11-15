# B implementation · Phase 1 report — domain core

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation` (from `main` `83c7726`)
- **Phase status:** complete (awaiting human confirmation before Phase 2)
- **Session:** B-AI-009 (same continuous session as B-AI-008, `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 0 confirmed by human; unconditional-sweep reading confirmed; eval set "in progress" (re-ask at Phase 6/7); vector cache decision "both" (process-local default + optional persistent in Phase 4).

## 1. What was built (VERIFIED: files exist, suite green)

New domain package `src/internal/retrieval/` — **stdlib only**, no imports of
adapters/transport/app/server/ai (layering test green).

| File | Content |
| --- | --- |
| `types.go` | Exact plan types: `SourceKind`, `Passage`, `EmbedRole`, `BatchingMode`, `Embedder`, `SelectionStatus` (plan constants + §5.6 additions), `Selection` (incl. anonymous `Sweep` struct), `PassageSelector`, `SweepConfig`, `HistoryTurn`, `AssemblyInput`, `Assembly`, `ContextAssembler`; budget constants (1–1,000,000 runes, 200,000 bytes, 120,000 default, 8,000 stress) |
| `ports.go` | `PassageSource` (Snapshot + ReadRange re-read), `PDFText`; `Block`/`DiscussionPost`/`Cue`/`SubtitleTrack`/`Page`/`Snapshot` |
| `budget.go` | §5.1 mode-aware math (integer arithmetic), `Validate` (0=off, negative=invalid), `ComputeShares` with code-asserted invariants, `ColdCacheRequests`, `ValidateAssemblyBudget` (float boundary: NaN/Inf/non-integer/range) |
| `split.go` | Sentence splitter (CJK/Latin terminators, abbreviations, decimals, quotes incl. CJK corners, code fences, ellipsis runs, astral runes); `GroupSegments` (1–3 sentences, 200–800 runes); `GroupCueSegments` (3–8 cues, 15–60 s, IDs/language/times preserved) |
| `lexical.go` | Deterministic scorer: exact normalized phrase, distinct-term coverage (Latin tokens + CJK bigrams), saturating TF, min-window proximity |
| `sweep.go` | `SampleSweep`: indices `floor(k*N/S)` (exactly S), `Stride=ceil(N/S)`, `Coverage=S/N`, `Limited=(S<N)`; no randomness |
| `score.go` | Weight validation/normalization, `HybridScore` (cosine clamped [0,1]), `Cosine`, stable tie-break sort (hybrid↓ → lexical↓ → rerank↓ → source order → segment index; kind priority article/subtitle/pdf/discussion per ADR step 6) |
| `identity.go` | Locator/ID builders + parser for all four source kinds; multi-sentence `s3-s5` (end exclusive, matching `SentenceEnd`) |
| `dedupe.go` | Whitespace-normalized text SHA-256 key; highest score wins, ties → first stable locator; re-sort |
| `verify.go` | INV-05: structural checks (range, hash, locator) + port re-read; version mismatch → `stale_source`, text/locator mismatch → `source_unverified` |
| `preflight.go` | INV-04: invalid budget / below mandatory minimum (identity + reminder + one minimum passage + locator) / byte estimate → rejection before any work |
| `assemble.go` | Six layers with default caps 1,000/3,000/84,000(60,000+24,000)/24,000/4,000/4,000; proportional scaling below 120k; degraded ≤8k profile (500/1,000/5,500/1,000, summary/history/state disabled + explicit note); drop sequence lowest-passages → summary-at-sentence-boundary → oldest-history; rune+byte enforcement; constraint reminder re-injected before task after any compression; unused summary share never reallocated |
| `selector.go` | INV-04 ordering: input validation → budget validation → preflight → load/split → lexical → unconditional sweep → embedding (role-correct calls) → dedupe/sort → INV-05 verify → explicit status; zero-capacity/no-embedder → `lexical_only` with full top-K; all-zero scores → `no_match` |
| `errors.go`, `normalize.go`, `version.go` | Sentinels; rune/byte helpers, matching normalization, SHA-256; subtitle/PDF version strings |

## 2. Test-first evidence (VERIFIED)

- **Red run retained:** `docs/evidence/b-impl-phase1-red.log` — 8 failure
  groups on the first assertion run (after one compile-fix iteration).
- **Root causes fixed in implementation:** ellipsis runes re-scanned after
  flush; segment min-rune check applied after adding instead of before;
  `err == ErrInvalidBudget` failed on wrapped errors (→ `errors.Is`);
  zero-capacity runs zeroed the lexical shortlist instead of falling back to
  top-K `lexical_only`; reminder flag missed pre-fit compression.
- **Test-expectation corrections (genuinely wrong setups, documented, no
  assertion weakened):** shared R=25 cold-cache is `ceil(191/8)=24` (not 25);
  a trailing terminator-less emoji is a valid sentence (3 not 2); BT08
  question terms must match the filler; BT21 impossible-assembly case must
  use the never-dropped current history turn (fixed layers scale to fit);
  BT22 must use a >8k budget (history is disabled in the degraded profile).
- **Green:** 31 test functions, 0 failures (`b-impl-phase1-retrieval.log`).

B-Txx mapping (all Phase-1 listed tests present):

| B-Txx | Test function(s) |
| --- | --- |
| B-T02 | `TestBT02_MiddleAnswer` (156,032-rune fixture, gold ~78,000; baseline misses, byte cap exceeded) |
| B-T06 | `TestBT06_Dedupe` (article + cross-language cues; two-run JSON identical) |
| B-T08 | `TestBT08_Oversize` (10,000-rune sentence dropped whole; multi-sentence splits at boundaries) |
| B-T10 | `TestBT10_InvalidAssemblyBudget` (0, -1, 1.5, NaN, ±Inf, 1,000,001; zero work) |
| B-T14 | `TestBT14_VerifyReread` (article/subtitle/PDF re-read; stable IDs) |
| B-T15 | `TestBT15_ForgedPassages` (forged ID, negative start, beyond end, hash/text mismatch; `no_verified_passages`) |
| B-T16 | `TestBT16_PropertyMatrix` (4 Unicode classes × 4 sizes × 8 budgets incl. boundaries) |
| B-T17 | `TestBT17_ByteCap` (120,000 CJK = 360,000 bytes; reduce/reject, never send) — early coverage; transport half in Phase 5 |
| B-T19 | `TestBT19_StaleVersion` (version change → `stale_source`) — early coverage; storage half in Phase 2 |
| B-T21 | `TestBT21_PreflightZeroRequests` (zero embed/source calls) + `TestBT21_PostEmbeddingDropOrder` (exact drop order/counts) |
| B-T22 | `TestBT22_HistoryOverflow` (oldest-first, current turn kept, reminder before task, bounds) |
| B-T29 | `TestBT29_Splitter`, `TestBT29_SegmentGrouping`, `TestBT29_CueGrouping` |
| B-T39 | `TestBT39_ZeroOverlapDegenerateLexical` (exact 156,000-rune fixture; zero coverage; exact sampled set/stride/coverage; 1+ceil(90/8) embed calls; lexical-only misses) |
| B-T40 | `TestBT40_DistractorSaturated` A (24 distractors, gold sampled, hybrid selects) / B (off-sample → `semantic_sweep_limited`, never `no_match`, passages kept) / C (char pressure: both shares shrink, sweep ≥1, never zeroed while lexical embedded) |
| extras | budget worked examples + invariant grid (B-T33 math half), `TestSweepSampler`, `TestWeightsValidation` (B-T32 math half), `TestSelectorNoMatch` (B-T05 domain half), `TestSelectorEmptyAndInvalidInput` (B-T09 domain half), `TestSelectorEmbedderFailure` (B-T26 domain half), `TestSelectorSweepDisabledByConfig`, `TestAssemblyDegradedProfile`, `TestAssemblyDefaults`, `TestDeterminismTwoRuns` |

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| `cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... -count=1` | 0 | 3 ok | `b-impl-phase1-focused.log` |
| `cd src && go test ./... -count=1` | 0 | **44 ok / 11 no-test** (43 baseline + new retrieval) | `b-impl-phase1-go-full.log` |
| `cd src && go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase1-layering.log` |
| `cd src/web && npm test -- --run` | 0 | 62 files / 251 tests (unchanged) | `b-impl-phase1-web.log` |
| `cd src/web && npm run build` | 0 | built (chunk-size warning only) | `b-impl-phase1-web.log` |
| `go vet ./internal/retrieval/` | 0 | clean | `b-impl-phase1-layering.log` |
| two-run determinism diff | 0 | identical normalized outcomes; in-test byte-identical JSON/context | `b-impl-phase1-determinism.log` |
| `git diff main --` A budget files / `internal/ai` / `protocol.go` | 0 | **empty** (A untouched) | `b-impl-phase1-layering.log` |
| gofmt | 0 | clean after `gofmt -w` | session output |
| secret pattern scan | 1 (no matches) | clean | session output |

## 4. Design decisions recorded (INFERRED where the spec leaves room)

1. **Sweep index formula:** `floor(k*N/S)` gives exactly S samples so
   `Coverage=S/N` holds exactly (the literal "every ⌈N/S⌉-th" reading can
   yield fewer than S); `Stride=ceil(N/S)` reported per spec. Deterministic;
   exact index sets asserted in B-T39/B-T40.
2. **Stdlib-only normalization:** no `x/text` (domain import constraint);
   matching uses lowercase + line-ending/whitespace normalization; full NFC
   deferred ("NFC where safe"). Fixtures use precomposed characters.
3. **Zero-capacity lexical fallback:** `R=0`/no embedder → `lexical_only`
   with the full top-K shortlist (embedding allocation constrains the lexical
   side only when embedding is possible) — matches B-T33 "R=0 → lexical_only
   + embedding_budget_exhausted" and the plan's fallback wording.
4. **Assembly budget omission:** domain rejects explicit 0/negative as
   `invalid_budget`; omission-as-labelled-default is the wire layer's job
   (Phase 5), which can distinguish absent from explicit zero.
5. **Layer scaling:** below 120k, caps scale proportionally (integer floor);
   ≤8k uses the degraded profile; above 120k caps stay at defaults.
6. **no_match rule:** all-zero hybrid scores (no lexical, no semantic
   similarity) → explicit `no_match`, zero passages. With real embeddings a
   positive-similarity threshold may be needed — flagged for Phase 7
   evaluation (not tuned now).
7. **Rerank score carrier:** plan `Passage` has no rerank field (copied
   exactly); rerank scores will live in a selector-side map in Phase 4 and
   feed the tie-break via `SortPassages(ps, rerankMap)`.
8. **B-T05 zero-POST scope:** with no embedder configured, no_match starts
   zero embedding calls (tested). With an embedder, the unconditional sweep
   spends budget before no_match is known; spent counts are reported
   (INV-04 post-embedding accounting), chat stays zero.

## 5. Structured report

```json
{
  "phase": "1-domain-core",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-1 commit> feat(retrieval): add domain core with test-first B-Txx suite"],
  "files_changed": ["src/internal/retrieval/ (22 files: 15 implementation + 7 test)"],
  "tests_added": ["B-T02","B-T06","B-T08","B-T10","B-T14","B-T15","B-T16","B-T17","B-T19","B-T21","B-T22","B-T29","B-T39","B-T40","budget-math worked examples (B-T33 half)","determinism/no-match/empty-input/embedder-failure/weights/sweep extras"],
  "test_results": [
    {"command": "cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... -count=1", "exit_code": 0, "summary": "3 ok", "evidence": "docs/evidence/b-impl-phase1-focused.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "44 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase1-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase1-layering.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "62 files / 251 tests", "evidence": "docs/evidence/b-impl-phase1-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built", "evidence": "docs/evidence/b-impl-phase1-web.log"}
  ],
  "invariants_verified": [
    "INV-04 preflight: zero embedding/source calls on invalid/below-minimum budgets (B-T21)",
    "INV-04 post-embedding: exact drop order, context_budget_exceeded, no over-budget output (B-T16/17/21/22)",
    "INV-05: re-read through port; forged/range/hash/version mismatches dropped (B-T14/15/19)",
    "budget caps/spare: all worked-example rows exact; invariant grid green"
  ],
  "constraints_checked": [
    "layering green; retrieval imports stdlib only",
    "A ledger untouched (git diff main empty for budget.go/ledger.go/aichat/budget.go and all of internal/ai + protocol.go)",
    "no secrets in code/logs (pattern scan clean)",
    "offline determinism: fixed fixtures/fakes; two-run diff identical; byte-identical replay assertions",
    "runes vs bytes: CJK + astral fixtures; 360,000-byte case reduced/rejected",
    "-count=1 everywhere; no test cache",
    "no push to main; no force-push; no published migration touched (no migrations this phase)"
  ],
  "ai_use_log_entry": "B-AI-009",
  "deviations_from_spec": [
    "NFC deferred (stdlib-only constraint) — recorded interpretation of 'NFC where safe'",
    "sweep indices floor(k*N/S) chosen to make Coverage=S/N exact — documented",
    "B-T17/B-T19 domain halves tested early (transport/storage halves remain in Phases 5/2)"
  ],
  "open_questions": [
    "Phase-7 evaluation set still in progress (re-ask at Phase 6/7 boundary)",
    "no_match positive-similarity threshold for real embeddings: tune/validate in Phase 7, not now"
  ],
  "next_phase": "2-source-version",
  "claim_tags": "every factual claim above is VERIFIED by the cited evidence file/command; section 4 items are INFERRED design decisions within spec latitude, flagged for reviewer awareness"
}
```

## 6. Stop condition

Phase 1 ends here. Waiting for human confirmation before Phase 2 (source
loading + content version: B-T03, B-T19 storage half, B-T28 revision part,
B-T38; migration 084 with legacy backfill on an old-DB fixture).