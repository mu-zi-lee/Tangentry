package sqlite

import (
	"context"

	"tangentry/internal/retrieval"
)

// ListPDFPages reads the stored server-side page text for one content item,
// ordered by page. Implements the retrieval.PDFText read port.
func (s *Store) ListPDFPages(ctx context.Context, contentID string) ([]retrieval.Page, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT page, text, document_sha256, extractor, extractor_version FROM pdf_page_text WHERE content_id=? ORDER BY page`, contentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	pages := make([]retrieval.Page, 0)
	for rows.Next() {
		var p retrieval.Page
		if err := rows.Scan(&p.Number, &p.Text, &p.DocumentSHA256, &p.Extractor, &p.ExtractorVersion); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// SavePDFPages stores extracted page text, replacing any older rows for the
// content item: a new document hash invalidates old rows and old passage
// references (C sees stale_source). Implements retrieval.PDFTextStore.
func (s *Store) SavePDFPages(ctx context.Context, contentID string, doc retrieval.PDFDocument, extractedAt int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM pdf_page_text WHERE content_id=?`, contentID); err != nil {
		return err
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO pdf_page_text(content_id,page,document_sha256,page_count,text,text_sha256,extractor,extractor_version,ocr_job_id,ocr_state,extracted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, p := range doc.Pages {
		if _, err := stmt.ExecContext(ctx, contentID, p.Number, doc.SHA256, doc.PageCount, p.Text, retrieval.TextSHA256(p.Text), p.Extractor, p.ExtractorVersion, doc.OCRJobID, doc.OCRState, extractedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Pages implements the retrieval.PDFText read port.
func (s *Store) Pages(ctx context.Context, contentID string) ([]retrieval.Page, error) {
	return s.ListPDFPages(ctx, contentID)
}

// Compile-time port conformance.
var (
	_ retrieval.PDFText      = (*Store)(nil)
	_ retrieval.PDFTextStore = (*Store)(nil)
)
