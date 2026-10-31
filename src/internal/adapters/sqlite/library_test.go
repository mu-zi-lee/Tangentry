package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"tangentry/internal/ai"
	"tangentry/internal/articles"
	"tangentry/internal/content"
	"tangentry/internal/history"
)

func TestLibraryDatabaseCardProjectionPreservesFullReadsAndSearch(t *testing.T) {
	ctx := context.Background()
	store := inboxTestStore(t)
	items := make([]content.Item, 10)
	for index := range items {
		item := inboxTestItem(index+300, "article")
		item.SavedAt = int64(index + 1)
		switch index {
		case 0:
			item.Description = strings.Repeat("文🙂a", content.CardDescriptionRunes)
			item.ArticleBlocks = []content.ArticleBlock{{Kind: "paragraph", Text: "needleinbody remains searchable"}}
		case 1:
			item.Description = strings.Repeat("🙂", content.CardDescriptionRunes)
		case 2:
			item.Description = "前缀\x00" + strings.Repeat("🙂", content.CardDescriptionRunes)
		case 3:
			item.Description = "\x00短描述"
		case 4:
			item.Transcripts = []content.Transcript{{URL: "https://example.com/subtitles.vtt", Type: "text/vtt"}}
		case 5:
			item.Discussion = &content.Discussion{TopicID: "topic"}
		case 6:
			item.Partial = true
		case 7:
			item.Images = []content.Image{{URL: "https://example.com/cover.png", Width: 640, Height: 360}}
			item.Paper = &content.PaperMetadata{ArxivID: "2401.00001", Abstract: "论文摘要"}
		case 8:
			item.Description = "Comments"
		case 9:
			item.Kind = "audio"
		}
		if _, err := store.Save(ctx, item); err != nil {
			t.Fatal(err)
		}
		items[index] = item
	}
	doc := articles.Document{ContentID: items[8].ID, SourceURL: items[8].URL, Title: items[8].Title, Revision: 1, Blocks: []articles.Block{{Kind: "paragraph", Text: strings.Repeat("缓存的原站正文。", 10)}}}
	if _, err := store.SaveArticle(ctx, doc, 0); err != nil {
		t.Fatal(err)
	}
	full := make(map[string]content.Item, len(items))
	for _, item := range items {
		stored, err := store.Get(ctx, item.ID)
		if err != nil {
			t.Fatal(err)
		}
		full[item.ID] = stored
	}
	for offset := 0; offset < len(items); offset += 3 {
		page, err := store.Page(ctx, content.Query{Limit: 3, Offset: offset})
		if err != nil || page.Total != len(items) || len(page.Items) != min(3, len(items)-offset) || page.Counts["article"] != 9 || page.Counts["audio"] != 1 {
			t.Fatal("projection changed page metadata", page, err)
		}
		wantNext := 0
		if offset+len(page.Items) < len(items) {
			wantNext = offset + len(page.Items)
		}
		if page.Next != wantNext {
			t.Fatal("projection changed continuation", page.Next, wantNext)
		}
		for index, item := range page.Items {
			if item.ID != items[len(items)-1-offset-index].ID {
				t.Fatal("projection changed saved order", item.ID)
			}
			want, _ := json.Marshal(content.Card(full[item.ID]))
			got, _ := json.Marshal(item)
			if string(want) != string(got) {
				t.Fatalf("card mismatch for %s\nwant %s\ngot %s", item.ID, want, got)
			}
			stored, err := store.Get(ctx, item.ID)
			if err != nil || !reflect.DeepEqual(stored, full[item.ID]) {
				t.Fatal("card read mutated stored full item", item.ID, err)
			}
		}
	}
	page, err := store.Page(ctx, content.Query{Q: "needleinbody"})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != items[0].ID || len(page.Items[0].ArticleBlocks) != 0 {
		t.Fatal("projected body is no longer searchable", page, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := store.Page(cancelled, content.Query{}); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled library read proceeded", err)
	}
}

func TestLibraryPageFiltersSearchesAndOmitsBodies(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "library.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	items := []content.Item{
		{ID: "bilibili:BV1", Platform: "bilibili", PlatformID: "BV1", Kind: "video", Title: "机器学习入门", Author: "老师", URL: "https://www.bilibili.com/video/BV1", SavedAt: 1},
		{ID: "rss:" + strings.Repeat("a", 64), Platform: "rss", PlatformID: strings.Repeat("a", 64), Kind: "article", Title: "Deep learning notes", Author: "Writer", URL: "https://example.com/a", Description: strings.Repeat("长", 3000), ArticleBlocks: []content.ArticleBlock{{Kind: "paragraph", Text: "body"}}, SavedAt: 2},
		{ID: "youtube:abc", Platform: "youtube", PlatformID: "abc", Kind: "video", Title: "100% done_ ok", Author: "Channel", URL: "https://www.youtube.com/watch?v=abc", SavedAt: 3},
	}
	for _, item := range items {
		if _, err := store.Save(ctx, item); err != nil {
			t.Fatal(err)
		}
	}
	page, err := store.Page(ctx, content.Query{})
	if err != nil || page.Total != 3 || len(page.Items) != 3 || page.Items[0].ID != "youtube:abc" || page.Counts["video"] != 2 || page.Counts["article"] != 1 {
		t.Fatalf("all cards: %+v %v", page, err)
	}
	article := page.Items[1]
	if !article.Partial || article.ArticleBlocks != nil || len([]rune(article.Description)) != content.CardDescriptionRunes || page.Items[0].Partial {
		t.Fatalf("card projection: %+v", article)
	}
	full, err := store.Get(ctx, article.ID)
	if err != nil || len(full.ArticleBlocks) != 1 || len([]rune(full.Description)) != 3000 {
		t.Fatal("stored item lost its body", err)
	}
	for _, c := range []struct {
		query content.Query
		ids   []string
	}{
		{content.Query{Kind: "video"}, []string{"youtube:abc", "bilibili:BV1"}},
		{content.Query{Platform: "bilibili"}, []string{"bilibili:BV1"}},
		{content.Query{Q: "学习入"}, []string{"bilibili:BV1"}},
		{content.Query{Q: "学习"}, []string{"bilibili:BV1"}},
		{content.Query{Q: "writer deep"}, []string{items[1].ID}},
		{content.Query{Q: "长长长"}, []string{items[1].ID}},
		{content.Query{Q: "0%"}, []string{"youtube:abc"}},
		{content.Query{Q: `"quoted`}, []string{}},
		{content.Query{Kind: "video", Q: "Channel"}, []string{"youtube:abc"}},
		{content.Query{Limit: 2, Offset: 2}, []string{"bilibili:BV1"}},
	} {
		page, err := store.Page(ctx, c.query)
		if err != nil || len(page.Items) != len(c.ids) {
			t.Fatalf("%+v: %+v %v", c.query, page, err)
		}
		for i, id := range c.ids {
			if page.Items[i].ID != id {
				t.Fatalf("%+v: %+v", c.query, page.Items)
			}
		}
	}
	first, err := store.Page(ctx, content.Query{Limit: 2})
	if err != nil || first.Next != 2 || first.Total != 3 {
		t.Fatalf("pagination: %+v %v", first, err)
	}
	// Renaming and removing keep the search index in step.
	renamed := items[0]
	renamed.Title = "Renamed video"
	if _, err := store.Save(ctx, renamed); err != nil {
		t.Fatal(err)
	}
	if page, _ := store.Page(ctx, content.Query{Q: "机器学习"}); page.Total != 0 {
		t.Fatal("stale title still matches")
	}
	if err := store.Delete(ctx, renamed.ID); err != nil {
		t.Fatal(err)
	}
	if page, _ := store.Page(ctx, content.Query{Q: "Renamed"}); page.Total != 0 {
		t.Fatal("deleted item still matches")
	}
}

