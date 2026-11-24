# Bundled sample documents — attribution

These files are **not** covered by the project's MIT license. They are official
publications of the Government of the Hong Kong Special Administrative Region,
included so that a fresh installation has something to read and to exercise
question-relevant retrieval offline. They are redistributed unmodified.

| File | Document | Publisher |
| --- | --- | --- |
| `hk-first-five-year-plan.pdf` | 香港特別行政區經濟和社會發展 第一個五年規劃（2026–2030）公眾諮詢文件 | 香港特別行政區政府 |
| `hk-basic-law.pdf` | 中華人民共和國憲法及香港特別行政區基本法（2021 年 5 月版本） | 香港特別行政區政府政制及內地事務局 |
| `hk-policy-address-2025.pdf` | 行政長官 2025 年施政報告 | 香港特別行政區政府 |

Copyright remains with the Government of the Hong Kong Special Administrative
Region. Anyone redistributing a build that includes these files is responsible
for confirming that their use is permitted; to ship without them, drop these
files and the `samples` catalog entries and rebuild.

## Page text provenance

Retrieval reads stored per-page text, not the rendered PDF. The `*.pages.json`
files record which extractor produced each one, because the answer differs per
document:

- `hk-first-five-year-plan` — the PDF carries a usable text layer, so the page
  text comes from the app's own native extractor (`ledongthuc/pdf`). Recorded as
  `extractor: native`.
- `hk-basic-law`, `hk-policy-address-2025` — these PDFs embed Identity-H subset
  fonts **without a ToUnicode CMap**, so the text layer decodes to glyph IDs
  rather than characters. No extractor can recover it (both `ledongthuc/pdf` and
  `pypdf` yield mojibake: under 2% CJK characters). Their page text was produced
  with a local PaddleOCR runtime and is recorded as `extractor: local-paddleocr`
  with the exact version. OCR text can contain recognition errors; the PDF
  remains the authority.

To reproduce or refresh that text:

```bash
python src/tools/ocr/paddleocr_pages.py \
  --input hk-basic-law.pdf --output hk-basic-law.pages.json
```

The script uploads nothing; it renders pages locally and writes
`{"documentSha256", "extractor", "extractorVersion", "pages"}`. Seeding rejects a
page-text file whose `documentSha256` does not match the bundled PDF, so a stale
file cannot silently ship.