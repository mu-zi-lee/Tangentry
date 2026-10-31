package httptransport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
	"testing"
)

func TestInboxCardProjectionBoundsPayloadAndPreservesFullLocalContent(t *testing.T) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "cards.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	var items []content.Item
	updates := 0
	service := subscriptions.NewService(store, nil, subscriptions.WithRSSFeeds(func(context.Context, subscriptions.Source, subscriptions.Validators) (subscriptions.ConditionalResult, error) {
		updates++
		return subscriptions.ConditionalResult{Snapshot: subscriptions.Snapshot{Items: items, Total: len(items)}}, nil
	}))
	defer service.Close()
	source, _, err := service.Create(ctx, subscriptions.Input{Type: "rss", Query: "https://example.com/cards"})
	if err != nil {
		t.Fatal(err)
	}
	items = make([]content.Item, 12)
	for index := range items {
		hash := fmt.Sprintf("%064x", index+1)
		items[index] = content.Item{ID: "rss:" + hash, Platform: "rss", PlatformID: hash, Kind: "article", Title: fmt.Sprintf("Long article %d", index), URL: fmt.Sprintf("https://example.com/article/%d", index), Description: strings.Repeat("文🙂a", 10_000), ArticleBlocks: []content.ArticleBlock{{Kind: "paragraph", Text: strings.Repeat("Full local article.", 1_000)}}}
	}
	if _, err = store.UpdateSubscription(ctx, source.ID, subscriptions.Snapshot{Items: items, Total: len(items)}, 10); err != nil {
		t.Fatal(err)
	}
	views := subscriptions.NewSavedViewService(store)
	h := New(content.NewService(store), nil, nil, Options{Subscriptions: service, SubscriptionInbox: subscriptions.NewInboxService(store), SavedViews: views})
	read := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1"+path, nil))
		return w
	}
	full := read("/api/subscription-inbox?limit=10")
	cards := read("/api/subscription-inbox?limit=10&cards=true")
	var original, projected struct {
		Page  subscriptions.InboxPage `json:"page"`
		Count int                     `json:"count"`
	}
	if full.Code != 200 || cards.Code != 200 || json.Unmarshal(full.Body.Bytes(), &original) != nil || json.Unmarshal(cards.Body.Bytes(), &projected) != nil {
		t.Fatal("inbox projection response failed", full.Code, cards.Code)
	}
	if projected.Count != 12 || len(projected.Page.Entries) != 10 || projected.Page.NextCursor != original.Page.NextCursor || len(projected.Page.Sources) != 1 {
		t.Fatal("card mode changed pagination or source metadata")
	}
	for index, entry := range projected.Page.Entries {
		if !entry.Item.Partial || len(entry.Item.ArticleBlocks) != 0 || len([]rune(entry.Item.Description)) != content.CardDescriptionRunes || len(original.Page.Entries[index].Item.ArticleBlocks) != 1 || original.Page.Entries[index].Item.Partial {
			t.Fatal("card mode lost the full/partial boundary")
		}
	}
	if cards.Body.Len() >= full.Body.Len()/10 {
		t.Fatal("list still transfers full article payloads", cards.Body.Len(), full.Body.Len())
	}
	t.Logf("ten long articles: full=%d bytes cards=%d bytes", full.Body.Len(), cards.Body.Len())
	local := read("/api/subscription-inbox/" + items[0].ID)
	var restored content.Item
	if local.Code != 200 || json.Unmarshal(local.Body.Bytes(), &restored) != nil || restored.Partial || restored.Description != items[0].Description || len(restored.ArticleBlocks) != 1 || restored.ArticleBlocks[0].Text != items[0].ArticleBlocks[0].Text {
		t.Fatal("projecting the list changed the full local item")
	}
	saved := read("/api/saved-views/builtin-unread/inbox?limit=10&cards=true")
	if saved.Code != 200 || json.Unmarshal(saved.Body.Bytes(), &projected) != nil || len(projected.Page.Entries) != 10 || !projected.Page.Entries[0].Item.Partial || len(projected.Page.Entries[0].Item.ArticleBlocks) != 0 {
		t.Fatal("saved view did not project cards", saved.Code, saved.Body.String())
	}
	for _, path := range []string{"/api/subscription-inbox?cards=false", "/api/subscription-inbox?cards=true&cards=true", "/api/saved-views/builtin-unread/inbox?cards=invalid"} {
		if response := read(path); response.Code != 400 {
			t.Fatal("invalid card mode accepted", path, response.Code)
		}
	}
	path := "/api/subscriptions/" + source.ID
	fullDetail := read(path)
	cardDetail := read(path + "?cards=true")
	var fullSource, cardSource subscriptions.Detail
	if fullDetail.Code != 200 || cardDetail.Code != 200 || json.Unmarshal(fullDetail.Body.Bytes(), &fullSource) != nil || json.Unmarshal(cardDetail.Body.Bytes(), &cardSource) != nil || !reflect.DeepEqual(fullSource.Source, cardSource.Source) || len(cardSource.Items) != len(items) {
		t.Fatal("single-source card contract")
	}
	for index, item := range fullSource.Items {
		if !reflect.DeepEqual(content.Card(item), cardSource.Items[index]) {
			t.Fatal("single-source card differs from full projection", index)
		}
	}
	if cardDetail.Body.Len() >= fullDetail.Body.Len()/10 {
		t.Fatal("source detail still transfers article bodies")
	}
	for _, query := range []string{"?cards=false", "?cards=true&cards=true", "?cards=true&unknown=value"} {
		if response := read(path + query); response.Code != 400 {
			t.Fatal("invalid source card mode accepted", query)
		}
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest("POST", "http://127.0.0.1"+path+"/update"+query, nil))
		if response.Code != 400 || updates != 0 {
			t.Fatal("invalid card mode triggered a source refresh", response.Code, updates)
		}
	}
	updated := httptest.NewRecorder()
	h.ServeHTTP(updated, httptest.NewRequest("POST", "http://127.0.0.1"+path+"/update?cards=true", nil))
	if updated.Code != 200 || updates != 1 || json.Unmarshal(updated.Body.Bytes(), &cardSource) != nil || len(cardSource.Items) != len(items) || !cardSource.Items[0].Partial || len(cardSource.Items[0].ArticleBlocks) != 0 {
		t.Fatal("refresh did not return cards", updated.Code, updated.Body.String())
	}
	if response := read(path); response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &fullSource) != nil || !reflect.DeepEqual(fullSource.Items, items) {
		t.Fatal("card refresh persisted partial content")
	}
}

