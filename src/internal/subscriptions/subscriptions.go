// Package subscriptions owns saved sources and their latest successful page.
// It never saves library items or starts downloads; feed polling is explicitly enabled per source.
package subscriptions

import (
	"context"
	"errors"
	"strings"
	"sync"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/netpolicy"
	papersdomain "tangentry/internal/papers"
	"time"
)

var (
	ErrInvalid         = errors.New("invalid subscription")
	ErrNotFound        = errors.New("subscription not found")
	ErrBusy            = errors.New("subscription is being changed")
	ErrSnapshot        = errors.New("incomplete subscription snapshot")
	ErrChannelInput    = errors.New("invalid YouTube channel")
	ErrAddressConflict = errors.New("subscription address changed")
	ErrAddressExists   = errors.New("subscription address already saved")
)

type Source struct {
	ID            string       `json:"id"`
	CreatorID     string       `json:"creatorId"`
	IdentityURL   string       `json:"-"`
	Name          string       `json:"name"`
	GroupID       string       `json:"groupId"`
	URL           string       `json:"url"`
	CreatedAt     int64        `json:"createdAt"`
	LastUpdatedAt int64        `json:"lastUpdatedAt"`
	SourceTitle   string       `json:"sourceTitle"`
	ItemCount     int          `json:"itemCount"`
	Total         int          `json:"total"`
	HasMore       bool         `json:"hasMore"`
	Refresh       RefreshState `json:"refresh"`
	Active        bool         `json:"active"`
}
type Snapshot struct {
	Items   []content.Item `json:"items"`
	Title   string         `json:"title"`
	Total   int            `json:"total"`
	HasMore bool           `json:"hasMore"`
}
type Detail struct {
	Source      Source         `json:"source"`
	Items       []content.Item `json:"items"`
	NotModified bool           `json:"notModified,omitempty"`
}
type Input struct {
	Type  string `json:"type,omitempty"`
	Query string `json:"query"`
	Name  string `json:"name"`
}
type Edit struct {
	Name string `json:"name"`
}
type Repository interface {
	ListSubscriptions(context.Context) ([]Source, error)
	GetSubscription(context.Context, string) (Detail, error)
	CreateSubscription(context.Context, Source) (Source, bool, error)
	RenameSubscription(context.Context, string, string) (Source, error)
	UpdateSubscription(context.Context, string, Snapshot, int64) (Detail, error)
	DeleteSubscription(context.Context, string) error
	GetSubscriptionRefresh(context.Context, string) (RefreshRecord, error)
	CommitSubscriptionRefresh(context.Context, string, *Snapshot, int64, RefreshRecord) (Detail, error)
	EditSubscriptionAddress(context.Context, string, string, string, int64) (Source, error)
}
type groupAssigner interface {
	AssignSubscriptionGroup(context.Context, string, string, string) (Membership, error)
}

// BatchResult keeps per-source failures isolated so callers can retry only
// failed items. Err is intentionally kept out of JSON transport responses.
type BatchResult struct {
	ID     string
	Source *Source
	Detail *Detail
	Err    error
}
type Fetcher func(context.Context, string) (Snapshot, error)
type Service struct {
	repository     Repository
	fetch          Fetcher
	mu             sync.Mutex
	busy           map[string]bool
	updates        chan struct{}
	active         map[string]bool
	conditional    ConditionalFetcher
	rss            RSSFetcher
	paper          func(context.Context, string) (Snapshot, error)
	resolveChannel ChannelResolver
	resolveSource  SourceResolver
	now            func() time.Time
	ctx            context.Context
	cancel         context.CancelFunc
	closed         bool
	started        bool
	wg             sync.WaitGroup
}

