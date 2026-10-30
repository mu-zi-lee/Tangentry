package xiaohongshu

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func recommendationPage() string {
	payload, _ := json.Marshal(map[string]any{"feed": map[string]any{"feeds": []any{map[string]any{
		"id": noteID, "xsecToken": "fixture-token",
		"noteCard": map[string]any{
			"type": "video", "displayTitle": "推荐测试视频",
			"user":  map[string]string{"nickname": "测试作者", "userId": "author", "avatar": "https://sns-avatar-qc.xhscdn.com/avatar"},
			"cover": map[string]string{"urlDefault": "https://sns-webpic-qc.xhscdn.com/cover"},
		},
	}}}})
	return `<html><script src="/app.js"></script><script>window.__SSR__=true</script><script>window.__INITIAL_STATE__=` + string(payload) + `;</script></html>`
}

func TestRecommendationsReadConsecutiveScriptsAndPreserveAuthor(t *testing.T) {
	c := &Client{Cookie: func(string) string { return "session=fixture" }, HTTP: &http.Client{Transport: roundTrip(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Cookie") != "session=fixture" || req.URL.Hostname() != "www.xiaohongshu.com" {
			t.Fatal("credential scope")
		}
		return response(req, 200, recommendationPage(), nil), nil
	})}}
	feed, err := c.Recommendations(context.Background())
	if err != nil || len(feed.Items) != 1 {
		t.Fatal(feed, err)
	}
	item := feed.Items[0]
	if item.Author != "测试作者" || item.AuthorAvatarURL != "https://sns-avatar-qc.xhscdn.com/avatar" || item.Kind != "video" || !strings.Contains(c.VideoLocator(noteID), "xsec_token=fixture-token") {
		t.Fatal(item)
	}
}

func TestRecommendationFailuresDistinguishRateAndLogin(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		want   string
	}{
		{429, "", "限制推荐请求"},
		{403, "", "登录凭据"},
		{200, "<html>verification</html>", "页面没有推荐数据"},
	} {
		c := &Client{Cookie: func(string) string { return "session=private-fixture" }, HTTP: &http.Client{Transport: roundTrip(func(req *http.Request) (*http.Response, error) {
			return response(req, tc.status, tc.body, nil), nil
		})}}
		_, err := c.Recommendations(context.Background())
		if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "private-fixture") {
			t.Fatal(tc.status, err)
		}
	}
}

func TestRecommendationPublicationTime(t *testing.T) {
	for _, tc := range []struct {
		field string
		want  int64
	}{
		{`"time":1791504000123`, 1791504000},
		{`"time":"1791504000123"`, 1791504000},
		{`"publishTime":1791504000`, 1791504000},
		{`"time":null`, 0},
		{`"time":"unavailable"`, 0},
		{`"time":-1`, 0},
	} {
		page := strings.Replace(recommendationPage(), `"noteCard":{`, `"noteCard":{`+tc.field+`,`, 1)
		feed, err := ParseRecommendations([]byte(page))
		if err != nil || len(feed.Items) != 1 || feed.Items[0].PublishedAt != tc.want {
			t.Fatal(tc.field, feed, err)
		}
	}
}

func TestRecommendationPreservesActualCoverDimensions(t *testing.T) {
	for _, tc := range []struct {
		dimensions    string
		width, height int
	}{
		{`"width":900,"height":1200,`, 900, 1200},
		{`"width":1200,"height":800,`, 1200, 800},
		{`"width":0,"height":1200,`, 0, 0},
	} {
		page := strings.Replace(recommendationPage(), `"cover":{`, `"cover":{`+tc.dimensions, 1)
		feed, err := ParseRecommendations([]byte(page))
		if err != nil || len(feed.Items) != 1 {
			t.Fatal(feed, err)
		}
		item := feed.Items[0]
		if item.ThumbnailWidth != tc.width || item.ThumbnailHeight != tc.height {
			t.Fatalf("cover dimensions = %dx%d, want %dx%d", item.ThumbnailWidth, item.ThumbnailHeight, tc.width, tc.height)
		}
	}
}