func TestSubscriptionInboxHTTPReadOnlyContractAndBoundaries(t *testing.T) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "inbox.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	source, _, err := subscriptions.NewService(store, nil).Create(context.Background(), subscriptions.Input{Type: "rss", Query: "https://example.com/feed"})
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	item := content.Item{ID: "rss:" + hash, Platform: "rss", PlatformID: hash, Kind: "audio", Title: "Podcast", URL: "https://example.com/episode", MediaURL: "https://example.com/audio.mp3"}
	if _, err = store.UpdateSubscription(context.Background(), source.ID, subscriptions.Snapshot{Items: []content.Item{item}, Total: 1}, 10); err != nil {
		t.Fatal(err)
	}
	h := New(content.NewService(store), nil, nil, Options{SubscriptionInbox: subscriptions.NewInboxService(store)})
	send := func(path, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1"+path, nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := send("/api/subscription-inbox?kind=audio&read=unread", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var response struct {
		Page  subscriptions.InboxPage `json:"page"`
		Count int                     `json:"count"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil || len(response.Page.Entries) != 1 || len(response.Page.Sources) != 1 || response.Count != 1 {
		t.Fatal(response, err)
	}
	if w = send("/api/subscription-inbox/"+item.ID, ""); w.Code != 200 || !strings.Contains(w.Body.String(), "audio.mp3") {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, path := range []string{"?q=a&q=b", "?kind=unknown", "?cursor=invalid", "?sourceId=nope", "?foo=secret"} {
		if w = send("/api/subscription-inbox"+path, ""); w.Code != 400 || strings.Contains(w.Body.String(), "secret") {
			t.Fatal(path, w.Code)
		}
	}
	if w = send("/api/subscription-inbox", "https://evil.example"); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w = send("/api/subscription-inbox/rss:"+strings.Repeat("b", 64), ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if states, err := store.ListReadStates(context.Background(), []string{item.ID}); err != nil || len(states) != 1 || states[0].Read || states[0].UpdatedAt != 0 {
		t.Fatal("GET marked read", states, err)
	}
	if library, err := store.List(context.Background()); err != nil || len(library) != 0 {
		t.Fatal("GET bookmarked", err)
	}
	unavailable := New(content.NewService(store), nil, nil)
	r := httptest.NewRequest("GET", "http://127.0.0.1/api/subscription-inbox", nil)
	w = httptest.NewRecorder()
	unavailable.ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
