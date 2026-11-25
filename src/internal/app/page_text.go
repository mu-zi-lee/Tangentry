package app

import (
	"context"
	"errors"

	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/retrieval"
)

// pageTextService exposes one stored PDF page's text so the retrieval workbench
// can show the text around a hit. It reads exactly what retrieval reads
// (pdf_page_text), so OCR-derived documents show the recognised text rather than
// the PDF text layer, which is unusable for them.
type pageTextService struct{ store *sqlite.Store }

func newPageTextService(store *sqlite.Store) *pageTextService {
	return &pageTextService{store: store}
}

var errPageNotFound = errors.New("page text not found")

// PageText returns one stored page. The caller validates the page number.
func (s *pageTextService) PageText(ctx context.Context, contentID string, page int) (retrieval.Page, int, error) {
	pages, err := s.store.ListPDFPages(ctx, contentID)
	if err != nil {
		return retrieval.Page{}, 0, err
	}
	for _, stored := range pages {
		if stored.Number == page {
			return stored, len(pages), nil
		}
	}
	return retrieval.Page{}, len(pages), errPageNotFound
}