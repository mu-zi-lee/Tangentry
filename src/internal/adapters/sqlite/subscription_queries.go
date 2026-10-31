package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
)

const subscriptionColumns = `id, creator_id, name, created_at, updated_at, snapshot`
const subscriptionJoinedColumns = `s.id,s.creator_id,s.name,s.created_at,s.updated_at,s.snapshot,r.payload,COALESCE(m.group_id,''),COALESCE(f.canonical,s.creator_id)`
const subscriptionJoins = ` LEFT JOIN subscription_refresh r ON r.id=s.id LEFT JOIN subscription_group_members m ON m.source_id=s.id LEFT JOIN subscription_feed_identity f ON f.id=s.id `

func scanSubscription(row interface{ Scan(...any) error }, joined ...bool) (subscriptions.Detail, error) {
	var detail subscriptions.Detail
	var payload string
	var metadata sql.NullString
	targets := []any{&detail.Source.ID, &detail.Source.CreatorID, &detail.Source.Name, &detail.Source.CreatedAt, &detail.Source.LastUpdatedAt, &payload}
	if len(joined) > 0 && joined[0] {
		targets = append(targets, &metadata, &detail.Source.GroupID, &detail.Source.IdentityURL)
	}
	err := row.Scan(targets...)
	if errors.Is(err, sql.ErrNoRows) {
		return detail, subscriptions.ErrNotFound
	}
	if err != nil {
		return detail, err
	}
	record := subscriptions.DefaultRefreshFor(detail.Source.ID)
	if metadata.Valid {
		if err = json.Unmarshal([]byte(metadata.String), &record); err != nil {
			return detail, err
		}
	}
	detail.Source.Refresh = record.State
	detail.Source.URL = subscriptions.SourceURL(detail.Source.ID, detail.Source.CreatorID)
	detail.Items = make([]content.Item, 0)
	if payload != "" {
		var snapshot subscriptions.Snapshot
		if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
			return detail, err
		}
		detail.Items = snapshot.Items
		detail.Source.SourceTitle, detail.Source.Total, detail.Source.HasMore = snapshot.Title, snapshot.Total, snapshot.HasMore
		detail.Source.ItemCount = len(snapshot.Items)
	}
	return detail, nil
}

// subscriptionSummaryColumns reads metadata in SQLite, so listing sources
// never transfers or decodes their stored items.
const subscriptionSummaryColumns = `s.id,s.creator_id,s.name,s.created_at,s.updated_at,` +
	`CASE WHEN s.snapshot='' THEN NULL ELSE json_extract(s.snapshot,'$.title') END,` +
	`CASE WHEN s.snapshot='' THEN NULL ELSE json_extract(s.snapshot,'$.total') END,` +
	`CASE WHEN s.snapshot='' THEN NULL ELSE json_extract(s.snapshot,'$.hasMore') END,` +
	`CASE WHEN s.snapshot='' THEN 0 ELSE COALESCE(json_array_length(s.snapshot,'$.items'),0) END,` +
	`r.payload,COALESCE(m.group_id,''),COALESCE(f.canonical,s.creator_id)`

func (s *Store) ListSubscriptions(ctx context.Context) ([]subscriptions.Source, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+subscriptionSummaryColumns+` FROM subscriptions s`+subscriptionJoins+`ORDER BY s.created_at DESC,s.rowid DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]subscriptions.Source, 0)
	for rows.Next() {
		var source subscriptions.Source
		var title sql.NullString
		var total sql.NullInt64
		var hasMore sql.NullBool
		var metadata sql.NullString
		if err := rows.Scan(&source.ID, &source.CreatorID, &source.Name, &source.CreatedAt, &source.LastUpdatedAt,
			&title, &total, &hasMore, &source.ItemCount, &metadata, &source.GroupID, &source.IdentityURL); err != nil {
			return nil, err
		}
		record := subscriptions.DefaultRefreshFor(source.ID)
		if metadata.Valid {
			if err := json.Unmarshal([]byte(metadata.String), &record); err != nil {
				return nil, err
			}
		}
		source.Refresh = record.State
		source.URL = subscriptions.SourceURL(source.ID, source.CreatorID)
		source.SourceTitle, source.Total, source.HasMore = title.String, int(total.Int64), hasMore.Bool
		items = append(items, source)
	}
	return items, rows.Err()
}

func (s *Store) GetSubscription(ctx context.Context, id string) (subscriptions.Detail, error) {
	return s.getSubscription(ctx, id, false)
}

func (s *Store) GetSubscriptionCards(ctx context.Context, id string) (subscriptions.Detail, error) {
	return s.getSubscription(ctx, id, true)
}

func (s *Store) getSubscription(ctx context.Context, id string, cards bool) (subscriptions.Detail, error) {
	columns := subscriptionJoinedColumns
	if cards {
		// Array iteration retains snapshot order; remove the original items before
		// assembling the small snapshot transferred to the Go JSON decoder.
		snapshot := `CASE WHEN s.snapshot='' THEN '' ELSE json_set(json_remove(s.snapshot,'$.items'),'$.items',
			(SELECT json_group_array(` + cardPayloadSQL("item.value") + `) FROM json_each(s.snapshot,'$.items') item)) END`
		columns = strings.Replace(columns, "s.snapshot", snapshot, 1)
	}
	detail, err := scanSubscription(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM subscriptions s`+subscriptionJoins+`WHERE s.id=?`, id), true)
	if err == nil {
		s.applyArticlePreviews(ctx, detail.Items)
		if cards {
			for index := range detail.Items {
				detail.Items[index] = content.Card(detail.Items[index])
			}
		}
	}
	return detail, err
}
