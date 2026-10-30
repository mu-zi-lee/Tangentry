package httptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/downloads"
	"tangentry/internal/playback"
	"testing"
	"time"
)

type failingPlaybackBody struct {
	read bool
}

func (b *failingPlaybackBody) Read(p []byte) (int, error) {
	if b.read {
		return 0, errors.New("fixture stream failure")
	}
	b.read = true
	copy(p, "data")
	return 4, errors.New("fixture stream failure")
}

func (b *failingPlaybackBody) Close() error { return nil }

func TestPlaybackRoutesKeepPlatformIdentifiersSeparate(t *testing.T) {
	var resolves int
	service := playback.New(func(context.Context, string) (playback.Source, error) {
		resolves++
		return playback.Source{URL: "https://media.bilivideo.com/fixture.mp4"}, nil
	}, &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"video/mp4"}}, Body: io.NopCloser(strings.NewReader("fixture"))}, nil
	})})
	h := New(nil, nil, nil, Options{Playback: service})
	for _, path := range []string{"/api/playback/bilibili/7340916925458779430", "/api/playback/douyin/BV17x411w7KC"} {
		request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1"+path, nil)
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s returned %d: %s", path, response.Code, response.Body.String())
		}
	}
	if resolves != 0 {
		t.Fatalf("invalid platform identifiers reached resolver %d times", resolves)
	}
}

func TestDouyinPlaybackErrorCarriesSanitizedDiagnosticDetails(t *testing.T) {
	service := playback.New(func(ctx context.Context, _ string) (playback.Source, error) {
		trace := playback.DiagnosticsFromContext(ctx)
		status := http.StatusForbidden
		page := "https://www.douyin.com/video/abcdefghijklmnopqrstuvwxyzABCDEF/detail?msToken=fixture-secret"
		contentType := "application/json; charset=utf-8"
		trace.Add(playback.DiagnosticStage{Stage: "webview_detail_fetch", Outcome: playback.OutcomeHTTPError, HTTPStatus: &status, ContentType: &contentType, PageURL: &page, IsDouyinContext: playback.IsDouyinContext(&page)})
		return playback.Source{}, playback.WrapDiagnostic(errors.New("fixture failure"), trace, playback.DiagnosticSummary(trace.Snapshot().Stages))
	}, &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) { t.Fatal("unexpected media request"); return nil, nil })})
	h := New(nil, nil, nil, Options{Playback: service})
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/playback/douyin/6961737553342991651", nil)
	r.Header.Set("Origin", "http://127.0.0.1")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "抖音视频解析失败：应用内页面详情接口返回 HTTP 403") || !strings.Contains(w.Body.String(), `"details"`) {
		t.Fatalf("diagnostic response: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "msToken") || strings.Contains(w.Body.String(), "fixture-secret") || strings.Contains(w.Body.String(), "abcdefghijklmnopqrstuvwxyzABCDEF") || strings.Contains(w.Body.String(), "?") {
		t.Fatalf("unsafe diagnostic escaped: %s", w.Body.String())
	}
	for _, value := range []string{`"frontend_request"`, `"api_code":"playback_unavailable"`, `"is_douyin_context":true`} {
		if !strings.Contains(w.Body.String(), value) {
			t.Fatalf("missing diagnostic field %s in %s", value, w.Body.String())
		}
	}
	if !strings.Contains(w.Body.String(), "www.douyin.com/video/<redacted>/detail") && !strings.Contains(w.Body.String(), `www.douyin.com/video/\u003credacted\u003e/detail`) {
		t.Fatalf("redacted diagnostic path missing: %s", w.Body.String())
	}
}

