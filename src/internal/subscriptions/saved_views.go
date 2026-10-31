package subscriptions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var ErrSavedViewInvalid = errors.New("invalid saved view")
var ErrSavedViewNotFound = errors.New("saved view not found")

const SavedViewDefinitionVersion = 1

var savedViewID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var savedViewColors = map[string]bool{"teal": true, "blue": true, "green": true, "amber": true, "rose": true, "gray": true}
var savedViewIcons = map[string]bool{"file-text": true, "play": true, "headphones": true, "image": true, "bookmark": true, "filter": true, "newspaper": true, "circle": true}

type SavedViewFilters struct {
	Query       string `json:"query,omitempty"`
	SourceID    string `json:"sourceId,omitempty"`
	GroupID     string `json:"groupId,omitempty"`
	Platform    string `json:"platform,omitempty"`
	Kind        string `json:"kind,omitempty"`
	Topic       string `json:"topic,omitempty"`
	Tag         string `json:"tag,omitempty"`
	Read        string `json:"read,omitempty"`
	Favorite    bool   `json:"favorite,omitempty"`
	SinceOffset string `json:"sinceOffset,omitempty"`
	Since       int64  `json:"since,omitempty"`
	Until       int64  `json:"until,omitempty"`
}

type SavedViewDefinition struct {
	Version int              `json:"version"`
	Filters SavedViewFilters `json:"filters"`
}

type SavedView struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	DefinitionVersion int                 `json:"definitionVersion"`
	Definition        SavedViewDefinition `json:"definition"`
	Icon              string              `json:"icon"`
	Color             string              `json:"color"`
	SortOrder         int                 `json:"sortOrder"`
	Default           bool                `json:"default"`
	Builtin           bool                `json:"builtin"`
	Count             int                 `json:"count"`
}

type SavedViewInput struct {
	Name       string              `json:"name"`
	Definition SavedViewDefinition `json:"definition"`
	Icon       string              `json:"icon"`
	Color      string              `json:"color"`
}

type SavedViewEdit struct {
	Name       *string              `json:"name,omitempty"`
	Definition *SavedViewDefinition `json:"definition,omitempty"`
	Icon       *string              `json:"icon,omitempty"`
	Color      *string              `json:"color,omitempty"`
	SortOrder  *int                 `json:"sortOrder,omitempty"`
	Default    *bool                `json:"default,omitempty"`
}

type SavedViewRepository interface {
	InboxRepository
	ListSavedViews(context.Context) ([]SavedView, error)
	GetSavedView(context.Context, string) (SavedView, error)
	CountSubscriptionInbox(context.Context, InboxQuery) (int, error)
	CreateSavedView(context.Context, SavedView) (SavedView, error)
	UpdateSavedView(context.Context, string, SavedViewEdit) (SavedView, error)
	DeleteSavedView(context.Context, string) error
	ReorderSavedViews(context.Context, []string) error
}

type SavedViewService struct {
	repository SavedViewRepository
	inbox      *InboxService
}

func NewSavedViewService(repository SavedViewRepository) *SavedViewService {
	return &SavedViewService{repository: repository, inbox: NewInboxService(repository)}
}

func (s *SavedViewService) List(ctx context.Context) ([]SavedView, error) {
	views, err := s.repository.ListSavedViews(ctx)
	if err != nil {
		return nil, err
	}
	for i := range views {
		query, err := normalizeViewFilters(views[i].Definition.Filters)
		if err != nil || views[i].Definition.Version != SavedViewDefinitionVersion || views[i].DefinitionVersion != SavedViewDefinitionVersion {
			return nil, ErrSavedViewInvalid
		}
		views[i].Definition.Filters = query
		count, err := s.repository.CountSubscriptionInbox(ctx, inboxQueryForCount(query, time.Now()))
		if err != nil {
			return nil, err
		}
		views[i].Count = count
	}
	return views, nil
}

