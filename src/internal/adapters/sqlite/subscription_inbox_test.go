package sqlite

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"tangentry/internal/articles"
	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
	"testing"
)

func TestInboxDatabaseCardProjectionMatchesFullItemsAndPagination(t *testing.T) {
	s := inboxTestStore(t)
	ctx := context.Background()
	source := inboxTestSource(t, s, "卡片投影", "https://example.com/card-projection")
	other := inboxTestSource(t, s, "第二来源", "https://example.com/card-projection-other")
	items := make([]content.Item, 14)
	for index := range items {
		item := inboxTestItem(index+100, "article")
		switch index {
		case 0:
			item.Description = strings.Repeat("文🙂a", content.CardDescriptionRunes)
		case 1:
			item.Description = strings.Repeat("🙂", content.CardDescriptionRunes)
		case 2:
			item.ArticleBlocks = []content.ArticleBlock{{Kind: "paragraph", Text: "正文必须留在全文端点。"}}
		case 3:
			item.Transcripts = []content.Transcript{{URL: "https://example.com/subtitles.vtt", Type: "text/vtt"}}
		case 4:
			item.Discussion = &content.Discussion{TopicID: "topic"}
		case 5:
			item.Partial = true
		case 6:
			item.Images = []content.Image{{URL: "https://example.com/cover.png", Width: 640, Height: 360}}
		case 7:
			item.Paper = &content.PaperMetadata{ArxivID: "2401.00001", Abstract: "论文摘要"}
		case 8:
			item.Description = "Comments"
		case 9:
			item.Description = "前缀\x00" + strings.Repeat("🙂", content.CardDescriptionRunes)
		case 10:
			item.Description = "\x00短描述"
		case 11:
			item.Description = ""
		}
		items[index] = item
	}
	if _, err := s.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: items, Total: len(items)}, 10); err != nil {
		t.Fatal(err)
	}
	var projected, stored string
	if err := s.db.QueryRowContext(ctx, `SELECT `+inboxCardPayload()+`,i.payload FROM subscription_inbox i WHERE i.content_id=?`, items[0].ID).Scan(&projected, &stored); err != nil {
		t.Fatal(err)
	}
	if len(projected) >= len(stored)/2 {
		t.Fatal("database transferred the full description before projection", len(projected), len(stored))
	}
	if _, err := s.UpdateSubscription(ctx, other.ID, subscriptions.Snapshot{Items: items[:2], Total: 2}, 11); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSubscription(ctx, other.ID); err != nil {
		t.Fatal(err)
	}
	doc := articles.Document{ContentID: items[8].ID, SourceURL: items[8].URL, Title: items[8].Title, Revision: 1, Blocks: []articles.Block{{Kind: "paragraph", Text: strings.Repeat("缓存的原站正文。", 10)}}}
	if _, err := s.SaveArticle(ctx, doc, 0); err != nil {
		t.Fatal(err)
	}
	fullSource, err := s.GetSubscription(ctx, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	cardSource, err := s.GetSubscriptionCards(ctx, source.ID)
	if err != nil || !reflect.DeepEqual(fullSource.Source, cardSource.Source) || len(fullSource.Items) != len(cardSource.Items) {
		t.Fatal("source card projection changed metadata", err)
	}
	for index, item := range fullSource.Items {
		want, _ := json.Marshal(content.Card(item))
		got, _ := json.Marshal(cardSource.Items[index])
		if string(want) != string(got) {
			t.Fatalf("source item order or projection changed at %d\nwant %s\ngot %s", index, want, got)
		}
	}
	empty := inboxTestSource(t, s, "未更新来源", "https://example.com/no-snapshot")
	emptyCards, err := s.GetSubscriptionCards(ctx, empty.ID)
	if err != nil || emptyCards.Items == nil || len(emptyCards.Items) != 0 {
		t.Fatal("empty source card contract", err)
	}
	service := subscriptions.NewInboxService(s)
	cursor := ""
	for pageIndex, count := range []int{10, 4} {
		full, err := service.List(ctx, subscriptions.InboxQuery{Limit: 10, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		cards, err := service.List(ctx, subscriptions.InboxQuery{Limit: 10, Cursor: cursor, Cards: true})
		if err != nil || len(cards.Entries) != count || cards.NextCursor != full.NextCursor || !reflect.DeepEqual(cards.Sources, full.Sources) {
			t.Fatal("card mode changed page boundaries or sources", pageIndex, err)
		}
		for index, entry := range full.Entries {
			want, _ := json.Marshal(content.Card(entry.Item))
			got, _ := json.Marshal(cards.Entries[index].Item)
			if string(got) != string(want) || !reflect.DeepEqual(cards.Entries[index].Sources, entry.Sources) || cards.Entries[index].FirstSeenAt != entry.FirstSeenAt || cards.Entries[index].LastSeenAt != entry.LastSeenAt {
				t.Fatalf("projection mismatch for %s\nwant %s\ngot  %s", entry.Item.ID, want, got)
			}
			original, err := service.Item(ctx, entry.Item.ID)
			if err != nil || !reflect.DeepEqual(original, entry.Item) {
				t.Fatal("card read mutated stored content", entry.Item.ID, err)
			}
		}
		cursor = cards.NextCursor
	}
	if cursor != "" {
		t.Fatal("unexpected third page")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := service.List(cancelled, subscriptions.InboxQuery{Cards: true}); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled card read proceeded", err)
	}
}

func inboxTestItem(n int, kind string) content.Item {
	id := fmt.Sprintf("%064x", n)
	return content.Item{ID: "rss:" + id, Platform: "rss", PlatformID: id, Kind: kind, Title: fmt.Sprintf("历史 %03d", n), Author: "测试作者", URL: "https://example.com/item/" + id, Description: "保留的正文", MediaURL: "https://example.com/media.mp3"}
}
func inboxTestSource(t *testing.T, s *Store, name, url string) subscriptions.Source {
	t.Helper()
	source, _, err := subscriptions.NewService(s, nil).Create(context.Background(), subscriptions.Input{Type: "rss", Query: url, Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return source
}
func inboxTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "inbox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestInboxGraphicalFilterIncludesArticlesAndAlbums(t *testing.T) {
	s := inboxTestStore(t)
	ctx := context.Background()
	source := inboxTestSource(t, s, "图文", "https://example.com/graphical")
	items := []content.Item{inboxTestItem(1, "article"), inboxTestItem(2, "image"), inboxTestItem(3, "video")}
	if _, err := s.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: items, Total: len(items)}, 10); err != nil {
		t.Fatal(err)
	}
	service := subscriptions.NewInboxService(s)
	page, err := service.List(ctx, subscriptions.InboxQuery{Kind: "graphical"})
	if err != nil || len(page.Entries) != 2 {
		t.Fatal(page, err)
	}
	for _, entry := range page.Entries {
		if entry.Item.Kind != "article" && entry.Item.Kind != "image" {
			t.Fatal(entry)
		}
	}
	for _, kind := range []string{"article", "image"} {
		page, err = service.List(ctx, subscriptions.InboxQuery{Kind: kind})
		if err != nil || len(page.Entries) != 1 || page.Entries[0].Item.Kind != kind {
			t.Fatal("legacy exact filter changed", page, err)
		}
	}
}
func TestInboxRetainsDisappearingContentDeduplicatesAndTracksSources(t *testing.T) {
	s := inboxTestStore(t)
	ctx := context.Background()
	service := subscriptions.NewInboxService(s)
	a := inboxTestSource(t, s, "阅读", "https://example.com/a")
	b := inboxTestSource(t, s, "播客", "https://example.com/b")
	old := inboxTestItem(1, "audio")
	fresh := inboxTestItem(2, "article")
	if _, err := s.UpdateSubscription(ctx, a.ID, subscriptions.Snapshot{Items: []content.Item{old}, Total: 1}, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateSubscription(ctx, a.ID, subscriptions.Snapshot{Items: []content.Item{fresh}, Total: 1}, 20); err != nil {
		t.Fatal(err)
	}
	old.Title = "修正标题"
	old.SavedAt = 123
	if _, err := s.UpdateSubscription(ctx, b.ID, subscriptions.Snapshot{Items: []content.Item{old}, Total: 1}, 30); err != nil {
		t.Fatal(err)
	}
	page, err := service.List(ctx, subscriptions.InboxQuery{})
	if err != nil || len(page.Entries) != 2 {
		t.Fatal(page, err)
	}
	entry := page.Entries[1]
	if entry.Item.Title != old.Title || entry.FirstSeenAt != 10 || entry.LastSeenAt != 30 || entry.Item.SavedAt != 0 || len(entry.Sources) != 2 {
		t.Fatal(entry)
	}
	// Older commits from a second source add provenance without reverting metadata.
	stale := old
	stale.Title = "过期元数据"
	if _, err = s.UpdateSubscription(ctx, a.ID, subscriptions.Snapshot{Items: []content.Item{stale}, Total: 1}, 15); err != nil {
		t.Fatal(err)
	}
	item, err := service.Item(ctx, old.ID)
	if err != nil || item.Title != old.Title || item.MediaURL != old.MediaURL {
		t.Fatal(item, err)
	}
	if library, _ := s.List(ctx); len(library) != 0 {
		t.Fatal("implicit bookmark")
	}
	group, _, err := subscriptions.NewGroupService(s).Create(ctx, "学习")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AssignSubscriptionGroup(ctx, a.ID, group.ID, ""); err != nil {
		t.Fatal(err)
	}
	page, err = service.List(ctx, subscriptions.InboxQuery{GroupID: group.ID, Kind: "audio", Query: "修正"})
	if err != nil || len(page.Entries) != 1 {
		t.Fatal(page, err)
	}
	if _, err = s.SetReadStates(ctx, []string{old.ID}, true, 99); err != nil {
		t.Fatal(err)
	}
	page, err = service.List(ctx, subscriptions.InboxQuery{Read: "unread"})
	if err != nil || len(page.Entries) != 1 || page.Entries[0].Item.ID != fresh.ID {
		t.Fatal(page, err)
	}
	if _, err = s.RenameSubscription(ctx, a.ID, "已改名"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteSubscription(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	page, err = service.List(ctx, subscriptions.InboxQuery{SourceID: a.ID, Read: "read"})
	if err != nil || len(page.Entries) != 1 || page.Entries[0].Sources[0].Name == "阅读" {
		t.Fatal(page, err)
	}
	removed := false
	for _, source := range page.Entries[0].Sources {
		if source.ID == a.ID {
			removed = source.Removed && source.Name == "已改名"
		}
	}
	if !removed {
		t.Fatal("missing retained name", page)
	}
	page, err = service.List(ctx, subscriptions.InboxQuery{GroupID: group.ID})
	if err != nil || len(page.Entries) != 0 {
		t.Fatal("removed source in live group", page, err)
	}
	if _, err = service.Item(ctx, old.ID); err != nil {
		t.Fatal("deleted source lost reader", err)
	}
}

func TestInboxStablePaginationFiltersAndExplicitReadBoundary(t *testing.T) {
	s := inboxTestStore(t)
	ctx := context.Background()
	source := inboxTestSource(t, s, "大量条目", "https://example.com/feed")
	items := []content.Item{}
	for i := 55; i > 0; i-- {
		items = append(items, inboxTestItem(i, "article"))
	}
	if _, err := s.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: items, Total: 55}, 100); err != nil {
		t.Fatal(err)
	}
	service := subscriptions.NewInboxService(s)
	first, err := service.List(ctx, subscriptions.InboxQuery{})
	if err != nil || len(first.Entries) != 50 || first.NextCursor == "" {
		t.Fatal(first, err)
	}
	newest := inboxTestItem(56, "audio")
	if _, err = s.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: []content.Item{newest}, Total: 1}, 200); err != nil {
		t.Fatal(err)
	}
	second, err := service.List(ctx, subscriptions.InboxQuery{Cursor: first.NextCursor})
	if err != nil || len(second.Entries) != 5 || second.NextCursor != "" {
		t.Fatal(second, err)
	}
	seen := map[string]bool{}
	for _, entry := range append(first.Entries, second.Entries...) {
		if seen[entry.Item.ID] || entry.Item.ID == newest.ID {
			t.Fatal("pagination duplicate / new arrival")
		}
		seen[entry.Item.ID] = true
	}
	if len(seen) != 55 {
		t.Fatal(len(seen))
	}
	ids := []string{}
	for _, entry := range first.Entries {
		ids = append(ids, entry.Item.ID)
	}
	if _, err = s.SetReadStates(ctx, ids, true, 300); err != nil {
		t.Fatal(err)
	}
	unread, err := service.List(ctx, subscriptions.InboxQuery{Read: "unread"})
	if err != nil || len(unread.Entries) != 6 {
		t.Fatal("bulk touched unseen IDs", unread, err)
	}
	for _, q := range []subscriptions.InboxQuery{{Cursor: first.NextCursor, Kind: "audio"}, {Cursor: "garbage"}, {Cursor: strings.Repeat("x", 513)}, {Query: strings.Repeat("中", 201)}, {SourceID: "invalid"}, {GroupID: "invalid"}, {Read: "maybe"}, {Kind: "unknown"}} {
		if _, err = service.List(ctx, q); !errors.Is(err, subscriptions.ErrInboxInvalid) {
			t.Fatal(q, err)
		}
	}
	for _, q := range []string{"%", "_", "' OR 1=1 --"} {
		page, err := service.List(ctx, subscriptions.InboxQuery{Query: q})
		if err != nil || len(page.Entries) != 0 {
			t.Fatal("literal search", q, page, err)
		}
	}
	page, err := service.List(ctx, subscriptions.InboxQuery{Query: "历史 003"})
	if err != nil || len(page.Entries) != 1 {
		t.Fatal(page, err)
	}
}