func TestDouyinSessionDiagnosticsExposePostReadyMediaFailure(t *testing.T) {
	service := playback.New(func(ctx context.Context, _ string) (playback.Source, error) {
		trace := playback.DiagnosticsFromContext(ctx)
		page := "www.douyin.com/video/abcdefghijklmnopqrstuvwxyzABCDEF/detail"
		trace.Add(playback.DiagnosticStage{Stage: "webview_page_load", Outcome: playback.OutcomeOK, PageURL: &page})
		return playback.Source{
			URL:      "https://v3.douyinvod.com/video/segment/abcdefghijklmnopqrstuvwxyzABCDEF/signed.mp4",
			Platform: "douyin",
		}, nil
	}, &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"video/mp4"}, "Content-Length": {"4"}}, Body: &failingPlaybackBody{}}, nil
	})})
	h := New(nil, nil, nil, Options{Playback: service})
	request := func(method, path string, body io.Reader) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1"+path, body)
		r.Header.Set("Origin", "http://127.0.0.1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	opened := request(http.MethodPost, "/api/playback/douyin/7340916925458779430", nil)
	if opened.Code != http.StatusOK {
		t.Fatalf("open status: %d %s", opened.Code, opened.Body.String())
	}
	var session playback.Session
	if err := json.Unmarshal(opened.Body.Bytes(), &session); err != nil || session.ID == "" {
		t.Fatalf("open response: %v %s", err, opened.Body.String())
	}
	readyPath := "/api/playback/sessions/" + session.ID + "/diagnostics"
	ready := request(http.MethodPost, readyPath, strings.NewReader(`{"ready":true}`))
	if ready.Code != http.StatusOK || strings.Contains(ready.Body.String(), `"final_outcome":"ok"`) {
		t.Fatalf("ready prematurely closed diagnostics: %d %s", ready.Code, ready.Body.String())
	}
	media := request(http.MethodGet, "/api/playback/sessions/"+session.ID+"/media", nil)
	if media.Code != http.StatusOK {
		t.Fatalf("media status: %d %s", media.Code, media.Body.String())
	}
	diagnostics := request(http.MethodPost, readyPath, strings.NewReader(`{}`))
	body := diagnostics.Body.String()
	if diagnostics.Code != http.StatusOK || !strings.Contains(body, `"final_outcome":"exception"`) || !strings.Contains(body, `"stage":"session_media_fetch"`) {
		t.Fatalf("post-ready failure diagnostics: %d %s", diagnostics.Code, body)
	}
	if !strings.Contains(body, "v3.douyinvod.com/video/segment") || strings.Contains(body, "abcdefghijklmnopqrstuvwxyzABCDEF") {
		t.Fatalf("diagnostics leaked or omitted sanitized path: %s", body)
	}
}

type inactiveMediaRunner struct{}

type delayedMediaWriter struct{ http.ResponseWriter }

func (w delayedMediaWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w delayedMediaWriter) Write(data []byte) (int, error) {
	time.Sleep(40 * time.Millisecond)
	return w.ResponseWriter.Write(data)
}

func (inactiveMediaRunner) Ready() bool { return false }
func (inactiveMediaRunner) Download(context.Context, string, string, int) (string, error) {
	return "", errors.New("media route must not start a downloader")
}

func TestMediaUsesCompletedFileBoundaryAndHTTPRanges(t *testing.T) {
	root := t.TempDir()
	store, err := sqlite.Open(filepath.Join(root, "media.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service, err := downloads.NewService(store, inactiveMediaRunner{}, filepath.Join(root, "media"), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	ctx := context.Background()
	job := downloads.Job{ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", URL: "https://www.bilibili.com/video/BV17x411w7KC/", Title: "range fixture", State: "completed", FileName: "video.mp4", CreatedAt: 1}
	data := []byte("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ explicit byte-range test, not codec proof")
	directory := filepath.Join(root, "media", job.ID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, job.FileName), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveDownload(ctx, job); err != nil {
		t.Fatal(err)
	}
	h := New(nil, nil, nil, Options{Downloads: service})
	send := func(method, suffix, rang string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1/api/downloads/"+job.ID+suffix, nil)
		if rang != "" {
			r.Header.Set("Range", rang)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := send("GET", "/media", "")
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) || w.Header().Get("Content-Type") != "video/mp4" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "inline;") || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("media contract: %d %v", w.Code, w.Header())
	}
	w = send("GET", "/media", "bytes=4-13")
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), data[4:14]) || !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes 4-13/") {
		t.Fatal("seek range invalid")
	}
	// A real HTTP server proves file streaming can outlive its short API deadline.
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { h.ServeHTTP(delayedMediaWriter{w}, r) }))
	server.Config.WriteTimeout = 5 * time.Millisecond
	server.Start()
	response, err := server.Client().Get(server.URL + "/api/downloads/" + job.ID + "/media")
	if err != nil {
		server.Close()
		t.Fatal("API deadline interrupted media", err)
	}
	streamed, err := io.ReadAll(response.Body)
	response.Body.Close()
	server.Close()
	if err != nil || !bytes.Equal(streamed, data) {
		t.Fatal("media did not finish beyond API deadline")
	}
	w = send("HEAD", "/media", "")
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD served body or lost metadata")
	}
	if w := send("GET", "/media", "bytes=99999-"); w.Code != 416 {
		t.Fatal("unsatisfiable range not reported")
	}
	if w := send("GET", "/file", ""); w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("file download behavior changed")
	}
	for _, host := range []string{"evil.test", "127.0.0.1"} {
		r := httptest.NewRequest("GET", "http://"+host+"/api/downloads/"+job.ID+"/media", nil)
		if host == "127.0.0.1" {
			r.Header.Set("Origin", "https://evil.test")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("media escaped local access guard")
		}
	}
	job.State = "queued"
	store.SaveDownload(ctx, job)
	if w := send("GET", "/media", ""); w.Code != 404 {
		t.Fatal("unfinished file was streamed")
	}
	job.State = "completed"
	job.FileName = "preview.html"
	store.SaveDownload(ctx, job)
	os.WriteFile(filepath.Join(directory, job.FileName), []byte("<script>not media</script>"), 0600)
	if w := send("GET", "/media", ""); w.Code != 404 {
		t.Fatal("HTML streamed inline")
	}
	job.FileName = "video.mp4"
	store.SaveDownload(ctx, job)
	os.Remove(filepath.Join(directory, job.FileName))
	if w := send("GET", "/media", ""); w.Code != 404 {
		t.Fatal("missing file reported playable")
	}
}

