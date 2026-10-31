// Package history owns what the user opened and searched. It is kept in the
// database so it survives browser changes and is shared by every window.
package history

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"tangentry/internal/content"
)

var ErrInvalid = errors.New("invalid history")

const (
	// MaxViewing and MaxSearches bound what is kept; older entries are pruned.
	MaxViewing  = 1000
	MaxSearches = 100
	// MaxBatch bounds one request, large enough for a browser history upload.
	MaxBatch = MaxViewing
)

var searchID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
var searchSource = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)

// Entry is one opened item. OpenedAt is in milliseconds.
type Entry struct {
	Item      content.Item `json:"item"`
	OpenedAt  int64        `json:"openedAt"`
	OpenCount int          `json:"openCount,omitempty"`
}

// Search is one submitted query. CreatedAt is in milliseconds.
type Search struct {
	ID        string `json:"id"`
	Query     string `json:"query"`
	Source    string `json:"source"`
	CreatedAt int64  `json:"createdAt"`
}

type Repository interface {
	ListViewing(context.Context) ([]Entry, error)
	RecordViewing(context.Context, []Entry, int) error
	DeleteViewing(context.Context, string) error
	ClearViewing(context.Context) error
	ListSearches(context.Context) ([]Search, error)
	AddSearches(context.Context, []Search, int) error
	DeleteSearch(context.Context, string) error
	ClearSearches(context.Context) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func New(repository Repository) *Service { return &Service{repository: repository, now: time.Now} }

func (s *Service) Viewing(ctx context.Context) ([]Entry, error) { return s.repository.ListViewing(ctx) }

// snapshot keeps what a history card shows: a bounded description and the
// cover image, as browser history always stored it.
func snapshot(item content.Item) content.Item {
	item.ArticleBlocks, item.Transcripts, item.PreviewText, item.SavedAt, item.Partial = nil, nil, "", 0, false
	item.Description, _ = content.TruncateRunes(item.Description, content.CardDescriptionRunes)
	if len(item.Images) > 1 {
		item.Images = item.Images[:1]
	}
	return item
}

// Record stores visits. Invalid entries are skipped, so one damaged browser
// record cannot block uploading the rest; it reports how many were kept.
func (s *Service) Record(ctx context.Context, entries []Entry) (int, error) {
	if len(entries) == 0 || len(entries) > MaxBatch {
		return 0, ErrInvalid
	}
	limit := s.now().Add(24 * time.Hour).UnixMilli()
	valid := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		entry.Item = snapshot(entry.Item)
		if entry.OpenedAt <= 0 || entry.OpenedAt > limit || content.Validate(entry.Item) != nil {
			continue
		}
		entry.OpenCount = 1
		valid = append(valid, entry)
	}
	if len(valid) == 0 {
		return 0, ErrInvalid
	}
	return len(valid), s.repository.RecordViewing(ctx, valid, MaxViewing)
}

func (s *Service) RemoveViewing(ctx context.Context, id string) error {
	if id == "" || len(id) > 300 {
		return ErrInvalid
	}
	return s.repository.DeleteViewing(ctx, id)
}

func (s *Service) ClearViewing(ctx context.Context) error { return s.repository.ClearViewing(ctx) }

func (s *Service) Searches(ctx context.Context) ([]Search, error) {
	return s.repository.ListSearches(ctx)
}

// AddSearches stores queries, skipping invalid ones like Record does.
func (s *Service) AddSearches(ctx context.Context, searches []Search) (int, error) {
	if len(searches) == 0 || len(searches) > MaxBatch {
		return 0, ErrInvalid
	}
	limit := s.now().Add(24 * time.Hour).UnixMilli()
	valid := make([]Search, 0, len(searches))
	for _, search := range searches {
		search.Query = strings.TrimSpace(search.Query)
		if !searchID.MatchString(search.ID) || !searchSource.MatchString(search.Source) || search.Query == "" || len(search.Query) > 2048 || !utf8.ValidString(search.Query) || strings.ContainsRune(search.Query, 0) || search.CreatedAt <= 0 || search.CreatedAt > limit {
			continue
		}
		valid = append(valid, search)
	}
	if len(valid) == 0 {
		return 0, ErrInvalid
	}
	return len(valid), s.repository.AddSearches(ctx, valid, MaxSearches)
}

func (s *Service) RemoveSearch(ctx context.Context, id string) error {
	if !searchID.MatchString(id) {
		return ErrInvalid
	}
	return s.repository.DeleteSearch(ctx, id)
}

func (s *Service) ClearSearches(ctx context.Context) error { return s.repository.ClearSearches(ctx) }
