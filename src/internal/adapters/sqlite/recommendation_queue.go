package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"tangentry/internal/content"
	"tangentry/internal/discovery"
)

func (s *Store) GetQueuedRecommendation(ctx context.Context, scope discovery.QueueScope, id string) (content.Item, error) {
	if !discovery.ValidQueueScope(scope) || !content.ValidID(id) || !strings.HasPrefix(id, scope.Platform+":") {
		return content.Item{}, discovery.ErrInvalidQuery
	}
	var payload []byte
	err := s.db.QueryRowContext(ctx, `SELECT payload FROM recommendation_queue WHERE platform=? AND account=? AND content_id=?`, scope.Platform, scope.Account, id).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return content.Item{}, content.ErrNotFound
	}
	if err != nil {
		return content.Item{}, err
	}
	var item content.Item
	if json.Unmarshal(payload, &item) != nil || item.ID != id || content.Validate(item) != nil {
		return content.Item{}, content.ErrNotFound
	}
	return item, nil
}

func (s *Store) EnqueueRecommendations(ctx context.Context, scope discovery.QueueScope, items []content.Item, at int64) error {
	if !discovery.ValidQueueBatch(scope, items, at) {
		return discovery.ErrInvalidQuery
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range items {
		payload, err := json.Marshal(item)
		if err != nil {
			return err
		}
		// Duplicate recommendations refresh metadata, never browsing marks or
		// first-arrival order. Older responses cannot replace newer metadata.
		if _, err := tx.ExecContext(ctx, `INSERT INTO recommendation_queue(platform,account,content_id,payload,fetched_at,metadata_at)
		 VALUES(?,?,?,?,?,?) ON CONFLICT(platform,account,content_id) DO UPDATE SET payload=excluded.payload,metadata_at=excluded.metadata_at
		 WHERE excluded.metadata_at >= recommendation_queue.metadata_at`, scope.Platform, scope.Account, item.ID, string(payload), at, at); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListQueuedRecommendations(ctx context.Context, scope discovery.QueueScope, limit int) ([]discovery.QueuedItem, error) {
	if !discovery.ValidQueueScope(scope) || limit < 1 || limit > 500 {
		return nil, discovery.ErrInvalidQuery
	}
	rows, err := s.db.QueryContext(ctx, `SELECT payload,fetched_at,seen_at,opened_at FROM recommendation_queue
	 WHERE platform=? AND account=? AND opened_at=0 ORDER BY (seen_at>0),fetched_at,content_id LIMIT ?`, scope.Platform, scope.Account, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]discovery.QueuedItem, 0)
	for rows.Next() {
		var entry discovery.QueuedItem
		var payload string
		if err := rows.Scan(&payload, &entry.FetchedAt, &entry.SeenAt, &entry.OpenedAt); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(payload), &entry.Item) != nil || entry.Item.Platform != scope.Platform || content.Validate(entry.Item) != nil {
			continue
		}
		result = append(result, entry)
	}
	return result, rows.Err()
}

func (s *Store) MarkQueuedRecommendation(ctx context.Context, scope discovery.QueueScope, id string, opened bool, at int64) error {
	if !discovery.ValidQueueScope(scope) || id == "" || at <= 0 {
		return discovery.ErrInvalidQuery
	}
	query := `UPDATE recommendation_queue SET seen_at=CASE WHEN seen_at=0 THEN ? ELSE MIN(seen_at,?) END WHERE platform=? AND account=? AND content_id=?`
	args := []any{at, at, scope.Platform, scope.Account, id}
	if opened {
		query = `UPDATE recommendation_queue SET opened_at=CASE WHEN opened_at=0 THEN ? ELSE MIN(opened_at,?) END WHERE platform=? AND account=? AND content_id=?`
	}
	_, err := s.db.ExecContext(ctx, query, args...)
	return err
}
