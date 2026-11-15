package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"tangentry/internal/content"
	"tangentry/internal/retrieval"
)

// itemSnapshot builds the normalized retrieval snapshot for a saved content
// item. Source priority (v1): PDF kind → pdf (page text arrives in phase 3);
// discussion posts → discussion; article blocks → article; otherwise saved
// subtitle tracks (loaded by RetrievalSource). Block/post indices are stable
// array positions (article blocks and posts have no database ID).
func itemSnapshot(item content.Item) retrieval.Snapshot {
	snap := retrieval.Snapshot{
		ContentID: item.ID,
		Version:   fmt.Sprintf("content-revision:%d", item.ContentRevision),
	}
	switch {
	case item.Kind == "pdf":
		snap.Kind = retrieval.SourcePDF
	case item.Discussion != nil && len(item.Discussion.Posts) > 0:
		snap.Kind = retrieval.SourceDiscussion
		for i, post := range item.Discussion.Posts {
			blocks := make([]retrieval.Block, 0, len(post.Blocks))
			for j, b := range post.Blocks {
				blocks = append(blocks, retrieval.Block{Index: j, Kind: b.Kind, Level: b.Level, Text: b.Text})
			}
			snap.Posts = append(snap.Posts, retrieval.DiscussionPost{Index: i, Blocks: blocks})
		}
	case len(item.ArticleBlocks) > 0:
		snap.Kind = retrieval.SourceArticle
		for i, b := range item.ArticleBlocks {
			snap.Blocks = append(snap.Blocks, retrieval.Block{Index: i, Kind: b.Kind, Level: b.Level, Text: b.Text})
		}
	default:
		snap.Kind = retrieval.SourceSubtitle
	}
	return snap
}

// itemSnapshotHash computes the normalized snapshot hash stored in
// saved_content.content_hash. It never depends on the revision itself.
func itemSnapshotHash(item content.Item) string {
	return retrieval.SnapshotHash(itemSnapshot(item))
}

// addContentVersion is the migration 84 Go step: it adds content_revision
// (monotonic integer, default 1) and content_hash (SHA-256 of the normalized
// snapshot) to saved_content, then backfills legacy rows with revision 1 and
// a computed hash. Idempotent: columns are pragma-checked and only rows with
// an empty hash are backfilled. B owns this column set; C/E consume it.
func addContentVersion(tx *sql.Tx) error {
	for _, col := range []struct{ name, decl string }{
		{"content_revision", "INTEGER NOT NULL DEFAULT 1"},
		{"content_hash", "TEXT NOT NULL DEFAULT ''"},
	} {
		var exists int
		if err := tx.QueryRow(`SELECT count(*) FROM pragma_table_info('saved_content') WHERE name=?`, col.name).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if _, err := tx.Exec(`ALTER TABLE saved_content ADD COLUMN ` + col.name + ` ` + col.decl); err != nil {
				return err
			}
		}
	}
	rows, err := tx.Query(`SELECT id, payload FROM saved_content WHERE content_hash=''`)
	if err != nil {
		return err
	}
	type legacyRow struct{ id, payload string }
	var legacy []legacyRow
	for rows.Next() {
		var r legacyRow
		if err := rows.Scan(&r.id, &r.payload); err != nil {
			rows.Close()
			return err
		}
		legacy = append(legacy, r)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, r := range legacy {
		var item content.Item
		// A corrupt payload hashes as the empty snapshot; the row still gets
		// revision 1 from the column default and a deterministic hash.
		_ = json.Unmarshal([]byte(r.payload), &item)
		if _, err := tx.Exec(`UPDATE saved_content SET content_hash=? WHERE id=?`, itemSnapshotHash(item), r.id); err != nil {
			return err
		}
	}
	return nil
}
