# B implementation · Phase 3 report — PDF extraction

- **Date:** 2026-11-14
- **Branch:** `owner/b-implementation`
- **Phase status:** complete (awaiting human confirmation before Phase 4)
- **Session:** B-AI-011 (continuous session `ses_e27efbad7ffeY2pIG6EzRIOgOQ`)
- **Precondition:** Phase 2 confirmed (no blocking leftovers).

## 1. What was built (VERIFIED)

| Change | Detail |
| --- | --- |
| Domain ports + service (`retrieval/pdf.go`) | `PDFTextExtractor` (Version/DocumentHash/Extract), `OCRProvider` (Name/Version/Available/Recognize), `PDFTextStore` (SavePDFPages); `PDFExtractionService`: hash → idempotency reuse → native extract → OCR for text-less pages → page-count validation → store. Statuses ready/pdf_extracting/pdf_ocr_unavailable/pdf_no_text/pdf_extract_failed; ≤1 active extraction per content+hash; defensive page copy; no fabricated text. |
| `ErrStaleSource` + verifier mapping | A replaced PDF document hash surfaces as `stale_source` (not generic unverified); `LocatorDocumentHash` + exported `PDFPageVersion` helpers. |
| Migration **082** `pdf_page_text` | `(content_id,page)` PK + document_sha256, page_count, text, text_sha256, extractor, extractor_version, ocr_job_id, ocr_state, extracted_at; indexes on content_id and document_sha256. New hash replaces old rows. |
| Native extractor (`adapters/pdftext/native.go`) | Vetted pure-Go `github.com/ledongthuc/pdf` **BSD-3-Clause**, zero dependencies, pinned `v0.0.0-20261020125853-5e46805f718e`; license recorded in `docs/licenses/ledongthuc-pdf-BSD-3-Clause.txt`. Per-page text, streamed SHA-256, encrypted/corrupt → error, ctx honored. |
| Local PaddleOCR (`local_ocr.go`) | User-installed runtime/model paths; recommended `PaddleOCR-VL-1.6`; no token, no upload; missing runtime/model → unavailable; `CommandRunner` abstraction (fake in tests); bounded timeout; page-count/order validation. |
| Cloud PaddleOCR (`cloud_ocr.go`) | **Feature-flagged OFF** + consent (`CloudConsentVersion`/`ConsentAt`) required before any upload; submit → bounded poll (pending/running/done/failed) → download `resultUrl.jsonUrl` → parse `result.layoutParsingResults[].markdown.text`; page-count validation; token in Authorization header only; error bodies redacted (fixed messages). |
| `RetrievalSource` PDF wiring | Loads stored pages for PDF kind; `ReadRange` returns `ErrStaleSource` when the locator's document hash was replaced. |

## 2. Test-first evidence (VERIFIED)

- **Red retained:** `b-impl-phase3-red.log` (adapter tests before implementation).
- **20 tests** in the determinism set, covering:

| B-Txx | Tests |
| --- | --- |
| B-T04 | `TestBT04_TextLayerStored`, `TestBT04_OCRFallback` (OCR text / unavailable / no_text), `TestBT04_NativeTextLayer` (60-page fixture, answer page 50), `TestBT04_PDFEndToEnd` (extract → store → select page-50 passage → INV-05 verify) |
| B-T27 | `TestBT27_PDFVariants` (corrupt/encrypted/mismatch/OCR failure), `TestBT27_NativeFailures` (corrupt/encrypted/missing/cancelled), `TestNativeEmptyPage` |
| B-T28 (PDF part) | `TestBT28_HashChangeInvalidates` (domain), `TestBT28_PDFHashChange` (adapter: old citation stale_source, new verifies) |
| B-T34 | `TestBT34_LocalOCR` (fake runtime), `TestBT34_CloudJobFlow` (httptest submit/poll/done/JSONL), `TestBT34_CloudFailures` (failed/timeout/mismatch/malformed), `TestBT34_TokenRedaction` |
| B-T37 (OCR part) | `TestBT37_LocalFirstOCR` (default local; cloud needs flag+consent), `TestBT37_CloudGuards` (zero requests without flag/consent/token) |
| extras | `TestPDFExtractionConcurrency` (pdf_extracting), `TestPDFPageTextSchema` (082 schema + provenance round-trip + replace) |

- Two fixture-aliasing bugs and one missing fake result were fixed in the
  tests during red→green (documented; no assertion weakened); the service
  gained a defensive page copy so OCR merge never mutates extractor buffers.

## 3. Gate results (VERIFIED, raw logs + exit codes)

| Command | Exit | Summary | Evidence |
| --- | --- | --- | --- |
| focused (retrieval/ai/transport/pdftext/sqlite) `-count=1` | 0 | 5 ok | `b-impl-phase3-focused.log` |
| `go test ./... -count=1` | 0 | 45 ok / 11 no-test | `b-impl-phase3-go-full.log` |
| `go test ./internal/layering -count=1` | 0 | ok | `b-impl-phase3-layering.log` |
| `npm test -- --run` | 0 | 62 files / 251 tests | `b-impl-phase3-web.log` |
| `npm run build` | 0 | built | `b-impl-phase3-web.log` |
| `go vet` / gofmt | 0 | clean | `b-impl-phase3-layering.log` |
| two-run determinism diff | 0 | identical (20 PASS/run) | `b-impl-phase3-determinism.log` |
| `git diff main` A budget | 0 | empty | `b-impl-phase3-layering.log` |
| published migrations | — | unchanged; 082/084 added | `b-impl-phase3-layering.log` |
| secret scan | — | clean (only synthetic redaction fixture) | session output |

