package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"tangentry/internal/subtitles"
)

func (s *Store) ListSavedSubtitles(ctx context.Context, id string) ([]subtitles.SavedTrack, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload,revision,saved_at,selected FROM saved_subtitles WHERE content_id=? AND payload<>'' ORDER BY language`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]subtitles.SavedTrack, 0)
	for rows.Next() {
		value := subtitles.SavedTrack{ContentID: id}
		var raw string
		if err := rows.Scan(&raw, &value.Revision, &value.SavedAt, &value.Selected); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &value.Track); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}
func (s *Store) SaveSubtitles(ctx context.Context, value subtitles.SavedTrack, expected int64) (subtitles.SavedTrack, error) {
	raw, err := json.Marshal(value.Track)
	if err != nil {
		return subtitles.SavedTrack{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return subtitles.SavedTrack{}, err
	}
	defer tx.Rollback()
	if value.Selected {
		if _, err := tx.ExecContext(ctx, `UPDATE saved_subtitles SET selected=0 WHERE content_id=? AND selected=1`, value.ContentID); err != nil {
			return subtitles.SavedTrack{}, err
		}
	}
	if expected == 0 {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM saved_subtitles WHERE content_id=? AND payload<>''`, value.ContentID).Scan(&count); err != nil {
			return subtitles.SavedTrack{}, err
		}
		if count >= subtitles.MaxSavedLanguages {
			return subtitles.SavedTrack{}, subtitles.ErrSavedLimit
		}
		err = tx.QueryRowContext(ctx, `INSERT INTO saved_subtitles(content_id,language,payload,revision,saved_at,selected) VALUES(?,?,?,1,?,?)
			ON CONFLICT(content_id,language) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at,selected=excluded.selected,revision=saved_subtitles.revision+1
			WHERE saved_subtitles.payload='' AND saved_subtitles.revision<? RETURNING revision,selected`, value.ContentID, value.Track.Language, string(raw), value.SavedAt, value.Selected, subtitles.MaxSavedRevision).Scan(&value.Revision, &value.Selected)
	} else {
		err = tx.QueryRowContext(ctx, `UPDATE saved_subtitles SET payload=?,revision=revision+1,saved_at=?,selected=CASE WHEN ? THEN 1 ELSE selected END WHERE content_id=? AND language=? AND revision=? AND payload<>'' RETURNING revision,selected`, string(raw), value.SavedAt, value.Selected, value.ContentID, value.Track.Language, expected).Scan(&value.Revision, &value.Selected)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return subtitles.SavedTrack{}, subtitles.ErrSavedConflict
	}
	if err != nil {
		return subtitles.SavedTrack{}, err
	}
	if err := tx.Commit(); err != nil {
		return subtitles.SavedTrack{}, err
	}
	return value, nil
}
func (s *Store) DeleteSavedSubtitles(ctx context.Context, id, language string, revision int64) error {
	// Retain only a revision tombstone, so an old page cannot overwrite a track
	// that another page deleted and recreated. Caption text is removed.
	result, err := s.db.ExecContext(ctx, `UPDATE saved_subtitles SET payload='',revision=revision+1,selected=0 WHERE content_id=? AND language=? AND revision=? AND payload<>''`, id, language, revision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return subtitles.ErrSavedConflict
	}
	return nil
}