func (s *SavedViewService) Get(ctx context.Context, id string) (SavedView, error) {
	if !validSavedViewID(id) {
		return SavedView{}, ErrSavedViewInvalid
	}
	view, err := s.repository.GetSavedView(ctx, id)
	if err != nil {
		return SavedView{}, err
	}
	definition, err := normalizeDefinition(view.Definition)
	if err != nil || view.DefinitionVersion != definition.Version {
		return SavedView{}, ErrSavedViewInvalid
	}
	view.Definition = definition
	return view, nil
}

func (s *SavedViewService) Query(ctx context.Context, id, cursor string, limit int) (InboxPage, int, error) {
	return s.query(ctx, id, cursor, limit, false)
}

func (s *SavedViewService) QueryCards(ctx context.Context, id, cursor string, limit int) (InboxPage, int, error) {
	return s.query(ctx, id, cursor, limit, true)
}

func (s *SavedViewService) query(ctx context.Context, id, cursor string, limit int, cards bool) (InboxPage, int, error) {
	view, err := s.Get(ctx, id)
	if err != nil {
		return InboxPage{}, 0, err
	}
	query, err := BuildSavedViewQuery(view, cursor, limit, time.Now())
	if err != nil {
		return InboxPage{}, 0, err
	}
	query.Cards = cards
	page, err := s.inbox.List(ctx, query)
	if err != nil {
		return InboxPage{}, 0, err
	}
	count, err := s.repository.CountSubscriptionInbox(ctx, query)
	return page, count, err
}

func (s *SavedViewService) Create(ctx context.Context, input SavedViewInput) (SavedView, error) {
	view, err := savedViewFromInput(input)
	if err != nil {
		return SavedView{}, err
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return SavedView{}, err
	}
	view.ID = "view:" + hex.EncodeToString(random[:])
	return s.repository.CreateSavedView(ctx, view)
}

func (s *SavedViewService) Update(ctx context.Context, id string, edit SavedViewEdit) (SavedView, error) {
	if !validSavedViewID(id) {
		return SavedView{}, ErrSavedViewInvalid
	}
	if edit.Name != nil {
		name, ok := validViewName(*edit.Name)
		if !ok {
			return SavedView{}, ErrSavedViewInvalid
		}
		edit.Name = &name
	}
	if edit.Definition != nil {
		definition, err := normalizeDefinition(*edit.Definition)
		if err != nil {
			return SavedView{}, err
		}
		edit.Definition = &definition
	}
	if edit.Icon != nil && !savedViewIcons[*edit.Icon] || edit.Color != nil && !savedViewColors[*edit.Color] || edit.SortOrder != nil && (*edit.SortOrder < 0 || *edit.SortOrder > 10000) {
		return SavedView{}, ErrSavedViewInvalid
	}
	return s.repository.UpdateSavedView(ctx, id, edit)
}

func (s *SavedViewService) Delete(ctx context.Context, id string) error {
	if !validSavedViewID(id) {
		return ErrSavedViewInvalid
	}
	return s.repository.DeleteSavedView(ctx, id)
}

func (s *SavedViewService) Reorder(ctx context.Context, ids []string) error {
	if len(ids) > 200 {
		return ErrSavedViewInvalid
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !validSavedViewID(id) || seen[id] {
			return ErrSavedViewInvalid
		}
		seen[id] = true
	}
	return s.repository.ReorderSavedViews(ctx, ids)
}

func (s *SavedViewService) Count(ctx context.Context, view SavedView) (int, error) {
	query, err := BuildSavedViewQuery(view, "", 0, time.Now())
	if err != nil {
		return 0, err
	}
	return s.repository.CountSubscriptionInbox(ctx, query)
}

func validSavedViewID(id string) bool {
	return savedViewID.MatchString(id) || strings.HasPrefix(id, "view:") && len(id) == len("view:")+32 && savedViewID.MatchString(strings.TrimPrefix(id, "view:")) || strings.HasPrefix(id, "builtin-") && savedViewID.MatchString(id)
}