func TestInboxSnapshotAtomicityMetadataOnlyAndCancellation(t *testing.T) {
	s := inboxTestStore(t)
	ctx := context.Background()
	source := inboxTestSource(t, s, "测试", "https://example.com/atomic")
	old := subscriptions.Snapshot{Items: []content.Item{inboxTestItem(1, "audio")}, Total: 1}
	before, err := s.UpdateSubscription(ctx, source.ID, old, 10)
	if err != nil {
		t.Fatal(err)
	}
	page, _, err := s.ListSubscriptionInbox(ctx, subscriptions.InboxQuery{}, subscriptions.InboxPosition{})
	if err != nil {
		t.Fatal(err)
	}
	record := subscriptions.DefaultRefresh()
	record.State.ContentRevision = 5
	if _, err = s.CommitSubscriptionRefresh(ctx, source.ID, nil, 99, record); err != nil {
		t.Fatal(err)
	}
	afterPage, _, err := s.ListSubscriptionInbox(ctx, subscriptions.InboxQuery{}, subscriptions.InboxPosition{})
	if err != nil || !reflect.DeepEqual(page, afterPage) {
		t.Fatal("metadata-only changed archive", err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER fail_inbox BEFORE INSERT ON subscription_inbox BEGIN SELECT RAISE(ABORT,'archive failed'); END`); err != nil {
		t.Fatal(err)
	}
	fresh := subscriptions.Snapshot{Items: []content.Item{inboxTestItem(2, "article")}, Total: 1}
	record.State.ContentRevision = 6
	if _, err = s.UpdateSubscription(ctx, source.ID, fresh, 20); err == nil {
		t.Fatal("archive failure accepted")
	}
	if _, err = s.CommitSubscriptionRefresh(ctx, source.ID, &fresh, 20, record); err == nil {
		t.Fatal("archive failure accepted validators")
	}
	detail, err := s.GetSubscription(ctx, source.ID)
	if err != nil || !reflect.DeepEqual(detail.Items, before.Items) || detail.Source.LastUpdatedAt != 10 || detail.Source.Refresh.ContentRevision != 5 {
		t.Fatal("partial commit", detail, err)
	}
	if _, err = s.db.Exec(`DROP TRIGGER fail_inbox`); err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.CommitSubscriptionRefresh(cancelled, source.ID, &fresh, 30, record); err == nil {
		t.Fatal("cancelled write")
	}
	afterPage, _, err = s.ListSubscriptionInbox(ctx, subscriptions.InboxQuery{}, subscriptions.InboxPosition{})
	if err != nil || !reflect.DeepEqual(page, afterPage) {
		t.Fatal("cancellation changed archive", err)
	}
}

func TestInboxMigrationSeedsOnceWithoutRewritingLegacyRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	source := inboxTestSource(t, s, "旧来源", "https://example.com/old")
	snapshot := subscriptions.Snapshot{Items: []content.Item{inboxTestItem(1, "audio"), inboxTestItem(2, "article")}, Total: 2}
	payload, _ := json.Marshal(snapshot)
	if _, err = s.db.Exec(`UPDATE subscriptions SET snapshot=?,updated_at=123 WHERE id=?`, string(payload), source.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`DELETE FROM schema_version WHERE version=14; DROP TABLE subscription_inbox; DROP TABLE subscription_inbox_sources`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	for i := 0; i < 2; i++ {
		s, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
		var raw string
		var updatedAt int64
		if err = s.db.QueryRow(`SELECT snapshot,updated_at FROM subscriptions WHERE id=?`, source.ID).Scan(&raw, &updatedAt); err != nil || raw != string(payload) || updatedAt != 123 {
			t.Fatal("legacy row rewritten", err)
		}
		page, err := subscriptions.NewInboxService(s).List(ctx, subscriptions.InboxQuery{})
		if err != nil || len(page.Entries) != 2 || page.Entries[0].FirstSeenAt != 123 || page.Entries[0].Item.ID != snapshot.Items[0].ID {
			t.Fatal(page, err)
		}
		var version int
		if err = s.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil || version != latestVersion(t) {
			t.Fatal(version, err)
		}
		s.Close()
	}
}
