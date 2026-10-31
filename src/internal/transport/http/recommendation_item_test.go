package httptransport

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
)

func TestRecommendationDetailReadsOpenedItemWithoutNetworkAndIsolatesAccounts(t *testing.T) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "detail.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	scope := discovery.QueueScope{Platform: "bilibili", Account: discovery.PersonalAccount}
	item := testItem
	item.ArticleBlocks = []content.ArticleBlock{{Kind: "paragraph", Text: "完整本地正文"}}
	if err := store.EnqueueRecommendations(context.Background(), scope, []content.Item{item}, 100); err != nil {
		t.Fatal(err)
	}
	queue := discovery.NewRecommendationQueue(store, func(source string) discovery.QueueScope {
		return discovery.QueueScope{Platform: source, Account: scope.Account}
	})
	if err := queue.Mark(context.Background(), "bilibili", item.ID, true); err != nil {
		t.Fatal(err)
	}
	handler := New(content.NewService(store), discovery.NewService(testProvider{}), fstest.MapFS{}, Options{RecommendationQueue: queue})
	read := func(source, id string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/recommendations/"+source+"/items/"+id, nil))
		return w
	}
	if response := read("bilibili", item.ID); response.Code != 200 || !strings.Contains(response.Body.String(), "完整本地正文") {
		t.Fatal("opened detail missing", response.Code, response.Body.String())
	}
	if response := read("youtube", item.ID); response.Code != 400 {
		t.Fatal("cross-platform detail allowed", response.Code)
	}
	scope.Account = strings.Repeat("a", 64)
	if response := read("bilibili", item.ID); response.Code != 404 {
		t.Fatal("cross-account detail allowed", response.Code)
	}
}
