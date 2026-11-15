# B · Local PaddleOCR runtime verification (AC-FR-02-16 real-runtime gap)

- **Date:** 2026-11-15
- **Owner:** WANG Jiaqi (B)
- **Status:** real local OCR path VERIFIED end-to-end; OCR-subset gold labels
  remain **provisional** (re-annotation against actual OCR text required before
  any recall claim). Primary NFR-02 results are unaffected (OCR subset was
  never in the primary denominator).

## 1. What was installed (user-local, no root, no token, no upload)

| item | value |
| --- | --- |
| runtime | `~/ocr-runtime/ocr-runtime` (wrapper) → `ocr_runtime.py` |
| Python | uv venv, CPython 3.13.18 |
| packages | paddlepaddle 3.3.1 (CPU), paddleocr 3.x, pypdfium2, pillow, img2pdf |
| models | **PP-OCRv5_mobile_det + PP-OCRv5_mobile_rec** (auto-downloaded to `~/ocr-runtime/models`, PaddleX cache) |
| adapter contract | `<runtime> --model <dir> --input <pdf>` → stdout `{"pages":[{"page":N,"text":...}]}` (pdftext.LocalOCR) |
| ModelID recorded | `PP-OCRv5_mobile` (deviation from the recommended `PaddleOCR-VL-1.6` default: VLM is heavy on CPU; the adapter contract is model-agnostic; identity recorded here and in results) |

Environment workarounds (recorded, reproducible — see `~/ocr-runtime/README.md`):
1. `libgomp.so.1` missing on the host, no root: `apt-get download libgomp1` +
   `dpkg-deb -x` into `~/ocr-runtime/libroot`, loaded via `LD_LIBRARY_PATH`.
2. Paddle 3.3.1 oneDNN/PIR CPU bug (`ConvertPirAttribute2RuntimeAttribute …
   onednn_instruction.cc`): disabled oneDNN (`enable_mkldnn=False`,
   `FLAGS_use_mkldnn=false`).

Install log: `b-ocr-install.log`.

## 2. End-to-end method (all REAL components, no fakes)

1. Rendered the OCR-subset **expected** page text (30 pages,
   `fixtures/pdf-ocr-subset.json`) into an **image-only PDF with no text
   layer** (`render_scanned_pdf.py`, Noto Sans CJK, deterministic layout) →
   `~/ocr-runtime/scanned-ocr-subset.pdf` (sha256 `5b29600473a8037f…`, full
   hash in `runs/ocr-subset-results.json`).
2. `go run ./ocrtest` exercised the production path:
   `pdftext.NativeExtractor` (real pure-Go text-layer extractor) → empty pages
   → `retrieval.PDFExtractionService` OCR fallback → `pdftext.LocalOCR` with
   `ExecRunner` (real subprocess) → page-text store.
3. Compared OCR output with expected text; froze the ACTUAL OCR snapshot
   (`fixtures/ocr-actual-snapshot.json`, extractor provenance
   `local-paddleocr / PP-OCRv5_mobile`).
4. Ran the real selector (lexical mode) on the OCR'd snapshot for BQ-025/026.
   Hybrid on OCR text would require new authorized embeddings (OCR text ≠
   expected text, so the frozen vector pool does not cover it); not run.

Live extraction log: `b-ocr-e2e.log` (extraction lines authoritative; its
question-level lines were produced by a buggy first version of ocrtest and
are SUPERSEDED by the corrected results in `runs/ocr-subset-results.json` —
see §4).

## 3. Results

| item | result |
| --- | --- |
| extraction status | **ready**, 30/30 pages, `ocrUsed=true` |
| elapsed | 9m49s (CPU, 30 pages, first run incl. model init) |
| exact normalized page match vs expected | 0/30 |
| char-bigram similarity | min 0.958, avg 0.960 |
| whitespace-only-diff pages | 4/30; other pages differ by wrap-spacing + one line-order swap (page 15) |
| BQ-025 answer content recognized (whitespace-stripped) | **true** |
| BQ-026 answer content recognized (whitespace-stripped) | **true** |
| BQ-025/026 answer exact-normalized containment | **false** |
| BQ-025/026 lexical selection contains answer (exact / stripped) | false / **true** |
| exact gold-segment hit (provisional labels vs actual OCR) | **false** |

**Interpretation.** The local OCR path works and recognizes the answer
content completely. The exact-match failures are dominated by an artifact of
the test rendering: the renderer wraps lines mid-sentence, and PaddleOCR
emits a space at each visual line break (e.g. `设备巡检周期为14天，␣特殊天气后需加巡。`),
which normalized containment preserves. Page 15 additionally has one
line-order swap. These are honest OCR-vs-expected differences, not retrieval
defects.

## 4. Test-harness bug found and corrected (disclosure)

The first ocrtest version extracted "the first sentence of the gold passage"
as the answer sentence. For PDF gold segments the first sentence is the **page
header**, so the initial `answerInOCR=true / lexicalHit=true` lines measured
the header, not the answer. Corrected to use the second sentence (the actual
answer); added whitespace-stripped diagnostics alongside the protocol's
exact-normalized criterion. Corrected results:
`runs/ocr-subset-results.json` (`extraction_mode: reused-frozen-snapshot`,
identical OCR content — per-page char counts verified equal to the live run).

## 5. Consequences for the evaluation set

- **AC-FR-02-16 real-runtime gap: CLOSED.** Scanned PDF → native empty →
  local OCR (no token/upload) → stored pages → retrieval, all through
  production components. Cloud OCR remains feature-flagged off by design.
- **BQ-025/026 stay provisional and OUT of the primary denominator.** The
  protocol gate ("verify recognized text matches expected after
  normalization") is NOT met exactly, so the expected-text labels cannot be
  confirmed as-is. No recall claim is made for the OCR subset.
- **Path to full closure (requires human confirmation):** re-annotate the two
  gold labels against the frozen ACTUAL OCR snapshot
  (`fixtures/ocr-actual-snapshot.json`) using the real splitter, confirm and
  freeze them, then re-run retrieval for exact-match hits. This is legitimate:
  the labels were provisional and never used in any claim; the primary set's
  freeze is untouched.
- Primary NFR-02 evidence (23/24 = 0.9583) is unaffected: the OCR subset was
  always excluded, and no primary fixture/label/vector changed.

## 6. Reproduce

```bash
# runtime setup: ~/ocr-runtime/README.md
cd test/offline/eval-b
go run ./ocrtest -pdf ~/ocr-runtime/scanned-ocr-subset.pdf   # live OCR (~10 min CPU)
go run ./ocrtest -reuse-snapshot                             # retrieval checks on frozen OCR snapshot
```