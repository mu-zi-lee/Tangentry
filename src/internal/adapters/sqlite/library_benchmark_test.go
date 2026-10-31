package sqlite

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/content"
)

func BenchmarkLibraryLongArticleCards(b *testing.B) {
	store, err := Open(filepath.Join(b.TempDir(), "library.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { store.Close() })
	ctx := context.Background()
	for index := range 30 {
		item := inboxTestItem(index+1, "article")
		item.Description = strings.Repeat("文🙂a", 10_000)
		item.ArticleBlocks = []content.ArticleBlock{
			{Kind: "paragraph", Text: strings.Repeat("Full article paragraph. ", 800)},
			{Kind: "paragraph", Text: strings.Repeat("Additional paragraph. ", 800)},
		}
		item.SavedAt = int64(index + 1)
		if _, err := store.Save(ctx, item); err != nil {
			b.Fatal(err)
		}
	}
	b.ReportAllocs()
	for b.Loop() {
		page, err := store.Page(ctx, content.Query{})
		if err != nil || len(page.Items) != 30 || page.Total != 30 {
			b.Fatal("incomplete library", err)
		}
		if !page.Items[0].Partial || len(page.Items[0].ArticleBlocks) != 0 {
			b.Fatal("unprojected library card")
		}
	}
}
