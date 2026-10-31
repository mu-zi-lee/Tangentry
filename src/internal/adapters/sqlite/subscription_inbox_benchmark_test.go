package sqlite

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
)

func longArticleBenchmarkStore(b *testing.B) (*Store, subscriptions.Source) {
	b.Helper()
	store, err := Open(filepath.Join(b.TempDir(), "inbox.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { store.Close() })
	ctx := context.Background()
	sources := subscriptions.NewService(store, nil)
	b.Cleanup(sources.Close)
	source, _, err := sources.Create(ctx, subscriptions.Input{Type: "rss", Query: "https://example.com/benchmark"})
	if err != nil {
		b.Fatal(err)
	}
	items := make([]content.Item, 30)
	for index := range items {
		item := inboxTestItem(index+1, "article")
		item.Description = strings.Repeat("文🙂a", 10_000)
		item.ArticleBlocks = []content.ArticleBlock{
			{Kind: "paragraph", Text: strings.Repeat("Full article paragraph. ", 800)},
			{Kind: "paragraph", Text: strings.Repeat("Additional paragraph. ", 800)},
		}
		items[index] = item
	}
	if _, err := store.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: items, Total: len(items)}, 10); err != nil {
		b.Fatal(err)
	}
	return store, source
}

func BenchmarkSubscriptionLongArticleCards(b *testing.B) {
	store, source := longArticleBenchmarkStore(b)
	ctx := context.Background()
	for _, mode := range []string{"decode-then-project", "database-projection"} {
		b.Run(mode, func(b *testing.B) {
			get := store.GetSubscription
			if mode == "database-projection" {
				get = store.GetSubscriptionCards
			}
			b.ReportAllocs()
			for b.Loop() {
				detail, err := get(ctx, source.ID)
				if err != nil || len(detail.Items) != 30 {
					b.Fatal("incomplete source", err)
				}
				for index := range detail.Items {
					detail.Items[index] = content.Card(detail.Items[index])
				}
			}
		})
	}
}

func BenchmarkInboxLongArticlePage(b *testing.B) {
	store, _ := longArticleBenchmarkStore(b)
	ctx := context.Background()
	inbox := subscriptions.NewInboxService(store)
	for _, mode := range []string{"full", "cards"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				page, err := inbox.List(ctx, subscriptions.InboxQuery{Limit: 20, Cards: mode == "cards"})
				if err != nil || len(page.Entries) != 20 || page.NextCursor == "" {
					b.Fatal("incomplete page", err)
				}
				if page.Entries[0].Item.Partial != (mode == "cards") {
					b.Fatal("incorrect projection mode")
				}
			}
		})
	}
}
