package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"reflect"
	"tangentry/internal/content"
	"tangentry/internal/downloads"
	"tangentry/internal/readingprogress"
	"tangentry/internal/subscriptions"
	"testing"
)

func TestProgressUpgradeKeepsVersionFourData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-four.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE schema_version(version INTEGER PRIMARY KEY)`, `INSERT INTO schema_version VALUES(1),(2),(3),(4)`,
		`CREATE TABLE saved_content(id TEXT PRIMARY KEY,payload TEXT NOT NULL,saved_at INTEGER NOT NULL)`,
		`CREATE TABLE downloads(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at INTEGER NOT NULL)`,
		`CREATE TABLE notes(id TEXT PRIMARY KEY,content_id TEXT NOT NULL,body TEXT NOT NULL,position_seconds REAL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
		`CREATE TABLE subscriptions(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL DEFAULT 0,snapshot TEXT NOT NULL DEFAULT '')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	item := content.Item{ID: "bilibili:BV17x411w7KC", Platform: "bilibili", PlatformID: "BV17x411w7KC", Kind: "video", Title: "old library", URL: "https://www.bilibili.com/video/BV17x411w7KC/", SavedAt: 123}
	job := downloads.Job{ID: "old-download", URL: item.URL, State: "completed", CreatedAt: 124}
	snapshot := subscriptions.Snapshot{Items: []content.Item{item}, Total: 1, Title: "old creator"}
	itemJSON, _ := json.Marshal(item)
	jobJSON, _ := json.Marshal(job)
	snapshotJSON, _ := json.Marshal(snapshot)
	if _, err := db.Exec(`INSERT INTO saved_content VALUES(?,?,?)`, item.ID, string(itemJSON), item.SavedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO downloads VALUES(?,?,?)`, job.ID, string(jobJSON), job.CreatedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO notes VALUES(?,?,?,NULL,125,125)`, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", item.ID, "old memo"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO subscriptions VALUES(?,?,?,?,?,?)`, "bilibili:creator:12345", "12345", "old source", 126, 127, string(snapshotJSON)); err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	if _, err := readingprogress.NewService(store).Save(ctx, item.ID, readingprogress.Input{PositionSeconds: 5, DurationSeconds: 12}); err != nil {
		t.Fatal(err)
	}
	items, err := store.List(ctx)
	if err != nil || len(items) != 1 {
		t.Fatal("library changed")
	}
	// Migration 84 backfills server-owned version fields; every original
	// field must remain identical.
	if items[0].ContentRevision != 1 || items[0].ContentHash == "" {
		t.Fatal("content version backfill missing")
	}
	items[0].ContentRevision, items[0].ContentHash = 0, ""
	if !reflect.DeepEqual(items[0], item) {
		t.Fatal("library changed")
	}
	jobs, err := store.ListDownloads(ctx)
	if err != nil || len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Fatal("downloads changed")
	}
	notes, err := store.ListNotes(ctx, item.ID)
	if err != nil || len(notes) != 1 || notes[0].Body != "old memo" {
		t.Fatal("notes changed")
	}
	source, err := store.GetSubscription(ctx, "bilibili:creator:12345")
	if err != nil || source.Source.Name != "old source" || source.Source.LastUpdatedAt != 127 || len(source.Items) != 1 || !reflect.DeepEqual(source.Items[0], item) {
		t.Fatal("subscription snapshot changed")
	}
	var version int
	store.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version)
	if version < 5 {
		t.Fatal("version five missing")
	}
}