func TestAudioProxyPreservesNativeMediaRangeContract(t *testing.T) {
	const payload = "0123456789 podcast audio fixture"
	transport := roundTripperFunc(func(r *http.Request) (*http.Response, error) {
		headers := http.Header{"Content-Type": {"audio/mp4"}, "Accept-Ranges": {"bytes"}}
		body := payload
		status := http.StatusOK
		if r.Header.Get("Range") == "bytes=4-9" {
			headers.Set("Content-Range", "bytes 4-9/"+strconv.Itoa(len(payload)))
			headers.Set("Content-Length", "6")
			body = payload[4:10]
			status = http.StatusPartialContent
		} else {
			headers.Set("Content-Length", strconv.Itoa(len(payload)))
		}
		return &http.Response{StatusCode: status, Header: headers, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})
	h := New(nil, nil, nil, Options{AudioHTTP: &http.Client{Transport: transport}})
	request := func(rang string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/media/audio?url="+url.QueryEscape("https://media.example/episode.m4a"), nil)
		r.Header.Set("Origin", "http://127.0.0.1")
		if rang != "" {
			r.Header.Set("Range", rang)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	full := request("")
	if full.Code != http.StatusOK || full.Body.String() != payload || full.Header().Get("Content-Type") != "audio/mp4" || full.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("full audio response: %d %v %q", full.Code, full.Header(), full.Body.String())
	}
	rangeResponse := request("bytes=4-9")
	if rangeResponse.Code != http.StatusPartialContent || rangeResponse.Body.String() != payload[4:10] || rangeResponse.Header().Get("Content-Range") != "bytes 4-9/"+strconv.Itoa(len(payload)) {
		t.Fatalf("range audio response: %d %v %q", rangeResponse.Code, rangeResponse.Header(), rangeResponse.Body.String())
	}
}

func TestNestedDownloadArtifactRouteServesFilesUnderSeason(t *testing.T) {
	root := t.TempDir()
	store, err := sqlite.Open(filepath.Join(root, "nested-artifact.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service, err := downloads.NewService(store, inactiveMediaRunner{}, filepath.Join(root, "media"), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	job := downloads.Job{
		ID: "nested-artifact", URL: "https://www.bilibili.com/video/BV17x411w7KC/",
		State: "completed", FileName: "Season 1/Video - S01E01.mp4",
		Files: []string{"Season 1/Video - S01E01.mp4", "Season 1/Video - S01E01.zh-Hans.srt"},
	}
	if err := store.SaveDownload(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "media", job.ID, "Season 1")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	const subtitle = "1\n00:00:00,000 --> 00:00:01,000\n测试字幕\n"
	if err := os.WriteFile(filepath.Join(directory, "Video - S01E01.zh-Hans.srt"), []byte(subtitle), 0600); err != nil {
		t.Fatal(err)
	}
	h := New(nil, nil, nil, Options{Downloads: service})
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/downloads/"+job.ID+"/files/Season%201%2FVideo%20-%20S01E01.zh-Hans.srt", nil)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != subtitle {
		t.Fatalf("nested artifact response: %d %q", response.Code, response.Body.String())
	}
}

func TestDownloadHistoryDeleteHTTPContract(t *testing.T) {
	root := t.TempDir()
	store, err := sqlite.Open(filepath.Join(root, "delete-http.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service, err := downloads.NewService(store, inactiveMediaRunner{}, filepath.Join(root, "media"), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	ctx := context.Background()
	job := downloads.Job{ID: "http-delete-job", URL: "https://www.bilibili.com/video/BV17x411w7KC/", State: "completed", FileName: "video.mp4", CreatedAt: 1}
	if err := store.SaveDownload(ctx, job); err != nil {
		t.Fatal(err)
	}
	h := New(nil, nil, nil, Options{Downloads: service})
	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/downloads/"+job.ID, strings.NewReader(`{"deleteFiles":false}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status: %d %s", response.Code, response.Body.String())
	}
	if _, err := store.GetDownload(ctx, job.ID); !errors.Is(err, downloads.ErrNotFound) {
		t.Fatalf("download record retained: %v", err)
	}
	active := downloads.Job{ID: "http-active-job", URL: "https://www.bilibili.com/video/BV1xx411c7mD", State: "running", FileName: "video.mp4", CreatedAt: 2}
	if err := store.SaveDownload(ctx, active); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/downloads/"+active.ID, strings.NewReader(`{"deleteFiles":false}`))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "先取消") {
		t.Fatalf("active delete contract: %d %s", response.Code, response.Body.String())
	}
}
