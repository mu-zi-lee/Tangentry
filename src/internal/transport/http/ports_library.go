package httptransport

import (
	"context"

	"tangentry/internal/retrieval"

	"tangentry/internal/articles"
	"tangentry/internal/content"
)

type ContentService interface {
	Page(context.Context, content.Query) (content.Page, error)
	Get(context.Context, string) (content.Item, error)
	Save(context.Context, content.Item) (content.Item, error)
	Delete(context.Context, string) error
}

type ArticleService interface {
	Get(context.Context, string) (articles.Document, error)
	Fetch(context.Context, string, int64) (articles.Document, error)
}

// PageTextService reads one stored PDF page so a retrieval hit can show the
// text around it. It is the same text retrieval selects from, which means an
// OCR-derived document shows the recognised text, not the PDF text layer.
type PageTextService interface {
	PageText(ctx context.Context, contentID string, page int) (retrieval.Page, int, error)
}
