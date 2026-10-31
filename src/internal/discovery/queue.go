package discovery

import (
	"context"
	"regexp"
	"strings"
	"time"

	"tangentry/internal/content"
)

// PersonalAccount owns local recommendations independently of remote credentials.
const PersonalAccount = "0000000000000000000000000000000000000000000000000000000000000000"

// QueueScope isolates recommendations belonging to different platform accounts.
// Account is a credential fingerprint, never the credentials themselves.
type QueueScope struct {
	Platform string
	Account  string
}

type RecommendationQueue struct {
	repository QueueRepository
	scope      func(string) QueueScope
	clock      func() time.Time
}

func NewRecommendationQueue(repository QueueRepository, scope func(string) QueueScope) *RecommendationQueue {
	return &RecommendationQueue{repository: repository, scope: scope, clock: time.Now}
}

func (q *RecommendationQueue) Pending(ctx context.Context, platform string, limit int) ([]QueuedItem, error) {
	scope := q.scope(platform)
	if !ValidQueueScope(scope) || scope.Platform != platform || limit < 1 || limit > 500 {
		return nil, ErrInvalidQuery
	}
	items, err := q.repository.ListQueuedRecommendations(ctx, scope, limit)
	if err != nil {
		return nil, err
	}
	if q.scope(platform) != scope {
		return nil, ErrUnavailable
	}
	return items, nil
}

func (q *RecommendationQueue) Mark(ctx context.Context, platform, id string, opened bool) error {
	scope := q.scope(platform)
	if !ValidQueueScope(scope) || scope.Platform != platform || !content.ValidID(id) || !strings.HasPrefix(id, platform+":") {
		return ErrInvalidQuery
	}
	return q.repository.MarkQueuedRecommendation(ctx, scope, id, opened, q.clock().UnixMilli())
}

// Item reads the full local recommendation, including already opened items.
// Card projections must not force a network fetch or cross account boundaries.
func (q *RecommendationQueue) Item(ctx context.Context, platform, id string) (content.Item, error) {
	scope := q.scope(platform)
	if !ValidQueueScope(scope) || scope.Platform != platform || !content.ValidID(id) || !strings.HasPrefix(id, platform+":") {
		return content.Item{}, ErrInvalidQuery
	}
	repository, ok := q.repository.(interface {
		GetQueuedRecommendation(context.Context, QueueScope, string) (content.Item, error)
	})
	if !ok {
		return content.Item{}, ErrUnavailable
	}
	item, err := repository.GetQueuedRecommendation(ctx, scope, id)
	if q.scope(platform) != scope {
		return content.Item{}, ErrUnavailable
	}
	return item, err
}

func (q *RecommendationQueue) Fetch(ctx context.Context, platform string, fetch func(context.Context) (Feed, error)) (Feed, error) {
	scope := q.scope(platform)
	if !ValidQueueScope(scope) || scope.Platform != platform {
		return Feed{}, ErrInvalidQuery
	}
	feed, err := fetch(ctx)
	if err != nil {
		return Feed{}, err
	}
	// A credential change during a platform request must discard its old response.
	if q.scope(platform) != scope {
		return Feed{}, ErrUnavailable
	}
	if err := q.repository.EnqueueRecommendations(ctx, scope, feed.Items, q.clock().UnixMilli()); err != nil {
		return Feed{}, err
	}
	if q.scope(platform) != scope {
		return Feed{}, ErrUnavailable
	}
	return feed, nil
}

type QueuedItem struct {
	Item      content.Item `json:"item"`
	FetchedAt int64        `json:"fetchedAt"`
	SeenAt    int64        `json:"seenAt"`
	OpenedAt  int64        `json:"openedAt"`
}

type QueueRepository interface {
	EnqueueRecommendations(context.Context, QueueScope, []content.Item, int64) error
	ListQueuedRecommendations(context.Context, QueueScope, int) ([]QueuedItem, error)
	MarkQueuedRecommendation(context.Context, QueueScope, string, bool, int64) error
}

var accountFingerprint = regexp.MustCompile(`^[a-f0-9]{64}$`)

func ValidQueueScope(scope QueueScope) bool {
	return RecommendationPlatform(scope.Platform) && accountFingerprint.MatchString(scope.Account)
}

func ValidQueueBatch(scope QueueScope, items []content.Item, at int64) bool {
	if !ValidQueueScope(scope) || at <= 0 || len(items) > 500 {
		return false
	}
	for _, item := range items {
		if item.Platform != scope.Platform || content.Validate(item) != nil {
			return false
		}
	}
	return true
}