func savedViewFromInput(input SavedViewInput) (SavedView, error) {
	name, ok := validViewName(input.Name)
	if !ok || input.Icon != "" && !savedViewIcons[input.Icon] || input.Color != "" && !savedViewColors[input.Color] {
		return SavedView{}, ErrSavedViewInvalid
	}
	definition, err := normalizeDefinition(input.Definition)
	if err != nil {
		return SavedView{}, err
	}
	if input.Icon == "" {
		input.Icon = "filter"
	}
	if input.Color == "" {
		input.Color = "teal"
	}
	return SavedView{Name: name, DefinitionVersion: SavedViewDefinitionVersion, Definition: definition, Icon: input.Icon, Color: input.Color}, nil
}

func validViewName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, utf8.ValidString(name) && utf8.RuneCountInString(name) > 0 && utf8.RuneCountInString(name) <= 40 && strings.IndexFunc(name, unicode.IsControl) < 0
}

func normalizeDefinition(definition SavedViewDefinition) (SavedViewDefinition, error) {
	if definition.Version != SavedViewDefinitionVersion {
		return SavedViewDefinition{}, ErrSavedViewInvalid
	}
	filters, err := normalizeViewFilters(definition.Filters)
	if err != nil {
		return SavedViewDefinition{}, err
	}
	return SavedViewDefinition{Version: SavedViewDefinitionVersion, Filters: filters}, nil
}

func normalizeViewFilters(filters SavedViewFilters) (SavedViewFilters, error) {
	filters.Query = strings.TrimSpace(filters.Query)
	filters.Topic = strings.TrimSpace(filters.Topic)
	filters.Tag = strings.TrimSpace(filters.Tag)
	query := InboxQuery{Query: filters.Query, SourceID: filters.SourceID, GroupID: filters.GroupID, Platform: filters.Platform, Kind: filters.Kind, Topic: filters.Topic, Tag: filters.Tag, Read: filters.Read, Since: filters.Since, Until: filters.Until}
	if err := validateInboxQuery(query); err != nil || !validFilterText(filters.Topic, 80) || !validFilterText(filters.Tag, 80) || filters.Since < 0 || filters.Until < 0 || filters.Until > 0 && filters.Since > filters.Until {
		return SavedViewFilters{}, ErrSavedViewInvalid
	}
	if filters.SinceOffset != "" && filters.SinceOffset != "day" && filters.SinceOffset != "week" && filters.SinceOffset != "month" {
		return SavedViewFilters{}, ErrSavedViewInvalid
	}
	if filters.SinceOffset != "" && (filters.Since != 0 || filters.Until != 0) {
		return SavedViewFilters{}, ErrSavedViewInvalid
	}
	return filters, nil
}

func validFilterText(value string, limit int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit && strings.IndexFunc(value, unicode.IsControl) < 0
}

func BuildSavedViewQuery(view SavedView, cursor string, limit int, now time.Time) (InboxQuery, error) {
	definition, err := normalizeDefinition(view.Definition)
	if err != nil || view.DefinitionVersion != definition.Version {
		return InboxQuery{}, ErrSavedViewInvalid
	}
	filters := definition.Filters
	query := InboxQuery{Query: filters.Query, SourceID: filters.SourceID, GroupID: filters.GroupID, Platform: filters.Platform, Kind: filters.Kind, Topic: filters.Topic, Tag: filters.Tag, Read: filters.Read, Favorite: filters.Favorite, Cursor: cursor, Limit: limit}
	if filters.SinceOffset != "" {
		day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		current := day.Unix()
		switch filters.SinceOffset {
		case "day":
			query.Since = current
		case "week":
			weekday := (int(day.Weekday()) + 6) % 7
			query.Since = current - int64(weekday)*24*60*60
		case "month":
			query.Since = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
		}
	} else {
		query.Since, query.Until = filters.Since, filters.Until
	}
	return query, nil
}

func inboxQueryForCount(filters SavedViewFilters, now time.Time) InboxQuery {
	view := SavedView{DefinitionVersion: SavedViewDefinitionVersion, Definition: SavedViewDefinition{Version: SavedViewDefinitionVersion, Filters: filters}}
	query, _ := BuildSavedViewQuery(view, "", 0, now)
	return query
}

func marshalViewDefinition(definition SavedViewDefinition) (string, error) {
	encoded, err := json.Marshal(definition)
	return string(encoded), err
}
