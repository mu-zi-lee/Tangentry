package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

type fakePageText struct {
	page  retrieval.Page
	total int
	err   error
	gotID string
}

func (f *fakePageText) PageText(ctx context.Context, contentID string, page int) (retrieval.Page, int, error) {
	f.gotID = contentID
	if f.err != nil {
		return retrieval.Page{}, 0, f.err
	}
	return f.page, f.total, nil
}

func TestPageTextGet(t *testing.T) {
	fake := &fakePageText{page: retrieval.Page{Number: 61, Text: "第二十五條 香港居民在法律面前一律平等。", Extractor: "local-paddleocr", ExtractorVersion: "paddleocr-3.7.0"}, total: 188}
	h := &libraryHandler{library: LibraryDependencies{PageText: fake}}

	w := httptest.NewRecorder()
	h.pageTextGet(w, httptest.NewRequest(http.MethodGet, "/api/library/pdf:abc/page-text?page=61", nil))
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Page             int    `json:"page"`
		Text             string `json:"text"`
		TotalPages       int    `json:"totalPages"`
		Extractor        string `json:"extractor"`
		ExtractorVersion string `json:"extractorVersion"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Page != 61 || !strings.Contains(body.Text, "一律平等") || body.TotalPages != 188 {
		t.Fatalf("body = %+v", body)
	}
	// OCR provenance must reach the client so the UI can label recognised text.
	if body.Extractor != "local-paddleocr" || body.ExtractorVersion != "paddleocr-3.7.0" {
		t.Fatalf("provenance lost: %+v", body)
	}
}

func TestPageTextGetGuards(t *testing.T) {
	fake := &fakePageText{page: retrieval.Page{Number: 1, Text: "x"}, total: 1}
	h := &libraryHandler{library: LibraryDependencies{PageText: fake}}

	cases := []struct {
		name, target string
		want         int
	}{
		{"missing page", "/api/library/pdf:abc/page-text", 400},
		{"zero page", "/api/library/pdf:abc/page-text?page=0", 400},
		{"negative page", "/api/library/pdf:abc/page-text?page=-3", 400},
		{"non numeric", "/api/library/pdf:abc/page-text?page=abc", 400},
		{"extra query", "/api/library/pdf:abc/page-text?page=1&x=1", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.pageTextGet(w, httptest.NewRequest(http.MethodGet, tc.target, nil))
			if w.Code != tc.want {
				t.Fatalf("%s = %d: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

func TestPageTextGetNotFound(t *testing.T) {
	h := &libraryHandler{library: LibraryDependencies{PageText: &fakePageText{err: errPageNotFoundForTest}}}
	w := httptest.NewRecorder()
	h.pageTextGet(w, httptest.NewRequest(http.MethodGet, "/api/library/pdf:abc/page-text?page=9", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestPageTextUnavailable(t *testing.T) {
	h := &libraryHandler{}
	w := httptest.NewRecorder()
	h.pageTextGet(w, httptest.NewRequest(http.MethodGet, "/api/library/pdf:abc/page-text?page=1", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestPageTextRouteRegistered(t *testing.T) {
	fake := &fakePageText{page: retrieval.Page{Number: 2, Text: "内容"}, total: 3}
	h := NewWithDependencies(Dependencies{Library: LibraryDependencies{PageText: fake}}, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/library/pdf:abc/page-text?page=2", nil))
	if w.Code == http.StatusNotFound || w.Code == http.StatusMethodNotAllowed {
		t.Fatalf("route missing: %d", w.Code)
	}
}

var errPageNotFoundForTest = &pageTextError{"missing"}

type pageTextError struct{ msg string }

func (e *pageTextError) Error() string { return e.msg }
