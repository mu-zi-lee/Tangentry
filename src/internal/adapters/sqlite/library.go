package sqlite

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"tangentry/internal/content"
)

// Page filters and projects cards in SQL without decoding reader-only bodies.
// A zero limit retains the existing unpaginated-list contract.
func (s *Store) Page(ctx context.Context, q content.Query) (content.Page, error) {
	where, args := libraryFilter(q)
	page := content.Page{Items: []content.Item{}, Counts: map[string]int{}}
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(json_extract(payload,'$.kind'),''), count(*) FROM saved_content WHERE `+where+` GROUP BY 1`, args...)
	if err != nil {
		return content.Page{}, err
	}
	for rows.Next() {
		var kind string
		var count int
		if err := rows.Scan(&kind, &count); err != nil {
			rows.Close()
			return content.Page{}, err
		}
		page.Counts[kind] = count
		if q.Kind == "" || q.Kind == kind {
			page.Total += count
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return content.Page{}, err
	}
	if q.Kind != "" {
		where += ` AND json_extract(payload,'$.kind')=?`
		args = append(args, q.Kind)
	}
	limit := q.Limit
	if limit == 0 {
		limit = -1
	}
	rows, err = s.db.QueryContext(ctx, `SELECT `+cardPayloadSQL("payload")+`, saved_at FROM saved_content WHERE `+where+` ORDER BY saved_at DESC, id LIMIT ? OFFSET ?`, append(args, limit, q.Offset)...)
	if err != nil {
		return content.Page{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var payload string
		var item content.Item
		if err := rows.Scan(&payload, &item.SavedAt); err != nil {
			return content.Page{}, err
		}
		savedAt := item.SavedAt
		if err := json.Unmarshal([]byte(payload), &item); err != nil {
			return content.Page{}, err
		}
		item.SavedAt = savedAt
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return content.Page{}, err
	}
	rows.Close()
	s.applyArticlePreviews(ctx, page.Items)
	for i := range page.Items {
		page.Items[i] = content.Card(page.Items[i])
	}
	if q.Limit > 0 && q.Offset+len(page.Items) < page.Total {
		page.Next = q.Offset + len(page.Items)
	}
	return page, nil
}

// libraryFilter builds the platform and text conditions. Each search term
// must match; terms of three or more characters use the trigram index and
// shorter ones fall back to a substring scan of the same columns.
func libraryFilter(q content.Query) (string, []any) {
	conditions, args := []string{"true"}, []any{}
	if q.Platform != "" {
		// Identities are platform:id, so the primary key serves this range.
		conditions = append(conditions, `id >= ? AND id < ?`)
		args = append(args, q.Platform+":", q.Platform+";")
	}
	match := []string{}
	for _, term := range strings.Fields(q.Q) {
		if utf8.RuneCountInString(term) >= 3 {
			match = append(match, `"`+strings.ReplaceAll(term, `"`, `""`)+`"`)
			continue
		}
		pattern := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(term) + "%"
		conditions = append(conditions, `id IN (SELECT id FROM library_search WHERE title LIKE ? ESCAPE '\' OR author LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\' OR body LIKE ? ESCAPE '\' OR subtitles LIKE ? ESCAPE '\')`)
		args = append(args, pattern, pattern, pattern, pattern, pattern)
	}
	if len(match) > 0 {
		conditions = append(conditions, `id IN (SELECT id FROM library_search WHERE library_search MATCH ?)`)
		args = append(args, strings.Join(match, " AND "))
	}
	return strings.Join(conditions, " AND "), args
}
