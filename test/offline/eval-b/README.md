# eval-b · Phase-7 evaluation set for NFR-02 (hybrid retrieval) — CONFIRMED

- **Status:** `confirmed` (frozen for Phase 7). Human sign-off received
  2026-11-14 in the OpenCode session ("我是人类，我签署。请你进入phase07"),
  recorded as WANG Jiaqi (B) in `questions.yaml` (`confirmed_by`/`confirmed_at`).
  Labels were AI-drafted (B-AI-014) at the user's request; provenance is
  retained in the YAML header and the AI-use log. **Any edit or regeneration
  invalidates the confirmation** and requires a new human sign-off.
- **Content policy:** all documents are fictional, manually constructed
  templates (no real user data, credentials, cookies or private URLs); BMP
  characters only, so UTF-16 and code-point counts agree (protocol §4).
- **This is not an evaluation report.** The Phase-7 run writes
  `docs/evidence/b-eval-report.md` separately.

## Confirmation record

1. ✅ Every question/gold label confirmed by the human owner (26 records,
   `annotator: WANG Jiaqi`, `annotated_at: 2026-11-14`).
2. ✅ Set frozen before running the new paths (freeze hashes below).
3. ⏳ OCR subset (BQ-025/BQ-026): local PaddleOCR runtime is **not installed**
   in the evaluation environment; the subset stays **out** of the primary
   denominator (`primary_denominator: false`) and is reported as
   `pdf_ocr_unavailable` until a verified OCR run exists.
4. ⏳ Embedding source approval for the frozen run: see `eval-configs.yaml`
   and the Phase-7 report (provider authorization recorded separately).

Freeze hashes (sha256, computed at confirmation):

## Files

| File | Purpose |
| --- | --- |
| `questions.yaml` | Gold labels, protocol §3 format (+ subset/position/range tags). 24 primary + 2 provisional OCR. |
| `dataset-manifest.json` | Per-document hashes, rune counts, candidate counts, sweep sample indices/stride/coverage; per-question position, lexical score, baseline predictions, reachability flags. |
| `fixtures/*.json` | Normalized `retrieval.Snapshot` documents (article blocks / subtitle track / PDF page-text snapshots) — the exact input shape the selector loads. |
| `fixtures/*.txt` | Canonical concatenated document text (units joined with `\n`) for baseline replay; hash recorded in the manifest. |
| `fixtures/subtitle-lecture.srt` | Human-readable export of the subtitle track. |
| `fixtures/pdf-no-text.json`, `article-malicious.json`, `article-empty.json` | Negative-set fixtures. |
| `negative-cases.yaml` | Negative set (no_match, malicious, empty, invalid budget, forged locator, PDF no-text, extraction/embedding failure, model mismatch). Never in the recall denominator. |
| `eval-configs.yaml` | Proposed Phase-7 run matrix: 120k/8k recall runs + budget-starved/char-bound/high-budget runs, each in `shared` and `split` batching modes. |
| `gen/` | Deterministic Go generator (module `tangentry/eval-b-gen` rooted here, replaces `tangentry` → `../../../src`). Uses the **real** `internal/retrieval` splitter/grouping. |
| `evalutil/` | Shared harness helpers (snapshot loading, baseline replay, mem source, frozen vector store/embedder). |
| `replay/` | Phase-7 replay harness: baseline/lexical/hybrid × 120k/8k, budget-invariant runs, negative set, B-T12 double-run; tests B-T12/B-T13/B-T18 + negatives + budget invariants (`go test ./replay -count=1`). |
| `vectorgen/` | The ONE live embedding pass (protocol §9 gate: refuses to run without `-authorize`). Real `aichat.EmbeddingClient` adapter; per-request role/text_type/usage ledger; key never written to disk. |
| `report/` | Generates `docs/evidence/b-eval-report.md` (protocol §6) + `b-eval-per-question.json` from the frozen results. |
| `vectors/` | `frozen-vectors.json` (payload hash recorded) + `generation-log.json` (redacted live-pass ledger). |
| `runs/` | Replay outputs: per-question results, aggregates, determinism proof, budget invariants, negative results. |
| `verify_eval_set.py` | Independent Python cross-validation (second implementation; 696 checks). |

## Documents

