package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/content"
	"tangentry/internal/retrieval"
)

func versionTestItem(id, text string) content.Item {
	return content.Item{
		ID: id, Platform: "bilibili", PlatformID: strings.TrimPrefix(id, "bilibili:"),
		Kind: "article", Title: "版本测试", SavedAt: 100,
		ArticleBlocks: []content.ArticleBlock{{Kind: "paragraph", Text: text}},
	}
}

// TestBT38_ContentRevisionMigration: an old database upgrades with
// content_revision=1 and a computed content_hash; a successful save
// increments the revision and replaces the hash; repeated migration is
// idempotent; the new fields are exposed for C/E; no duplicate column
// migration exists.
func TestBT38_ContentRevisionMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a pre-084 database: every earlier version recorded, the old
	// saved_content schema, representative legacy rows.
	if _, err := db.Exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	for v := 1; v <= 83; v++ {
		if _, err := db.Exec(`INSERT INTO schema_version(version) VALUES(?)`, v); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE saved_content (id TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	article := versionTestItem("bilibili:BV17x411w7KC", "旧版证据文本。")
	discussion := content.Item{
		ID: "linuxdo:12345", Platform: "linuxdo", PlatformID: "12345",
		Kind: "article", Title: "讨论测试", SavedAt: 100,
		Discussion: &content.Discussion{Posts: []content.DiscussionPost{
			{Number: 1, Blocks: []content.ArticleBlock{{Kind: "paragraph", Text: "楼主发言。"}}},
		}},
	}
	video := content.Item{
		ID: "bilibili:BV1aa411c7mD", Platform: "bilibili", PlatformID: "BV1aa411c7mD",
		Kind: "video", Title: "视频卡片", SavedAt: 100,
	}
	legacy := []content.Item{article, discussion, video}
	for _, item := range legacy {
		payload, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO saved_content(id,payload,saved_at) VALUES(?,?,?)`, item.ID, string(payload), item.SavedAt); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	ctx := context.Background()
	store, err := Open(path)
	if err != nil {
		t.Fatalf("upgrade failed: %v", err)
	}
	// Backfill: revision 1 + computed hash for every legacy row.
	for _, item := range legacy {
		got, err := store.Get(ctx, item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.ContentRevision != 1 {
			t.Fatalf("%s: revision = %d, want 1", item.ID, got.ContentRevision)
		}
		wantHash := retrieval.SnapshotHash(itemSnapshot(got))
		if got.ContentHash != wantHash || len(got.ContentHash) != 64 {
			t.Fatalf("%s: hash = %q, want computed %q", item.ID, got.ContentHash, wantHash)
		}
	}
	// List exposes the fields too (C/E read path).
	list, err := store.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range list {
		if item.ContentRevision != 1 || item.ContentHash == "" {
			t.Fatalf("List missing version fields: %+v", item)
		}
	}
	// API shape: the item JSON carries both fields.
	got, _ := store.Get(ctx, article.ID)
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"contentRevision":1`) || !strings.Contains(string(raw), `"contentHash":"`) {
		t.Fatalf("API JSON missing version fields: %s", raw)
	}

	// Successful update increments the revision and replaces the hash.
	updated := versionTestItem(article.ID, "新版证据文本。")
	saved, err := store.Save(ctx, updated)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ContentRevision != 2 {
		t.Fatalf("revision after update = %d, want 2", saved.ContentRevision)
	}
	if saved.ContentHash == got.ContentHash {
		t.Fatal("hash must be replaced on update")
	}
	if saved.ContentHash != retrieval.SnapshotHash(itemSnapshot(saved)) {
		t.Fatal("stored hash must equal the normalized snapshot hash")
	}
	// Client-supplied revision/hash are ignored (server-owned).
	forged := versionTestItem(article.ID, "第三版文本。")
	forged.ContentRevision, forged.ContentHash = 999, strings.Repeat("f", 64)
	saved2, err := store.Save(ctx, forged)
	if err != nil {
		t.Fatal(err)
	}
	if saved2.ContentRevision != 3 || saved2.ContentHash == strings.Repeat("f", 64) {
		t.Fatalf("client revision/hash must be ignored: %+v", saved2)
	}
	// Payload must not carry stale server-owned fields.
	var payload string
	if err := store.db.QueryRow(`SELECT payload FROM saved_content WHERE id=?`, article.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(payload, `"contentRevision"`) || strings.Contains(payload, `"contentHash"`) {
		t.Fatal("payload must not embed server-owned version fields")
	}
	store.Close()

	// Repeated migration is idempotent: values unchanged after re-open.
	store2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	after, err := store2.Get(ctx, article.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.ContentRevision != 3 || after.ContentHash != saved2.ContentHash {
		t.Fatalf("re-open changed version state: %+v", after)
	}
	var recorded int
	if err := store2.db.QueryRow(`SELECT count(*) FROM schema_version WHERE version=84`).Scan(&recorded); err != nil || recorded != 1 {
		t.Fatalf("migration 84 must be recorded exactly once: %d %v", recorded, err)
	}
}

// TestBT38_FreshDatabaseVersioning: a fresh database starts at revision 1 and
// increments on every successful update; identical re-saves still increment
// (monotonic per successful update, documented).
func TestBT38_FreshDatabaseVersioning(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	item := versionTestItem("bilibili:BV17x411w7KC", "第一版。")
	first, err := store.Save(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	if first.ContentRevision != 1 || first.ContentHash == "" {
		t.Fatalf("first save: %+v", first)
	}
	second, err := store.Save(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	if second.ContentRevision != 2 {
		t.Fatalf("second save revision = %d, want 2", second.ContentRevision)
	}
	if second.ContentHash != first.ContentHash {
		t.Fatal("identical content must keep the same normalized hash")
	}
}

// TestBT38_SingleColumnOwner: exactly one migration file introduces the
// content_revision/content_hash column set (B owns it; C/E must not duplicate).
func TestBT38_SingleColumnOwner(t *testing.T) {
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	owners := 0
	for _, m := range migrations {
		if strings.Contains(m.body, "content_revision") || strings.Contains(m.body, "content_hash") {
			owners++
			if m.version != 84 {
				t.Fatalf("unexpected column owner: %03d_%s", m.version, m.name)
			}
		}
	}
	if owners != 1 {
		t.Fatalf("column set must have exactly one migration owner, found %d", owners)
	}
	// The Go step is registered for 84.
	if migrationSteps[84] == nil {
		t.Fatal("migration 84 must register its backfill Go step")
	}
}

// TestBT38_OldDumpFixtureSanity: the fixture path really lacks the columns
// before the upgrade (guards the test itself).
func TestBT38_OldDumpFixtureSanity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "probe.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	if _, err := db.Exec(`CREATE TABLE saved_content (id TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('saved_content') WHERE name='content_revision'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("old schema must lack content_revision: %d %v", count, err)
	}
	db.Close()
}
