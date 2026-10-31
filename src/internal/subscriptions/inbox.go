package subscriptions

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"tangentry/internal/content"
	"unicode"
	"unicode/utf8"
)

var ErrInboxInvalid = errors.New("invalid subscription inbox query")
var ErrInboxNotFound = errors.New("subscription inbox content not found")

const InboxPageSize = 50

type InboxSource struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Removed bool   `json:"removed"`
}
type InboxEntry struct {
	Item        content.Item  `json:"item"`
	FirstSeenAt int64         `json:"firstSeenAt"`
	LastSeenAt  int64         `json:"lastSeenAt"`
	Sources     []InboxSource `json:"sources"`
}
type InboxPage struct {
	Entries    []InboxEntry  `json:"entries"`
	Sources    []InboxSource `json:"sources"`
	NextCursor string        `json:"nextCursor"`
}
type InboxQuery struct {
	Query    string
	SourceID string
	GroupID  string
	Platform string
	Kind     string
	Topic    string
	Tag      string
	Read     string
	Favorite bool
	Since    int64
	Until    int64
	Cursor   string
	Limit    int
	// Cards changes representation only; it does not change cursor identity.
	Cards bool
}
type InboxPosition struct {
	Before  int64  `json:"before"`
	Ceiling int64  `json:"ceiling"`
	Filter  string `json:"filter"`
}
type InboxRepository interface {
	ListSubscriptionInbox(context.Context, InboxQuery, InboxPosition) (InboxPage, InboxPosition, error)
	CountSubscriptionInbox(context.Context, InboxQuery) (int, error)
	GetSubscriptionInboxItem(context.Context, string) (content.Item, error)
}
type InboxService struct{ repository InboxRepository }

func NewInboxService(repository InboxRepository) *InboxService {
	return &InboxService{repository: repository}
}

func (s *InboxService) List(ctx context.Context, query InboxQuery) (InboxPage, error) {
	if query.Limit == 0 {
		query.Limit = InboxPageSize
	}
	switch query.Limit {
	case 10, 20, 30, 50:
	default:
		return InboxPage{}, ErrInboxInvalid
	}
	if err := validateInboxQuery(query); err != nil {
		return InboxPage{}, err
	}
	query.Query = strings.TrimSpace(query.Query)
	if query.Read == "all" {
		query.Read = ""
	}
	filters := []string{query.Query, query.SourceID, query.GroupID, query.Platform, query.Kind, query.Topic, query.Tag, query.Read, strconv.FormatBool(query.Favorite), strconv.FormatInt(query.Since, 10), strconv.FormatInt(query.Until, 10)}
	if query.Limit != InboxPageSize {
		filters = append(filters, strconv.Itoa(query.Limit))
	}
	raw, _ := json.Marshal(filters)
	digest := sha256.Sum256(raw)
	key := hex.EncodeToString(digest[:])
	position := InboxPosition{Filter: key}
	if query.Cursor != "" {
		if len(query.Cursor) > 512 {
			return InboxPage{}, ErrInboxInvalid
		}
		data, err := base64.RawURLEncoding.DecodeString(query.Cursor)
		if err != nil || json.Unmarshal(data, &position) != nil || position.Filter != key || position.Before <= 0 || position.Ceiling < position.Before {
			return InboxPage{}, ErrInboxInvalid
		}
	}
	page, next, err := s.repository.ListSubscriptionInbox(ctx, query, position)
	if err != nil {
		return InboxPage{}, err
	}
	if query.Cards {
		for index := range page.Entries {
			page.Entries[index].Item = content.Card(page.Entries[index].Item)
		}
	}
	if next.Before > 0 {
		data, _ := json.Marshal(next)
		page.NextCursor = base64.RawURLEncoding.EncodeToString(data)
	}
	return page, nil
}

func validateInboxQuery(query InboxQuery) error {
	query.Query = strings.TrimSpace(query.Query)
	if !utf8.ValidString(query.Query) || utf8.RuneCountInString(query.Query) > 200 || strings.IndexFunc(query.Query, unicode.IsControl) >= 0 || query.SourceID != "" && !validID(query.SourceID) || query.GroupID != "" && !groupID.MatchString(query.GroupID) || !validFilterText(query.Platform, 40) || !validFilterText(query.Topic, 80) || !validFilterText(query.Tag, 80) || query.Since < 0 || query.Until < 0 || query.Until > 0 && query.Since > query.Until {
		return ErrInboxInvalid
	}
	switch query.Kind {
	case "", "video", "audio", "article", "pdf", "image", "graphical":
	default:
		return ErrInboxInvalid
	}
	switch query.Read {
	case "", "all", "read", "unread":
	default:
		return ErrInboxInvalid
	}
	return nil
}
func (s *InboxService) Item(ctx context.Context, id string) (content.Item, error) {
	if !content.ValidID(id) {
		return content.Item{}, ErrInboxInvalid
	}
	return s.repository.GetSubscriptionInboxItem(ctx, id)
}

func (s *InboxService) Count(ctx context.Context, query InboxQuery) (int, error) {
	if err := validateInboxQuery(query); err != nil {
		return 0, err
	}
	query.Query = strings.TrimSpace(query.Query)
	if query.Read == "all" {
		query.Read = ""
	}
	return s.repository.CountSubscriptionInbox(ctx, query)
}