| doc_id | kind | runes | units | candidates N | sweep stride / coverage (S=90) |
| --- | --- | ---: | ---: | ---: | --- |
| `fixture:article-main` | article | 146,754 | 574 blocks | 1,614 | 18 / 0.0558 |
| `fixture:article-distractor-on` | article | 164,766 | 912 blocks | 1,712 | 20 / 0.0526 |
| `fixture:article-distractor-off` | article | 163,330 | 912 blocks | 1,712 | 20 / 0.0526 |
| `fixture:article-charbound` | article | 150,888 | 207 blocks | 207 | 3 / 0.4348 |
| `fixture:subtitle-lecture` | subtitle | 147,855 | 3,400 cues | 850 | 10 / 0.1059 |
| `fixture:pdf-report` | pdf | 141,493 | 190 pages | 1,334 | 15 / 0.0675 |
| `fixture:pdf-ocr-subset` | pdf (provisional OCR) | 22,371 | 30 pages | 212 | 3 / 0.4245 |

All primary documents exceed the 120,000-rune default budget (and the 8,000
stress budget). Every document has N > 90, so the deterministic semantic sweep
is clamped (`semantic_sweep_limited`); the sampled index sets are recorded in
the manifest. PDF comparison uses the **same server-side page-text snapshot**
for all three paths; `DocumentSHA256` is the SHA-256 of the concatenated page
text (snapshot identity — no binary PDF exists in this offline set).

## Questions (24 primary + 2 provisional)

| ID | doc | subset | position | what it tests |
| --- | --- | --- | --- | --- |
| BQ-001/002/003/008/023 | article-main | primary | middle | middle-third facts the baseline must miss |
| BQ-004 | article-main | primary | head | head control (baseline hits at 120k and 8k) |
| BQ-005 | article-main | primary | tail | tail control |
| BQ-006 | article-main | primary | middle | heading trap: terms in a head heading, answer in the middle |
| BQ-007 | article-main | primary | middle | repeated gold sentence (both copies in the blind window); dedupe |
| BQ-018 | article-main | paraphrase | middle | **same-language zero-overlap** (AC-FR-02-19/B-T39); gold ON a sampled index |
| BQ-019 | article-main | paraphrase | middle | **cross-language** pair: Chinese question, English gold; ON a sampled index |
| BQ-020 | distractor-on | distractor | middle | 110 query-term passages fill the shortlist; zero-overlap gold ON a sampled index (AC-FR-02-20/B-T40) |
| BQ-021 | distractor-off | distractor | middle | same, gold OFF every sampled index → expected coverage-limited hybrid miss |
| BQ-022 | charbound | primary | middle | character-bound fixture (~750-rune single-sentence segments) |
| BQ-009/010/024 | subtitle-lecture | primary | middle | middle cue groups |
| BQ-011 / BQ-012 | subtitle-lecture | primary | head / tail | cue-group controls |
| BQ-013 | subtitle-lecture | primary | middle | repeated answer cue; dedupe |
| BQ-014/015 | pdf-report | primary | middle | page-local gold segments (incl. decimal-number sentence splitting) |
| BQ-016 / BQ-017 | pdf-report | primary | head / tail | page controls |
| BQ-025/026 | pdf-ocr-subset | ocr-provisional | middle | local PaddleOCR subset; **excluded from the primary denominator until OCR verification + human confirmation** |

Position mix: 18 middle / 3 head / 3 tail (primary). Baseline head/tail replay
(no summary material, rune counting) is predicted to hit exactly the 6
controls at both budgets (6/24 = 0.25); all middle golds sit inside the 120k
blind window. Predictions are recorded per question in the manifest and
independently re-checked by `verify_eval_set.py`.

## How the gold labels were produced (granularity guarantee)

Protocol §3 requires the **same splitter and segment grouping** as retrieval.
The generator does not re-implement segmentation: it calls
`retrieval.SplitSentences` / `GroupSegments` / `GroupCueSegments` with the
default parameters (1–3 sentences, 200–800 runes; 3–8 cues, 15–60 s), mirrors
the selector's heading/code/page rules, and then validates **every** gold
through the real pipeline:

1. `retrieval.NewSelector(...).Select` in lexical mode with the gold text as
   the question (exact-phrase saturation) — asserts the returned top passage
   has exactly the gold text, locator and SHA-256 (canonical segment proof).
