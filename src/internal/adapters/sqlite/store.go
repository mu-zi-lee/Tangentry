package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	_ "modernc.org/sqlite"
	"tangentry/internal/content"
)

type Store struct {
	db          *sql.DB
	path        string
	downloadDir string
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{`PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("initialize content store: %w", err)
		}
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, path: path}, nil
}

func (s *Store) SetBackupDownloadDirectory(directory string) { s.downloadDir = directory }

func (s *Store) Close() error { return s.db.Close() }

// Get reads one saved item by its primary key; content.ErrNotFound when it is not saved.
func (s *Store) Get(ctx context.Context, id string) (content.Item, error) {
	var payload string
	var savedAt int64
	var revision int64
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT payload, saved_at, content_revision, content_hash FROM saved_content WHERE id=?`, id).Scan(&payload, &savedAt, &revision, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return content.Item{}, content.ErrNotFound
	}
	if err != nil {
		return content.Item{}, err
	}
	items := make([]content.Item, 1)
	if err := json.Unmarshal([]byte(payload), &items[0]); err != nil {
		return content.Item{}, err
	}
	items[0].SavedAt = savedAt
	items[0].ContentRevision, items[0].ContentHash = revision, hash
	s.applyArticlePreviews(ctx, items)
	return items[0], nil
}

func (s *Store) List(ctx context.Context) ([]content.Item, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload, saved_at, content_revision, content_hash FROM saved_content ORDER BY saved_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]content.Item, 0)
	for rows.Next() {
		var payload string
		var savedAt int64
		var revision int64
		var hash string
		if err := rows.Scan(&payload, &savedAt, &revision, &hash); err != nil {
			return nil, err
		}
		var item content.Item
		if err := json.Unmarshal([]byte(payload), &item); err != nil {
			return nil, err
		}
		item.SavedAt = savedAt
		item.ContentRevision, item.ContentHash = revision, hash
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	s.applyArticlePreviews(ctx, items)
	return items, nil
}

func (s *Store) Save(ctx context.Context, item content.Item) (content.Item, error) {
	item.PreviewText = ""
	// Revision and hash are server-owned: never trusted from the caller and
	// never embedded in the payload (the columns are authoritative).
	item.ContentRevision, item.ContentHash = 0, ""
	payload, err := json.Marshal(item)
	if err != nil {
		return content.Item{}, err
	}
	hash := itemSnapshotHash(item)
	_, err = s.db.ExecContext(ctx, `INSERT INTO saved_content(id,payload,saved_at,content_revision,content_hash) VALUES(?,?,?,1,?)
		ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, content_revision=saved_content.content_revision+1, content_hash=excluded.content_hash`, item.ID, string(payload), item.SavedAt, hash)
	if err != nil {
		return content.Item{}, err
	}
	err = s.db.QueryRowContext(ctx, `SELECT saved_at, content_revision, content_hash FROM saved_content WHERE id=?`, item.ID).Scan(&item.SavedAt, &item.ContentRevision, &item.ContentHash)
	return item, err
}

func (s *Store) Delete(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM saved_content WHERE id=?`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return content.ErrNotFound
	}
	return nil
}