func NewService(repository Repository, fetch Fetcher, options ...Option) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{repository: repository, fetch: fetch, busy: make(map[string]bool), active: make(map[string]bool), updates: make(chan struct{}, 2), now: time.Now, ctx: ctx, cancel: cancel}
	for _, option := range options {
		option(s)
	}
	return s
}
func (s *Service) acquire(id string) (func(), error) {
	if !validID(id) {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, context.Canceled
	}
	if s.busy[id] {
		return nil, ErrBusy
	}
	s.busy[id] = true
	s.wg.Add(1)
	return func() { s.mu.Lock(); delete(s.busy, id); delete(s.active, id); s.mu.Unlock(); s.wg.Done() }, nil
}
func (s *Service) List(ctx context.Context) ([]Source, error) {
	items, err := s.repository.ListSubscriptions(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range items {
		items[i].Active = s.active[items[i].ID]
		ApplyHealth(&items[i], s.now().Unix())
	}
	return items, err
}
func (s *Service) Get(ctx context.Context, id string) (Detail, error) {
	return s.get(ctx, id, false)
}

func (s *Service) GetCards(ctx context.Context, id string) (Detail, error) {
	return s.get(ctx, id, true)
}

func (s *Service) get(ctx context.Context, id string, cards bool) (Detail, error) {
	if !validID(id) {
		return Detail{}, ErrInvalid
	}
	get := s.repository.GetSubscription
	if cards {
		if repository, ok := s.repository.(interface {
			GetSubscriptionCards(context.Context, string) (Detail, error)
		}); ok {
			get = repository.GetSubscriptionCards
		}
	}
	detail, err := get(ctx, id)
	if err == nil && cards {
		for index := range detail.Items {
			detail.Items[index] = content.Card(detail.Items[index])
		}
	}
	s.mu.Lock()
	detail.Source.Active = s.active[id]
	s.mu.Unlock()
	ApplyHealth(&detail.Source, s.now().Unix())
	return detail, err
}

// Create is local only; duplicates keep their existing name and snapshot.
func (s *Service) Create(ctx context.Context, input Input) (Source, bool, error) {
	if len(input.Query) > 2048 {
		return Source{}, false, ErrInvalid
	}
	// Native YouTube Atom addresses are saved as channels with video identities.
	if input.Type == "rss" {
		if reference, err := discovery.ParseYouTubeChannel(input.Query); err == nil && reference.ID != "" && strings.Contains(input.Query, "/feeds/videos.xml?") {
			input.Type = "youtube"
			input.Query = reference.ID
		}
	}
	kind, uid, err := discovery.ParseQuery(input.Query)
	id := "bilibili:creator:" + uid
	defaultName := "UP 主 " + uid
	if input.Type == "rss" {
		uid, err = rssAddress(input.Query)
		if err != nil {
			return Source{}, false, ErrInvalid
		}
		id = "rss:feed:" + rssIdentity(uid)
		defaultName = "RSS 订阅"
	}
	if input.Type == "youtube" {
		reference, channelErr := discovery.ParseYouTubeChannel(input.Query)
		if channelErr != nil || reference.ID == "" {
			return Source{}, false, ErrChannelInput
		}
		uid = reference.ID
		id = "youtube:channel:" + uid
		defaultName = "YouTube 频道"
		err = nil
	}
	if input.Type == "arxiv" || input.Type == "huggingface" {
		value, queryErr := paperSourceQuery(input.Type, input.Query)
		err = queryErr
		if err != nil {
			return Source{}, false, ErrInvalid
		}
		uid = value
		id = input.Type + ":source:" + rssIdentity(input.Type+":"+uid)
		defaultName = "arXiv 分类 " + value
		if input.Type == "huggingface" {
			defaultName = "HF 每日论文"
		}
	}
	if input.Type != "rss" && input.Type != "youtube" && input.Type != "arxiv" && input.Type != "huggingface" && (err != nil || kind != "creator" || input.Type != "" && input.Type != "bilibili") {
		return Source{}, false, ErrInvalid
	}
	label := strings.TrimSpace(input.Name)
	if label == "" {
		label = defaultName
	}
	label, err = name(label)
	if err != nil {
		return Source{}, false, err
	}
	release, err := s.acquire(id)
	if err != nil {
		return Source{}, false, err
	}
	defer release()
	return s.repository.CreateSubscription(ctx, Source{ID: id, CreatorID: uid, Name: label, URL: SourceURL(id, uid), CreatedAt: s.now().Unix()})
}
func (s *Service) Rename(ctx context.Context, id string, edit Edit) (Source, error) {
	label, err := name(edit.Name)
	if err != nil {
		return Source{}, err
	}
	release, err := s.acquire(id)
	if err != nil {
		return Source{}, err
	}
	defer release()
	source, err := s.repository.RenameSubscription(ctx, id, label)
	ApplyHealth(&source, s.now().Unix())
	return source, err
}

type AddressEdit struct {
	URL         string `json:"url"`
	ExpectedURL string `json:"expectedUrl"`
}

func (s *Service) EditAddress(ctx context.Context, id string, edit AddressEdit) (Source, error) {
	if !rssID.MatchString(id) || s.rss == nil || len(edit.URL) > 2048 || len(edit.ExpectedURL) > 2048 {
		return Source{}, ErrInvalid
	}
	address, err := rssAddress(edit.URL)
	if err != nil {
		return Source{}, ErrInvalid
	}
	expected, err := netpolicy.URL(edit.ExpectedURL)
	if err != nil {
		return Source{}, ErrInvalid
	}
	release, err := s.acquire(id)
	if err != nil {
		return Source{}, err
	}
	defer release()
	source, err := s.repository.EditSubscriptionAddress(ctx, id, expected, address, s.now().Unix())
	ApplyHealth(&source, s.now().Unix())
	return source, err
}
func (s *Service) Delete(ctx context.Context, id string) error {
	release, err := s.acquire(id)
	if err != nil {
		return err
	}
	defer release()
	return s.repository.DeleteSubscription(ctx, id)
}

func batchIDs(ids []string) ([]string, error) {
	if len(ids) == 0 || len(ids) > 200 {
		return nil, ErrInvalid
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !validID(id) {
			return nil, ErrInvalid
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func (s *Service) BatchDelete(ctx context.Context, ids []string) ([]BatchResult, error) {
	ids, err := batchIDs(ids)
	if err != nil {
		return nil, err
	}
	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		err := s.Delete(ctx, id)
		results = append(results, BatchResult{ID: id, Err: err})
	}
	return results, nil
}

func (s *Service) BatchAssignGroup(ctx context.Context, ids []string, targetGroupID, expectedGroupID string) ([]BatchResult, error) {
	ids, err := batchIDs(ids)
	if err != nil || (targetGroupID != "" && !groupID.MatchString(targetGroupID)) || (expectedGroupID != "" && !groupID.MatchString(expectedGroupID)) {
		return nil, ErrInvalid
	}
	assigner, ok := s.repository.(groupAssigner)
	if !ok {
		return nil, ErrInvalid
	}
	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		release, acquireErr := s.acquire(id)
		if acquireErr != nil {
			results = append(results, BatchResult{ID: id, Err: acquireErr})
			continue
		}
		_, opErr := assigner.AssignSubscriptionGroup(ctx, id, targetGroupID, expectedGroupID)
		release()
		results = append(results, BatchResult{ID: id, Err: opErr})
	}
	return results, nil
}

func (s *Service) BatchConfigureRefresh(ctx context.Context, ids []string, policy RefreshPolicy) ([]BatchResult, error) {
	ids, err := batchIDs(ids)
	if err != nil {
		return nil, err
	}
	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		source, opErr := s.ConfigureRefresh(ctx, id, policy)
		result := BatchResult{ID: id, Err: opErr}
		if opErr == nil {
			result.Source = &source
		}
		results = append(results, result)
	}
	return results, nil
}

func (s *Service) BatchUpdate(ctx context.Context, ids []string) ([]BatchResult, error) {
	ids, err := batchIDs(ids)
	if err != nil {
		return nil, err
	}
	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		detail, opErr := s.Update(ctx, id)
		result := BatchResult{ID: id, Err: opErr}
		if opErr == nil {
			result.Detail = &detail
		}
		results = append(results, result)
	}
	return results, nil
}
func (s *Service) Update(ctx context.Context, id string) (Detail, error) {
	return s.update(ctx, id, nil)
}