2. Real-question lexical run → `lexical_reachable` flag.
3. Real-question hybrid run with a **fake marker embedder** →
   `sweep_union_reachable_fake_vectors` flag (fixture property only).
4. Candidate-count cross-check: a zero-lexical question through the real
   selector; `Sweep.Stride`/`Coverage` must match the reproduced N.

**Fake-vector disclaimer:** the fake embedder (cosine 1 for gold-marked texts)
is used only to validate fixture properties during generation. It is never
used for the NFR-02 claim; the Phase-7 run must use a pinned local model or
frozen vectors (protocol §5).

## Known design notes

- **BQ-021 is an expected hybrid miss** (gold off every sampled index). It
  stays in the denominator; the protocol explicitly requires measuring the
  coverage-limited outcome. Primary hybrid ceiling is therefore 23/24 ≈ 0.958
  with a perfect embedder — still above the 0.80 threshold.
- **Single-term proximity artifact:** the lexical scorer gives proximity 1 to
  single-term matches, so a repetitive filler can outrank a multi-term gold.
  BQ-016 (head control) exhibits this: lexical-only misses it, but its gold is
  candidate index 0 (always sampled) so hybrid reaches it via the sweep. Kept
  as a diagnostic; BQ-010's wording was chosen to avoid the same collision.
- **Zero-overlap verification:** for BQ-018/019/020/021 the generator asserts
  `ScoreLexical(question, gold) == 0`, and the Python validator re-checks it
  with an independent bigram/token implementation.
- **Distractor saturation:** each distractor document contains 110 passages
  with the query terms (≥ the protocol's 20, and enough to fill the top-100
  lexical shortlist); filler and gold share no query term with the question.
- **OCR subset is provisional:** the fixture stores the *expected* page text.
  Scanned-page rendering + a real local PaddleOCR run + text verification are
  pending human-owned steps; the subset is reported independently and never
  pooled with native text-layer pages.

## Regenerate and verify

```bash
# requires the Go toolchain used by the repo (go1.27.1); fully offline
cd test/offline/eval-b
go run ./gen -out .         # deterministic: two runs are byte-identical
                            # NOTE: regenerating invalidates the human
                            # confirmation; re-confirmation is required.

cd ../../..
python3 test/offline/eval-b/verify_eval_set.py   # independent cross-check
```

## Phase-7 execution (after confirmation)

```bash
cd test/offline/eval-b
go run ./replay -eval . -out runs        # offline; hybrid blocked until vectors exist
go run ./vectorgen -eval . -authorize "<human statement>" -spend-cap-cny 10   # ONE live pass
go run ./replay -eval . -out runs        # full replay with frozen vectors
go test ./replay -count=1 -v             # B-T12 / B-T13 / B-T18 + negatives + budget invariants
go run ./report -eval . -repo ../../.. -commit <sha>   # docs/evidence/b-eval-report.md
```

The generator exits non-zero if any invariant fails (gold not canonical,
zero-overlap violated, placement outside the blind window, baseline
prediction wrong, sweep metadata mismatch, document too short, …).

## Protocol compliance map (§2 requirements)

| Requirement | Where |
| --- | --- |
| ≥20 answerable question/document pairs | 24 primary (`primary_denominator: true`) |
| documents exceed 120k (and 8k) budget | all 6 primary docs ≥ 141k runes |
| most golds middle third + head/tail controls | 18 middle / 3 head / 3 tail |
| article + saved subtitle + PDF page text | article-main, subtitle-lecture, pdf-report |
| local PaddleOCR subset labeled/reported independently | pdf-ocr-subset (provisional gate above) |
| repeated sentences/cues | BQ-007 (sentence ×2), BQ-013 (cue ×2) |
| heading-term trap | BQ-006 |
| ≥2 zero-overlap paraphrase pairs (same-lang + cross-lang) | BQ-018, BQ-019 (reported separately) |
| ≥2 distractor-saturated docs, on/off sampled index | BQ-020 (on), BQ-021 (off), 110 distractors each |
| sweep clamped by candidate budget | all docs N > 90; indices/stride/coverage in manifest |
| character-bound fixture | article-charbound + `eval-configs.yaml` char-bound runs |
| no real user data; BMP only | fictional templates; asserted by both validators |
| negative set separate | `negative-cases.yaml` + 3 negative fixtures |