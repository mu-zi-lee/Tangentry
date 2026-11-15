package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"tangentry/internal/content"
	"tangentry/internal/downloads"
	"tangentry/internal/notes"
	"tangentry/internal/readstate"
	"tangentry/internal/subscriptions"
	"testing"
)

func TestVersionFifteenFeedMigrationKeepsExistingReadingData(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "version-fifteen.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { store.Close() }()
	service := subscriptions.NewService(store, nil)
	source, _, err := service.Create(ctx, subscriptions.Input{Type: "rss", Query: "https://example.com/migrating-feed"})
	if err != nil {
		t.Fatal(err)
	}
	service.Close()
	id := "rss:" + strings.Repeat("a", 64)
	item := content.Item{ID: id, Platform: "rss", PlatformID: strings.Repeat("a", 64), Kind: "article", Title: "migration article", URL: "https://example.com/article"}
	if _, err := store.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: []content.Item{item}, Title: "feed", Total: 1}, 123); err != nil {
		t.Fatal(err)
	}
	note, err := notes.NewService(store).Create(ctx, notes.Input{ContentID: id, Body: "migration note"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readstate.New(store).Set(ctx, []string{id}, true); err != nil {
		t.Fatal(err)
	}
	// Recreate the exact missing table/version boundary of a version15 database.
	if _, err := store.db.Exec(`DROP TABLE subscription_feed_identity`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DELETE FROM schema_version WHERE version>=16; DROP TABLE recommendation_queue`); err != nil {
		t.Fatal(err)
	}
	store.Close()
	for range 2 {
		store, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
		detail, err := store.GetSubscription(ctx, source.ID)
		if err != nil || detail.Source.IdentityURL != source.URL || detail.Source.ID != source.ID || detail.Source.LastUpdatedAt != 123 || len(detail.Items) != 1 || detail.Items[0].ID != id {
			t.Fatal("migration changed source namespace or snapshot", err)
		}
		states, err := readstate.New(store).Batch(ctx, []string{id})
		if err != nil || len(states) != 1 || !states[0].Read {
			t.Fatal("migration lost read status")
		}
		memos, err := notes.NewService(store).List(ctx, id)
		if err != nil || len(memos) != 1 || memos[0].ID != note.ID {
			t.Fatal("migration lost notes")
		}
		var version int
		if err := store.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil || version != latestVersion(t) {
			t.Fatal("migration version missing")
		}
		store.Close()
	}
}

func TestSubscriptionsUpgradePreservesVersionThreeData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE schema_version (version INTEGER PRIMARY KEY)`, `INSERT INTO schema_version VALUES (1),(2),(3)`,
		`CREATE TABLE saved_content (id TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at INTEGER NOT NULL)`,
		`CREATE TABLE downloads (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE TABLE notes (id TEXT PRIMARY KEY, content_id TEXT NOT NULL, body TEXT NOT NULL, position_seconds REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
		`CREATE INDEX notes_by_content ON notes(content_id, created_at DESC)`,
	} {
		if _, err := legacy.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	item := content.Item{ID: "bilibili:BV17x411w7KC", Platform: "bilibili", PlatformID: "BV17x411w7KC", Kind: "video", Title: "existing source collection", URL: "https://www.bilibili.com/video/BV17x411w7KC/", SavedAt: 123}
	job := downloads.Job{ID: "existing-download", URL: item.URL, State: "completed", CreatedAt: 124}
	itemJSON, _ := json.Marshal(item)
	jobJSON, _ := json.Marshal(job)
	if _, err := legacy.Exec(`INSERT INTO saved_content VALUES (?,?,?)`, item.ID, string(itemJSON), item.SavedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO downloads VALUES (?,?,?)`, job.ID, string(jobJSON), job.CreatedAt); err != nil {
		t.Fatal(err)
	}
	const noteID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := legacy.Exec(`INSERT INTO notes VALUES (?,?,?,NULL,125,125)`, noteID, item.ID, "existing note"); err != nil {
		t.Fatal(err)
	}
	legacy.Close()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	service := subscriptions.NewService(store, nil)
	source, created, err := service.Create(ctx, subscriptions.Input{Query: "12345"})
	if err != nil || !created {
		t.Fatal("subscription could not be added")
	}
	if err := service.Delete(ctx, source.ID); err != nil {
		t.Fatal(err)
	}
	library, err := store.List(ctx)
	if err != nil || len(library) != 1 {
		t.Fatal("collection changed on upgrade/source removal")
	}
	// Migration 84 backfills server-owned version fields; every original
	// field must remain identical.
	if library[0].ContentRevision != 1 || library[0].ContentHash == "" {
		t.Fatal("content version backfill missing")
	}
	library[0].ContentRevision, library[0].ContentHash = 0, ""
	if !reflect.DeepEqual(library[0], item) {
		t.Fatal("collection changed on upgrade/source removal")
	}
	jobs, err := store.ListDownloads(ctx)
	if err != nil || len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Fatal("download history changed")
	}
	memo, err := notes.NewService(store).List(ctx, item.ID)
	if err != nil || len(memo) != 1 || memo[0].ID != noteID || memo[0].Body != "existing note" {
		t.Fatal("notes changed")
	}
	var version int
	if err := store.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil || version < 4 {
		t.Fatal("version four not recorded")
	}
}

func TestSubscriptionListSummarizesSnapshotsLikeFullReads(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "summary.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := subscriptions.NewService(store, nil)
	empty, _, err := service.Create(ctx, subscriptions.Input{Type: "rss", Query: "https://example.com/empty-feed"})
	if err != nil {
		t.Fatal(err)
	}
	filled, _, err := service.Create(ctx, subscriptions.Input{Type: "rss", Query: "https://example.com/filled-feed"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := subscriptions.Snapshot{Title: "示例 Feed", Total: 42, HasMore: true, Items: []content.Item{
		{ID: "rss:" + strings.Repeat("a", 64), Platform: "rss", PlatformID: strings.Repeat("a", 64), Kind: "article", Title: "一", URL: "https://example.com/1"},
		{ID: "rss:" + strings.Repeat("b", 64), Platform: "rss", PlatformID: strings.Repeat("b", 64), Kind: "article", Title: "二", URL: "https://example.com/2"},
	}}
	if _, err := store.UpdateSubscription(ctx, filled.ID, snapshot, 1720000000); err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListSubscriptions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 {
		t.Fatalf("listed %d sources, want 2", len(listed))
	}
	for _, id := range []string{empty.ID, filled.ID} {
		full, err := store.GetSubscription(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		var summary subscriptions.Source
		for _, source := range listed {
			if source.ID == id {
				summary = source
			}
		}
		if !reflect.DeepEqual(summary, full.Source) {
			t.Fatalf("summary differs from the full read:\n got %+v\nwant %+v", summary, full.Source)
		}
	}
	if listed[0].ID != filled.ID || listed[0].ItemCount != 2 || listed[0].Total != 42 || !listed[0].HasMore || listed[0].SourceTitle != "示例 Feed" {
		t.Fatalf("filled source summary = %+v", listed[0])
	}
}