func TestSavedLinuxdoTopicCanBeUpgradedWithDiscussion(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "library.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	item := content.Item{ID: "linuxdo:42", Platform: "linuxdo", PlatformID: "42", Kind: "article", Title: "合成话题", URL: "https://linux.do/t/42", Description: "旧缓存正文", SavedAt: 123}
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}
	item.Description = "更新后的主帖正文"
	item.ArticleBlocks = []content.ArticleBlock{{Kind: "paragraph", Text: item.Description}}
	item.Discussion = &content.Discussion{TopicID: "42", TotalPosts: 2, LoadedPosts: 1, PostIDs: []int64{101, 102}, Posts: []content.DiscussionPost{{ID: 101, Number: 1, Username: "synthetic", Blocks: item.ArticleBlocks}}}
	item.SavedAt = 123
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}

	got, err := store.Get(ctx, item.ID)
	if err != nil || got.SavedAt != 123 || got.Discussion == nil || got.Discussion.TotalPosts != 2 || got.Description != "更新后的主帖正文" {
		t.Fatalf("upgraded topic was not persisted: %+v, %v", got, err)
	}
}

func TestHistoryPersistsAcrossReopenAndKeepsNewestSnapshot(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	service := history.New(store)
	item := content.Item{ID: "youtube:abc", Platform: "youtube", PlatformID: "abc", Kind: "video", Title: "Old title", URL: "https://www.youtube.com/watch?v=abc"}
	newer := item
	newer.Title, newer.Description = "New title", strings.Repeat("d", 2000)
	bad := item
	bad.ID = "youtube:mismatch"
	kept, err := service.Record(ctx, []history.Entry{{Item: newer, OpenedAt: 2000}, {Item: item, OpenedAt: 1000}, {Item: bad, OpenedAt: 3000}})
	if err != nil || kept != 2 {
		t.Fatal("record", kept, err)
	}
	if _, err := service.AddSearches(ctx, []history.Search{{ID: "s1", Query: " 搜索 ", Source: "youtube", CreatedAt: 10}, {ID: "s1", Query: "dup", Source: "youtube", CreatedAt: 11}, {ID: "../bad", Query: "x", Source: "youtube", CreatedAt: 12}}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service = history.New(store)
	entries, err := service.Viewing(ctx)
	if err != nil || len(entries) != 1 || entries[0].Item.Title != "New title" || entries[0].OpenedAt != 2000 || entries[0].OpenCount != 2 || len([]rune(entries[0].Item.Description)) != content.CardDescriptionRunes {
		t.Fatalf("viewing history: %+v %v", entries, err)
	}
	searches, err := service.Searches(ctx)
	if err != nil || len(searches) != 1 || searches[0].Query != "搜索" {
		t.Fatalf("search history: %+v %v", searches, err)
	}
	if err := service.RemoveViewing(ctx, item.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.ClearSearches(ctx); err != nil {
		t.Fatal(err)
	}
	entries, _ = service.Viewing(ctx)
	searches, _ = service.Searches(ctx)
	if len(entries) != 0 || len(searches) != 0 {
		t.Fatal("history not removed")
	}
}

func TestAIResultsUpsertKeepsCreationTime(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "ai.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.AIResult(ctx, "translation", "h", "zh-Hans"); err != ai.ErrNotFound {
		t.Fatal("missing row", err)
	}
	for i, model := range []string{"a", "b"} {
		if err := store.PutAIResult(ctx, ai.StoredResult{Kind: "translation", SourceHash: "h", Target: "zh-Hans", Model: model, Value: model, CreatedAt: int64(10 + i)}); err != nil {
			t.Fatal(err)
		}
	}
	row, err := store.AIResult(ctx, "translation", "h", "zh-Hans")
	if err != nil || row.Model != "b" || row.Value != "b" || row.CreatedAt != 10 {
		t.Fatalf("%+v %v", row, err)
	}
	if rows, err := store.AIResults(ctx, "translation", "zh-Hans"); err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	if err := store.DeleteAIResult(ctx, "translation", "h", "zh-Hans"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AIResult(ctx, "translation", "h", "zh-Hans"); err != ai.ErrNotFound {
		t.Fatal("row not deleted", err)
	}
}
