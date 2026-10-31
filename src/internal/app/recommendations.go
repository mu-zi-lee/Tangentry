package app

import (
	"context"
	"strconv"
	"sync"
	"time"

	"tangentry/internal/discovery"
)

// recommender routes recommendation pages to each platform's native feed.
type recommender struct {
	platforms     *platforms
	subscriptions func(context.Context) (discovery.Feed, error)
	queue         *discovery.RecommendationQueue
	cache         *recommendationCache
	// override replaces every platform feed (not the local subscription gallery) in tests.
	override func(context.Context, string) (discovery.Feed, error)
}

const platformRecommendationCacheTTL = 10 * time.Minute

// Pagination must not retain every visited platform page for the full TTL.
const maxRecommendationCacheEntries = 16

type recommendationCacheEntry struct {
	feed      discovery.Feed
	expiresAt time.Time
	used      uint64
}

type recommendationCacheCall struct {
	done chan struct{}
	feed discovery.Feed
	err  error
}

// recommendationCache keeps WebView-backed recommendation pages warm for a
// short period. In-flight calls are shared so an entering discovery page and
// a batch continuation do not open two browser sessions for the same scope.
type recommendationCache struct {
	mu       sync.Mutex
	now      func() time.Time
	ttl      time.Duration
	entries  map[string]recommendationCacheEntry
	inflight map[string]*recommendationCacheCall
	sequence uint64
}

func newRecommendationCache() *recommendationCache {
	return &recommendationCache{
		now:      time.Now,
		ttl:      platformRecommendationCacheTTL,
		entries:  make(map[string]recommendationCacheEntry),
		inflight: make(map[string]*recommendationCacheCall),
	}
}

func (c *recommendationCache) key(source string, page int, account, variant string) string {
	return source + "\x00" + account + "\x00" + strconv.Itoa(page) + "\x00" + variant
}

func (c *recommendationCache) get(key string) (discovery.Feed, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.getLocked(key)
}

func (c *recommendationCache) getLocked(key string) (discovery.Feed, bool) {
	entry, ok := c.entries[key]
	if !ok {
		return discovery.Feed{}, false
	}
	if !c.now().Before(entry.expiresAt) {
		delete(c.entries, key)
		return discovery.Feed{}, false
	}
	c.sequence++
	entry.used = c.sequence
	c.entries[key] = entry
	return entry.feed, true
}

func (c *recommendationCache) load(ctx context.Context, key string, fetch func(context.Context) (discovery.Feed, error)) (discovery.Feed, error) {
	if feed, ok := c.get(key); ok {
		return feed, nil
	}
	c.mu.Lock()
	if feed, ok := c.getLocked(key); ok {
		c.mu.Unlock()
		return feed, nil
	}
	if call := c.inflight[key]; call != nil {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.feed, call.err
		case <-ctx.Done():
			return discovery.Feed{}, ctx.Err()
		}
	}
	call := &recommendationCacheCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.mu.Unlock()

	feed, err := fetch(ctx)
	c.mu.Lock()
	call.feed, call.err = feed, err
	if err == nil {
		now := c.now()
		for cachedKey, entry := range c.entries {
			if !now.Before(entry.expiresAt) {
				delete(c.entries, cachedKey)
			}
		}
		for len(c.entries) >= maxRecommendationCacheEntries {
			var oldestKey string
			oldest := ^uint64(0)
			for cachedKey, entry := range c.entries {
				if entry.used < oldest {
					oldestKey, oldest = cachedKey, entry.used
				}
			}
			delete(c.entries, oldestKey)
		}
		c.sequence++
		c.entries[key] = recommendationCacheEntry{feed: feed, expiresAt: now.Add(c.ttl), used: c.sequence}
	}
	delete(c.inflight, key)
	close(call.done)
	c.mu.Unlock()
	return feed, err
}

// Fetch adapts the page-oriented recommendation sources to the finite batch
// planner. The queue still owns account isolation and persistence.
func (r *recommender) Fetch(ctx context.Context, source string, page int) (discovery.Feed, error) {
	return r.Page(ctx, source, page)
}

// Page serves the subscription gallery directly; platform pages pass through the
// persistent recommendation queue so fetched items survive reloads.
func (r *recommender) Page(ctx context.Context, source string, page int) (discovery.Feed, error) {
	if source == "subscriptions" {
		return r.subscriptions(ctx)
	}
	if r.cache == nil {
		return r.queue.Fetch(ctx, source, func(ctx context.Context) (discovery.Feed, error) {
			return r.platformPage(ctx, source, page)
		})
	}
	account := discovery.PersonalAccount
	if r.platforms != nil && r.platforms.network.cookies != nil {
		account = r.platforms.network.cookies.Fingerprint(source, "")
	}
	key := r.cache.key(source, page, account, discovery.RecommendationFilter(ctx))
	return r.cache.load(ctx, key, func(ctx context.Context) (discovery.Feed, error) {
		return r.queue.Fetch(ctx, source, func(ctx context.Context) (discovery.Feed, error) {
			return r.platformPage(ctx, source, page)
		})
	})
}

func (r *recommender) platformPage(ctx context.Context, source string, page int) (discovery.Feed, error) {
	if r.override != nil {
		return r.override(ctx, source)
	}
	p := r.platforms
	switch source {
	case "bilibili":
		return p.discovery.bilibili.Recommendations(ctx, page)
	case "youtube":
		return p.network.toolkit.YouTubeRecommendationPage(ctx, page)
	case "douyin":
		return p.discovery.douyin.Recommendations(ctx, page)
	case "huggingface":
		return p.network.papers.Daily(ctx, time.Now())
	case "xiaoyuzhou":
		return p.discovery.podcasts.Recommendations(ctx, page, p.podcastToken())
	case "linuxdo":
		if filter := discovery.RecommendationFilter(ctx); filter != "" {
			return p.discovery.forum.Feed(ctx, filter, page)
		}
		return p.discovery.forum.Feed(ctx, "top", page)
	case "xiaohongshu":
		// The home feed has no continuation API yet; every page reads the first one.
		return p.discovery.notes.Recommendations(ctx)
	default:
		return discovery.Feed{}, discovery.ErrInvalidQuery
	}
}