// paperSourceQuery validates source-specific query values while keeping a
// stable, local creator key for the existing subscription repository.
func paperSourceQuery(source, query string) (string, error) {
	query = strings.TrimSpace(query)
	switch source {
	case "arxiv":
		return papersdomain.NormalizeCategory(query)
	case "huggingface":
		if query == "" || query == "today" {
			return "today", nil
		}
		if len(query) == 10 && query[4] == '-' && query[7] == '-' {
			if _, err := time.Parse("2006-01-02", query); err == nil {
				return query, nil
			}
		}
	}
	return "", ErrInvalid
}
func (s *Service) update(ctx context.Context, id string, dueAt *time.Time) (Detail, error) {
	release, err := s.acquire(id)
	if err != nil {
		return Detail{}, err
	}
	defer release()
	select {
	case s.updates <- struct{}{}:
		defer func() { <-s.updates }()
	default:
		return Detail{}, ErrBusy
	}
	s.mu.Lock()
	s.active[id] = true
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	stop := context.AfterFunc(s.ctx, cancel)
	defer func() { stop(); cancel() }()
	detail, err := s.repository.GetSubscription(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	if SupportsRefresh(id) {
		if dueAt != nil && (!detail.Source.Refresh.Enabled || detail.Source.Refresh.NextCheckAt > dueAt.Unix()) {
			return detail, nil
		}
		return s.updateFeed(ctx, detail)
	}
	snapshot, err := s.fetch(ctx, detail.Source.CreatorID)
	if err != nil {
		return Detail{}, err
	}
	snapshot, err = normalizeSnapshot(id, snapshot)
	if err != nil {
		return Detail{}, err
	}
	if err := ctx.Err(); err != nil {
		return Detail{}, err
	}
	return s.repository.UpdateSubscription(ctx, id, snapshot, s.now().Unix())
}
