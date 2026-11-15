-- B-owned PDF page-text store (ADR-002 "Server-side PDF extraction"; plan
-- "PDF extraction design" item 4). Retrieval reads only this stored text;
-- browser-supplied page text is never authoritative. A changed document hash
-- replaces the content's rows (old passage references become stale_source).
CREATE TABLE IF NOT EXISTS pdf_page_text (
  content_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  document_sha256 TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  text TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  extractor TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  ocr_job_id TEXT NOT NULL DEFAULT '',
  ocr_state TEXT NOT NULL DEFAULT '',
  extracted_at INTEGER NOT NULL,
  PRIMARY KEY (content_id, page)
);
CREATE INDEX IF NOT EXISTS pdf_page_text_by_content ON pdf_page_text(content_id);
CREATE INDEX IF NOT EXISTS pdf_page_text_by_hash ON pdf_page_text(document_sha256);