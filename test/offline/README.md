# test/offline · deterministic suites

This directory is the course-facing entry point for **offline, deterministic**
tests. It is documentation-only in the current docs branch; the actual test
files are added only after the B implementation plan is approved.

## Rules

- No network, credentials, provider calls, browser or wall-clock dependence.
- Fixed fixtures only; no real user data.
- Assert exact values/counts/bytes/IDs, not only a final status.
- Go tests use `-count=1` so the cache cannot hide a regression.
- Keep raw command output and exit codes for review.

## Commands

Run from the repository root:

```bash
cd src
go test ./... -count=1
go test ./internal/ai/... ./internal/transport/http/... ./internal/adapters/sqlite/... -count=1
go test ./internal/layering -count=1

cd ../web
npm test
npm run build
```

Focused B tests, once implemented:

```bash
cd src
go test ./internal/retrieval/... -count=1
go test ./internal/ai/... -run 'Retrieval|Chat' -count=1
cd ../web
npm test -- src/features/ai/chatContext.test.ts
```

## B-Txx mapping

| Area | Planned tests | Notes |
| --- | --- | --- |
| Compatibility | B-T01, B-T11 | Retrieval off must match the recorded `buildChatContext` context and response field set (wall-clock `updatedAt` normalized). |
| Middle-answer retrieval | B-T02, B-T03, B-T04 | Article sentence/segment, subtitle cue group, PDF page/sentence. |
| Zero-overlap paraphrase | B-T39, B-T40 | Unconditional bounded deterministic semantic sweep; degenerate lexical stage (T39) and a full shortlist of distractors (T40); `semantic_sweep_limited` with `sweepCoverage` when the sample cannot cover the document. |
| No match / safety | B-T05, B-T07, B-T23 | Explicit `no_match`; untrusted passage text; no head/tail masquerade. |
| Dedupe / oversize / Unicode | B-T06, B-T08, B-T09, B-T17, B-T29 | Duplicate text, oversize segment, empty/astral input, byte cap, sentence splitter. |
| Budget invariants | B-T10, B-T16, B-T21, B-T22 | Invalid budget, property checks, drop order, history/constraint re-injection. |
| Locator invariants | B-T14, B-T15, B-T19, B-T20 | Exact source mapping, forged/out-of-range, stale source, C reference contract. |
| Hybrid / embeddings | B-T12, B-T18, B-T24, B-T26, B-T30, B-T31, B-T32, B-T33, B-T35, B-T36, B-T37 | Frozen vectors, 8k stress, B-only budget, local-first defaults, provider settings/dimensions, weights, config reload, rerank fallback. |
| PDF / OCR | B-T04, B-T27, B-T28, B-T34, B-T37 | Text layer, local-default/cloud-opt-in OCR, no-text/encrypted/timeout, JSONL, token redaction, document-hash invalidation. |
| Versioning | B-T38 | Content revision/hash migration, legacy backfill, idempotency, no duplicate C/E column migration. |
| Regression | B-T11 | Full Go, Vitest, layering test. |

The canonical list and expected outcomes are in
[`docs/plans/b-retrieval-preimplementation.md`](../../docs/plans/b-retrieval-preimplementation.md).

## Fixtures and evidence

- **Phase-7 evaluation set (DRAFT, human confirmation pending):**
  [`eval-b/`](eval-b/README.md) — 24 primary + 2 provisional OCR questions with
  gold labels in protocol format, deterministic fixtures, run-config matrix
  and negative set. AI-drafted at the user's request; WANG Jiaqi must confirm
  every label before the NFR-02 run (`b-eval-protocol.md` §3).
- Baseline fixtures and raw output: [`docs/evidence/b-baseline.md`](../../docs/evidence/b-baseline.md),
  [`docs/evidence/b-baseline.log`](../../docs/evidence/b-baseline.log).
- FTS/byte/Unicode probes: [`docs/evidence/b-fts-probe.log`](../../docs/evidence/b-fts-probe.log),
  [`docs/evidence/b-context-byte-probe.log`](../../docs/evidence/b-context-byte-probe.log),
  [`docs/evidence/b-unicode-probe.log`](../../docs/evidence/b-unicode-probe.log).
- Do not add credentials, cookies, private URLs or user documents to fixtures.

## If the course requires physical test files here

Add thin test packages that call the colocated domain suites; do not move
upstream `_test.go` files just to satisfy a directory shape. The package path
`tangentry/test/offline` is inside the `tangentry` tree, so it may import
`tangentry/internal/...` under Go's internal rule. Keep the same fixture policy.