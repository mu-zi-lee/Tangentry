package app

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"tangentry/internal/content"
	"tangentry/internal/discovery"
)

func TestRecommendationCacheHitsAndExpires(t *testing.T) {
	now := time.Unix(100, 0)
	cache := newRecommendationCache()
	cache.now = func() time.Time { return now }
	cache.ttl = time.Minute
	item := content.Item{ID: "douyin:1234567890123456", Platform: "douyin", PlatformID: "1234567890123456", Kind: "video", Title: "精选"}
	calls := 0
	fetch := func(context.Context) (discovery.Feed, error) {
		calls++
		return discovery.Feed{Items: []content.Item{item}}, nil
	}
	key := cache.key("douyin", 1, "account-a", "")
	if _, err := cache.load(context.Background(), key, fetch); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.load(context.Background(), key, fetch); err != nil || calls != 1 {
		t.Fatalf("cache miss on fresh entry: calls=%d err=%v", calls, err)
	}
	now = now.Add(61 * time.Second)
	if _, err := cache.load(context.Background(), key, fetch); err != nil || calls != 2 {
		t.Fatalf("expired entry was not refreshed: calls=%d err=%v", calls, err)
	}
}

func TestRecommendationCacheSeparatesSourcePageAndAccount(t *testing.T) {
	cache := newRecommendationCache()
	calls := 0
	fetch := func(context.Context) (discovery.Feed, error) {
		calls++
		return discovery.Feed{}, nil
	}
	for _, key := range []string{
		cache.key("douyin", 1, "account-a", ""),
		cache.key("douyin", 2, "account-a", ""),
		cache.key("linuxdo", 1, "account-a", ""),
		cache.key("douyin", 1, "account-b", ""),
		cache.key("linuxdo", 1, "account-a", "top"),
	} {
		if _, err := cache.load(context.Background(), key, fetch); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 5 {
		t.Fatalf("cache keys were not isolated: calls=%d", calls)
	}
}

func TestRecommendationCacheSharesInflightFetch(t *testing.T) {
	cache := newRecommendationCache()
	key := cache.key("douyin", 1, "account-a", "")
	started := make(chan struct{})
	release := make(chan struct{})
	var calls int
	fetch := func(context.Context) (discovery.Feed, error) {
		calls++
		close(started)
		<-release
		return discovery.Feed{}, nil
	}
	first := make(chan error, 1)
	go func() {
		_, err := cache.load(context.Background(), key, fetch)
		first <- err
	}()
	<-started
	second := make(chan error, 1)
	go func() {
		_, err := cache.load(context.Background(), key, fetch)
		second <- err
	}()
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("in-flight fetch was duplicated: calls=%d", calls)
	}
}

func TestRecommendationCacheDoesNotStoreErrors(t *testing.T) {
	cache := newRecommendationCache()
	key := cache.key("douyin", 1, "account-a", "")
	want := errors.New("temporary")
	calls := 0
	fetch := func(context.Context) (discovery.Feed, error) {
		calls++
		return discovery.Feed{}, want
	}
	for i := 0; i < 2; i++ {
		if _, err := cache.load(context.Background(), key, fetch); !errors.Is(err, want) {
			t.Fatalf("error mismatch: %v", err)
		}
	}
	if calls != 2 {
		t.Fatalf("error was cached: calls=%d", calls)
	}
}

func TestRecommendationCacheBoundsPaginationAndKeepsRecentlyUsedPage(t *testing.T) {
	cache := newRecommendationCache()
	fetch := func(context.Context) (discovery.Feed, error) { return discovery.Feed{}, nil }
	for page := 0; page < maxRecommendationCacheEntries; page++ {
		if _, err := cache.load(context.Background(), strconv.Itoa(page), fetch); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := cache.get("0"); !ok {
		t.Fatal("first page not cached")
	}
	if _, err := cache.load(context.Background(), "next", fetch); err != nil {
		t.Fatal(err)
	}
	if len(cache.entries) != maxRecommendationCacheEntries {
		t.Fatalf("unbounded cache: %d entries", len(cache.entries))
	}
	if _, ok := cache.get("0"); !ok {
		t.Fatal("recently used page evicted")
	}
	if _, ok := cache.get("1"); ok {
		t.Fatal("least recently used page retained")
	}
}