## 4. Design decisions recorded (INFERRED within spec latitude)

1. **Extractor naming:** `native`, `local-paddleocr`, `paddleocr-cloud`
   (covers the plan's `native`/`paddleocr` family and the notes'
   `local-paddleocr`).
2. **Local OCR contract:** runtime invoked as `<runtime> --model <modelPath>
   --input <pdfPath>`, stdout JSON `{"pages":[{"page":N,"text":...}]}`; the
   real PaddleOCR CLI varies, so the contract is documented and the adapter
   is tested with a fake runner (no real runtime bundled/downloaded).
3. **Cloud API contract:** submit multipart → `{"jobId"}`; poll
   `{"state","resultUrl":{"jsonUrl"}}`; JSONL one page per line. Matches
   b-paddleocr-notes; exact aistudio field names may need adjustment at live
   integration (separate authorized run, Phase 7+).
4. **OCR page mapping:** OCR receives the count of text-less pages and returns
   them in order; the service maps them back to the missing page indices.
5. **`pdf_no_text` rows are stored** (provenance of the attempt); idempotent
   re-reads re-derive `pdf_no_text` from stored empty text.
6. **Native fixture is ASCII** (font-independent, deterministic); CJK PDFs are
   covered via the OCR path with fakes. Real CJK text-layer extraction depends
   on embedded fonts/ToUnicode and is a live-integration concern.

## 5. Structured report

```json
{
  "phase": "3-pdf-extraction",
  "status": "complete",
  "branch": "owner/b-implementation",
  "commits": ["<phase-3 commit> feat(retrieval): add PDF extraction with native text layer and PaddleOCR adapters (migration 082)"],
  "files_changed": [
    "src/internal/retrieval/pdf.go (+test), errors.go, verify.go, identity.go, version.go",
    "src/internal/adapters/pdftext/{native,local_ocr,cloud_ocr}.go (+3 tests)",
    "src/internal/adapters/sqlite/migrations/082_pdf_page_text.sql, pdf_page_text.go (+test), retrieval_source.go",
    "src/go.mod, src/go.sum, docs/licenses/ledongthuc-pdf-BSD-3-Clause.txt"
  ],
  "tests_added": ["B-T04","B-T27","B-T28 (PDF part)","B-T34","B-T37 (OCR part)","concurrency","schema"],
  "test_results": [
    {"command": "cd src && go test ./internal/retrieval/... ./internal/ai/... ./internal/transport/http/... ./internal/adapters/pdftext/ ./internal/adapters/sqlite/ -count=1", "exit_code": 0, "summary": "5 ok", "evidence": "docs/evidence/b-impl-phase3-focused.log"},
    {"command": "cd src && go test ./... -count=1", "exit_code": 0, "summary": "45 ok / 11 no-test", "evidence": "docs/evidence/b-impl-phase3-go-full.log"},
    {"command": "cd src && go test ./internal/layering -count=1", "exit_code": 0, "summary": "ok", "evidence": "docs/evidence/b-impl-phase3-layering.log"},
    {"command": "cd src/web && npm test -- --run", "exit_code": 0, "summary": "62 files / 251 tests", "evidence": "docs/evidence/b-impl-phase3-web.log"},
    {"command": "cd src/web && npm run build", "exit_code": 0, "summary": "built", "evidence": "docs/evidence/b-impl-phase3-web.log"}
  ],
  "invariants_verified": [
    "INV-05: PDF passages re-read from the store; replaced hash → stale_source (B-T28)",
    "no fabricated text: empty/OCR-failure/mismatch paths never invent pages (B-T04/B-T27/B-T34)",
    "idempotent per document hash; ≤1 active extraction per content+hash",
    "local-first: cloud requires explicit flag + consent; zero requests otherwise (B-T37)"
  ],
  "constraints_checked": [
    "layering green; domain ports stdlib-only; adapters implement ports (allowed direction)",
    "A ledger untouched (git diff main empty)",
    "no published migration edited; 082 additive/idempotent; 083 still free for Phase 4",
    "no real OCR runtime/cloud/token; fake runtime + httptest job API; token redaction proven",
    "vetted library license recorded (BSD-3-Clause); offline determinism (two-run identical)",
    "-count=1; gofmt + vet clean; no push/force-push"
  ],
  "ai_use_log_entry": "B-AI-011",
  "deviations_from_spec": [
    "Local OCR runtime CLI contract and cloud job field names are documented assumptions tested with fakes; live integration is a separate authorized run",
    "Native fixture ASCII-only (font-independent); CJK text-layer extraction deferred to live integration"
  ],
  "open_questions": [
    "Phase-7 evaluation set still in progress (re-ask at Phase 6/7)",
    "Cloud OCR legal/terms review (B-D05) keeps the feature flag off; live cloud run needs separate authorization",
    "C/E must not duplicate the pdf_page_text or content-version column sets"
  ],
  "next_phase": "4-embedding-rerank",
  "claim_tags": "all factual claims VERIFIED via cited evidence logs/commands; section 4 items are INFERRED design decisions within spec latitude"
}
```

## 6. Stop condition

Phase 3 ends here. Waiting for human confirmation before Phase 4
(embedding/rerank adapters + B budget: local/custom/Bailian `/embeddings`
clients, role-correct text_type, dimension validation, vector cache
(process-local default + optional persistent migration 083 per the "both"
decision), optional rerank, B-only budget, settings validation/test-connection;
tests B-T24, B-T26, B-T30, B-T31, B-T32, B-T33 full mode matrix, B-T35, B-T36,
B-T37 embedding part).