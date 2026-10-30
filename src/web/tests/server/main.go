// E2E-only application entry point. Real services, HTTP and SQLite; external
// platform responses are explicit fixtures. The production command never imports it.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"tangentry/internal/adapters/aichat"
	"tangentry/internal/ai"
	"tangentry/internal/app"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/favoritesync"
	"tangentry/internal/playback"
	"tangentry/internal/subtitles"
	"tangentry/internal/transcription"
	"tangentry/web"
	"time"
)

type fixturePlatform struct {
	mu    sync.Mutex
	calls map[string]int
}

func fixtureVideo(id string) content.Item {
	return content.Item{ID: "bilibili:" + id, Platform: "bilibili", PlatformID: id, Kind: "video", Title: "订阅测试样例：沿着好奇心继续发现", Author: "订阅测试创作者", AuthorID: "12345", URL: "https://www.bilibili.com/video/" + id + "/", Description: "明确标识的 E2E 平台夹具，正式应用不会加载。", DurationSeconds: 123, PublishedAt: 1720000000}
}
func (p *fixturePlatform) Video(ctx context.Context, id string) (content.Item, error) {
	return fixtureVideo(id), ctx.Err()
}
func (p *fixturePlatform) CreatorVideos(ctx context.Context, uid string, page int) (discovery.Feed, error) {
	p.mu.Lock()
	p.calls[uid]++
	count := p.calls[uid]
	p.mu.Unlock()
	if uid == "99999" {
		return discovery.Feed{}, &discovery.PlatformError{Message: "订阅测试平台限制，上次成功内容已保留。", Restricted: true}
	}
	items := []content.Item{fixtureVideo("BV17x411w7KC")}
	// Dedicated read-state fixture keeps its counters separate from subscription tests.
	if (uid == "12345" || uid == "24680") && count >= 2 {
		items = append(items, fixtureVideo("BV1Pyta66EDh"))
		items[0].Title = "订阅测试样例：更新后的标题"
	}
	if uid == "12345" && count == 3 {
		return discovery.Feed{}, &discovery.PlatformError{Message: "订阅测试平台限制，上次成功内容已保留。", Restricted: true}
	}
	if uid == "12345" && count >= 4 {
		items[0].Title = "订阅测试样例：外部更新后的标题"
	}
	if uid == "67890" {
		items[0].Title = "另一个来源的订阅测试样例"
	}
	return discovery.Feed{Items: items, Page: page, Total: 25, HasMore: true, SourceTitle: "订阅测试创作者", Query: uid}, ctx.Err()
}

type publicFixtureTransport struct {
	mu    sync.Mutex
	calls map[string]int
}

func (f *publicFixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	var body string
	headers := http.Header{"Content-Type": []string{"text/xml"}}
	switch r.URL.Hostname() {
	case "podcast-captions-fixture.example":
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			return nil, fmt.Errorf("public podcast captions must be anonymous")
		}
		if r.URL.Path == "/retry-captions.vtt" {
			f.mu.Lock()
			f.calls[r.URL.String()]++
			call := f.calls[r.URL.String()]
			f.mu.Unlock()
			if call == 1 {
				return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
			}
		}
		if r.URL.Path == "/captions.json" {
			f.mu.Lock()
			f.calls[r.URL.String()]++
			call := f.calls[r.URL.String()]
			f.mu.Unlock()
			if call > 1 {
				return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
			}
			headers.Set("Content-Type", "application/json")
			body = `{"version":"1.0.0","segments":[{"startTime":0.125,"endTime":1.25,"body":"公开字幕第一段"},{"startTime":2.125,"endTime":4.25,"body":"公开字幕第二段"}]}`
		} else if strings.HasSuffix(r.URL.Path, "captions.vtt") {
			headers.Set("Content-Type", "text/vtt")
			body = "WEBVTT\n\n00:00.125 --> 00:01.250\n公开字幕第一段\n\n00:02.125 --> 00:04.250\n公开字幕第二段\n"
		} else {
			body = `<?xml version="1.0"?><rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>公开字幕测试</title><link>https://podcast-captions-fixture.example</link><description>测试夹具</description><language>zh-CN</language><item><guid>timed-podcast</guid><title>公开字幕测试播客</title><link>https://podcast-captions-fixture.example/episode</link><description>公开文稿测试</description><enclosure url="https://rss-fixture.example/audio.mp3" type="audio/mpeg" length="1"/><podcast:transcript url="https://podcast-captions-fixture.example/captions.vtt" type="text/vtt"/></item></channel></rss>`
			if r.URL.Path == "/retry-feed.xml" {
				body = strings.ReplaceAll(body, "timed-podcast", "retry-podcast")
				body = strings.ReplaceAll(body, "公开字幕测试播客", "公开字幕重试播客")
				body = strings.ReplaceAll(body, "/captions.vtt", "/retry-captions.vtt")
			}
			if r.URL.Path == "/json-feed.xml" {
				body = strings.ReplaceAll(body, "timed-podcast", "json-podcast")
				body = strings.ReplaceAll(body, "公开字幕测试播客", "公开JSON字幕播客")
				body = strings.ReplaceAll(body, "/captions.vtt", "/captions.json")
				body = strings.ReplaceAll(body, `type="text/vtt"`, `type="application/json"`)
			}
			if r.URL.Path == "/alias-feed.xml" {
				body = strings.ReplaceAll(body, "timed-podcast", "alias-podcast")
				body = strings.ReplaceAll(body, "公开字幕测试播客", "公开别名字幕播客")
				body = strings.ReplaceAll(body, "xmlns:podcast", "xmlns:pi")
				body = strings.ReplaceAll(body, "podcast:transcript", "pi:transcript")
				body = strings.ReplaceAll(body, "https://podcastindex.org/namespace/1.0", "https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md")
			}
		}
	case "fixture.bilivideo.com":
		data, err := os.ReadFile("tests/fixtures/player.mp4")
		if err != nil {
			return nil, err
		}
		w := httptest.NewRecorder()
		http.ServeContent(w, r, "player.mp4", time.Time{}, bytes.NewReader(data))
		res := w.Result()
		res.Request = r
		return res, nil
	case "preview-feed-fixture.example":
		body = `<?xml version="1.0"?><rss version="2.0"><channel><title>摘要测试</title><link>https://preview-feed-fixture.example</link><description>摘要夹具</description><item><guid>summary</guid><title>RSS 摘要测试文章</title><link>https://preview-article-fixture.example/story</link><description><![CDATA[<a href="https://preview-feed-fixture.example/comments">Comments</a>]]></description></item></channel></rss>`
	case "preview-article-fixture.example":
		headers.Set("Content-Type", "text/html; charset=utf-8")
		body = `<html><head><title>RSS 摘要测试文章</title></head><body><nav>无关导航</nav><article><h1>RSS 摘要测试文章</h1><p>` + strings.Repeat("这是原站文章的真实正文，卡片摘要应该来自这些内容，而不是评论链接。", 30) + `</p></article></body></html>`
	case "fulltext-fixture.example":
		if r.Header.Get("Cookie") != "" {
			return nil, fmt.Errorf("original article must be anonymous")
		}
		f.mu.Lock()
		f.calls[r.URL.String()]++
		call := f.calls[r.URL.String()]
		f.mu.Unlock()
		headers.Set("Content-Type", "text/html; charset=utf-8")
		beginning := "阅读从好奇开始😀"
		if call >= 2 {
			beginning = "新增的一段介绍，正文的想法继续保留。"
		}
		body = `<html><head><title>给好奇心留一页空白</title></head><body><nav>无关平台导航</nav><article><h1>给好奇心留一页空白</h1><p>` + beginning + `</p><p>` + strings.Repeat("沿着好奇心继续阅读，慢慢建立自己的理解。", 35) + `</p><h2>让思考留下痕迹</h2><p>第二段😀在这里，阅读原文的同时写下自己的想法，引用与 Markdown 编辑一起保存。</p><blockquote><p>知识不是收集更多，而是多理解一点。</p></blockquote><ul><li>保留自己的观点</li><li>重读值得停留的段落</li></ul><pre>read → think → write</pre><p>` + strings.Repeat("让内容在自己的节奏里成为一部分，继续理解与发现。", 25) + `</p><img src="https://private.example/tracker" onerror="alert(1)"><script>危险脚本</script></article></body></html>`
	case "rss-fixture.example":
		if r.URL.Path == "/audio.mp3" {
			data, err := os.ReadFile("tests/fixtures/player.mp4")
			if err != nil {
				return nil, err
			}
			w := httptest.NewRecorder()
			w.Header().Set("Content-Type", "audio/mp4")
			http.ServeContent(w, r, "podcast.m4a", time.Time{}, bytes.NewReader(data))
			res := w.Result()
			res.Request = r
			return res, nil
		}
		if strings.Contains(r.URL.Path, "fail") {
			return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		body = `<?xml version="1.0"?><rss version="2.0"><channel><title>RSS 测试订阅</title><link>https://rss-fixture.example</link><description>明确测试夹具</description><item><guid>article-one</guid><title>RSS 测试文章</title><link>https://rss-fixture.example/article/one</link><description><![CDATA[<p>第一段测试正文。</p><script>危险脚本不会执行</script><p>第二段正文。</p>]]></description></item><item><guid>audio-one</guid><title>RSS 测试播客</title><link>https://rss-fixture.example/episode/one</link><description>测试节目说明</description><enclosure url="https://rss-fixture.example/audio.mp3" type="audio/mpeg" length="1"/></item></channel></rss>`
		if strings.Contains(r.URL.Path, "history-moving") {
			f.mu.Lock()
			f.calls[r.URL.String()]++
			call := f.calls[r.URL.String()]
			f.mu.Unlock()
			body = strings.Replace(body, "RSS 测试文章", "历史保留文章", 1)
			body = strings.Replace(body, "RSS 测试播客", "历史保留播客", 1)
			if strings.Contains(r.URL.Path, "video") {
				body = strings.Replace(body, "</channel>", `<item><guid>historical-video</guid><title>历史保留视频</title><link>https://rss-fixture.example/watch/history</link><enclosure url="https://rss-fixture.example/video.mp4" type="video/mp4"/></item></channel>`, 1)
			}
			if call >= 2 {
				body = `<?xml version="1.0"?><rss version="2.0"><channel><title>历史测试</title><link>https://rss-fixture.example</link><description>测试夹具</description><item><guid>new-item</guid><title>历史新文章</title><link>https://rss-fixture.example/new</link><description>第二轮正文</description></item></channel></rss>`
			}
		}
		if strings.Contains(r.URL.Path, "history-pages") {
			var entries strings.Builder
			for i := 57; i > 0; i-- {
				fmt.Fprintf(&entries, `<item><guid>history-%d</guid><title>分页历史 %02d</title><link>https://rss-fixture.example/history/%d</link><description>分页测试正文</description></item>`, i, i, i)
			}
			body = `<?xml version="1.0"?><rss version="2.0"><channel><title>历史分页测试</title><link>https://rss-fixture.example</link><description>测试夹具</description>` + entries.String() + `</channel></rss>`
		}
		if strings.Contains(r.URL.Path, "conditional") {
			f.mu.Lock()
			// Naming probes are anonymous reads, not conditional update attempts.
			if r.Header.Get("If-None-Match") != "" || f.calls[r.URL.String()] == 0 {
				f.calls[r.URL.String()]++
			}
			call := f.calls[r.URL.String()]
			f.mu.Unlock()
			tag := `"fixture-one"`
			if call >= 3 {
				tag = `"fixture-two"`
				body = strings.Replace(body, "</channel>", `<item><guid>article-two</guid><title>RSS 更新后的新文章</title><link>https://rss-fixture.example/article/two</link></item></channel>`, 1)
			}
			if call == 4 {
				return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{"Retry-After": {"7200"}}, Request: r}, nil
			}
			headers.Set("ETag", tag)
			if r.Header.Get("If-None-Match") == tag {
				return &http.Response{StatusCode: 304, Body: io.NopCloser(strings.NewReader("")), Header: headers, Request: r}, nil
			}
		}
		if strings.Contains(r.URL.Path, "mixed") {
			body = strings.Replace(body, "</channel>", `<item><guid>video-one</guid><title>RSS 测试视频</title><link>https://rss-fixture.example/watch/one</link><enclosure url="https://rss-fixture.example/video.mp4" type="video/mp4"/></item><item><guid>pdf-one</guid><title>RSS 测试 PDF</title><enclosure url="https://rss-fixture.example/paper.pdf" type="application/pdf"/></item><item><guid>image-one</guid><title>RSS 测试图片</title><enclosure url="https://rss-fixture.example/photo.png" type="image/png"/></item></channel>`, 1)
		}

	case "xhslink.com":
		if r.Header.Get("Cookie") != "" {
			return nil, fmt.Errorf("XHS share must be anonymous")
		}
		location := "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9?xsec_token=fixture-access&xsec_source=pc_share&tracking=discard"
		if r.URL.Path == "/a/AuthenticatedFixture" {
			location = "https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9?xsec_token=authenticated-fixture&xsec_source=pc_share"
		}
		if r.URL.Path == "/a/BadTarget" {
			location = "https://evil.example/private-secret"
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {location}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	case "www.xiaohongshu.com":
		id := strings.TrimPrefix(r.URL.Path, "/explore/")
		if r.URL.Query().Get("xsec_token") == "expired-fixture" || r.URL.Query().Get("xsec_token") == "authenticated-fixture" && r.Header.Get("Cookie") == "" {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"https://www.xiaohongshu.com/login"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		if id == "65bbbbbbbbbbbbbbbbbbbbbb" && r.Header.Get("Cookie") == "" {
			return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("private test restriction")), Request: r}, nil
		}
		if id == "65cccccccccccccccccccccc" {
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		kind := "normal"
		if id == "64aaaaaaaaaaaaaaaaaaaaaa" {
			kind = "video"
			if r.URL.Query().Get("xsec_token") != "fixture-access" {
				return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("requires original locator")), Request: r}, nil
			}
		}
		if id != "6411cf99000000001300b6d9" && id != "65bbbbbbbbbbbbbbbbbbbbbb" && id != "64aaaaaaaaaaaaaaaaaaaaaa" {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		note := map[string]any{"noteId": id, "type": kind, "title": "小红书图文测试笔记", "desc": "第一段：读图也能留下想法。\n第二段：图片与正文一起收藏，Markdown 批注保留原文。", "time": 1791504000000, "user": map[string]string{"nickname": "小红书测试作者", "userId": "fixture-author"}, "imageList": []any{map[string]any{"urlDefault": "https://sns-webpic-qc.xhscdn.com/fixture-portrait.svg", "width": 900, "height": 1200}, map[string]any{"urlDefault": "https://sns-webpic-qc.xhscdn.com/fixture-landscape.svg", "width": 1200, "height": 800}}}
		if kind == "video" {
			note["title"] = "小红书视频测试笔记"
		}
		state, _ := json.Marshal(map[string]any{"note": map[string]any{"noteDetailMap": map[string]any{id: map[string]any{"note": note}}}, "unused": nil})
		body = "<html><script>window.__INITIAL_STATE__=" + strings.Replace(string(state), `"unused":null`, `"unused":undefined`, 1) + ";</script></html>"
		headers.Set("Content-Type", "text/html")
	case "sns-webpic-qc.xhscdn.com":
		width, height := 1200, 800
		if strings.Contains(r.URL.Path, "portrait") {
			width, height = 900, 1200
		}
		picture := image.NewRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				shade := uint8(180)
				if x > width/4 && x < width*3/4 && y > height/4 && y < height*3/4 {
					shade = 110
				}
				picture.SetRGBA(x, y, color.RGBA{R: shade, G: shade, B: shade, A: 255})
			}
		}
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, picture); err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"image/png"}}, Body: io.NopCloser(bytes.NewReader(encoded.Bytes())), Request: r}, nil
	case "v.douyin.com":
		if r.Header.Get("Cookie") != "" {
			return nil, fmt.Errorf("share resolution must be anonymous")
		}
		location := "https://www.douyin.com/video/6961737553342991651?share=fixture"
		if r.URL.Path == "/BadTarget/" {
			location = "http://127.0.0.1/private"
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": {location}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	case "www.douyin.com":
		if r.Header.Get("Cookie") != "" {
			return nil, fmt.Errorf("share final request must be anonymous")
		}
		body = "explicit share locator fixture; not parsed"
	case "www.youtube.com":
		if r.URL.Path != "/feeds/videos.xml" || r.Header.Get("Cookie") != "" {
			return nil, fmt.Errorf("fixture channel expects public feed only")
		}
		id := r.URL.Query().Get("channel_id")
		if id != "UC"+strings.Repeat("a", 22) && id != "UC"+strings.Repeat("b", 22) && id != "UC"+strings.Repeat("e", 22) && id != "UC"+strings.Repeat("h", 22) {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		f.mu.Lock()
		f.calls[r.URL.String()]++
		call := f.calls[r.URL.String()]
		f.mu.Unlock()
		tag := `"youtube-fixture-one"`
		if call >= 3 {
			tag = `"youtube-fixture-two"`
		}
		if id == "UC"+strings.Repeat("a", 22) && call == 4 {
			return &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": {"7200"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		headers.Set("ETag", tag)
		if r.Header.Get("If-None-Match") == tag {
			return &http.Response{StatusCode: 304, Header: headers, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		videos := []string{"abcdefghijk", "channel0002"}
		if id == "UC"+strings.Repeat("e", 22) {
			videos = []string{}
		}
		if id == "UC"+strings.Repeat("a", 22) && call >= 3 {
			videos = append(videos, "channel0003")
		}
		body = fmt.Sprintf(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><yt:channelId>%s</yt:channelId><title>YouTube 频道测试</title><author><name>YouTube 测试作者</name><uri>https://www.youtube.com/channel/%s</uri></author>`, strings.TrimPrefix(id, "UC"), id)
		for index, video := range videos {
			body += fmt.Sprintf(`<entry><id>yt:video:%s</id><yt:videoId>%s</yt:videoId><yt:channelId>%s</yt:channelId><title>YouTube 订阅测试视频 %d</title><link rel="alternate" href="https://www.youtube.com/watch?v=%s"/><author><name>YouTube 测试作者</name><uri>https://www.youtube.com/channel/%s</uri></author><published>2026-10-%02dT12:00:00Z</published><media:group><media:description>频道公开 feed 测试简介。</media:description></media:group></entry>`, video, video, id, index+1, video, id, 15-index)
		}
		body += `</feed>`

	case "www.xiaoyuzhoufm.com":
		id := strings.TrimPrefix(r.URL.Path, "/episode/")
		body = fmt.Sprintf(`<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"episode":{"eid":"%s","title":"小宇宙公开单集测试","description":"小宇宙测试节目说明","duration":120,"pubDate":"2026-01-01T00:00:00Z","media":{"source":{"mode":"PUBLIC","url":"https://media.xyzcdn.net/test-fixture.mp3"}},"podcast":{"title":"测试播客","pid":"test"}}}}}</script></html>`, id)
	default:
		return nil, fmt.Errorf("test network fixture does not serve destination")
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: headers, Request: r}, nil
}

type speechFixture struct{}

func (speechFixture) Status(c transcription.Config) transcription.Status {
	return transcription.Status{Config: c, Ready: true, Missing: []string{}, Models: []transcription.Model{{Backend: "whisper.cpp", Label: "base", Path: "/explicit-fixture/ggml-base.bin"}, {Backend: "faster-whisper", Label: "base", Path: "/explicit-fixture/faster-base"}, {Backend: "faster-whisper", Label: "tiny", Path: "/explicit-fixture/faster-tiny"}}}
}
func (speechFixture) Transcribe(ctx context.Context, c transcription.Config, a transcription.Audio, limit int, stage func(string)) (subtitles.Track, error) {
	if c.Cloud() {
		stage("uploading")
	} else {
		stage("recognizing")
	}
	select {
	case <-time.After(1500 * time.Millisecond):
	case <-ctx.Done():
		return subtitles.Track{}, ctx.Err()
	}
	label := "明确标识的 E2E 本机识别夹具"
	if limit > 0 {
		label = "前 60 秒 · E2E 识别夹具"
	}
	if c.Backend == "siliconflow" {
		return subtitles.Track{Language: "siliconflow", Label: "明确测试夹具 · 硅基流动片段字幕（约 30 秒/段）", Automatic: true, Cues: []subtitles.Cue{{Start: 0, End: 30, Text: "播客转写测试第一句。"}, {Start: 30, End: 60, Text: "播客转写测试第二句。"}}}, nil
	}
	return subtitles.Track{Language: "whisper", Label: label, Automatic: true, Cues: []subtitles.Cue{{Start: 1.25, End: 4, Text: "播客转写测试第一句。"}, {Start: 5, End: 8.5, Text: "播客转写测试第二句。"}}}, nil
}
func main() {
	data := flag.String("data", "", "isolated E2E database directory")
	port := flag.Int("port", 7391, "isolated E2E loopback port")
	flag.Parse()
	if *data == "" {
		panic("isolated test data directory required")
	}
	application, err := app.New(*data, web.Assets(), app.Options{AITranslator: &aiFixture{calls: make(map[string]int)}, FavoritesRemote: &favoriteFixture{}, TranscriptionEngine: speechFixture{}, BilibiliAudio: func(context.Context, string) (transcription.Audio, error) {
		return transcription.Audio{URL: "https://fixture.bilivideo.com/audio.m4s", Platform: "bilibili", Referer: "https://www.bilibili.com/"}, nil
	}, Playback: func(context.Context, string) (playback.Source, error) {
		return playback.Source{URL: "https://fixture.bilivideo.com/player.mp4", Quality: 64}, nil
	}, Recommendations: func(ctx context.Context, source string) (discovery.Feed, error) {
		return discovery.Feed{Items: []content.Item{}, Page: 1, SourceTitle: source}, ctx.Err()
	}, Platform: &fixturePlatform{calls: make(map[string]int)}, PublicHTTP: &http.Client{Transport: &publicFixtureTransport{calls: make(map[string]int)}, Timeout: time.Second}, AudioHTTP: &http.Client{Transport: &publicFixtureTransport{calls: make(map[string]int)}}})
	if err != nil {
		panic(err)
	}
	defer application.Close()
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", *port), Handler: application.HTTPHandler(), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 40 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			server.Close()
		}
	}()
	fmt.Println("Tangentry E2E: platform fixture; real application/HTTP/SQLite; isolated data", *data)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
	<-drained
}

// Selected-folder fixtures are never compiled into the production command.
type favoriteFixture struct {
	mu    sync.Mutex
	calls map[string]int
}

func (f *favoriteFixture) Folders(ctx context.Context) ([]favoritesync.Folder, error) {
	return []favoritesync.Folder{{ID: "12345", Title: "收藏同步测试夹", Count: 6}, {ID: "99999", Title: "收藏同步受限测试夹", Count: 1}}, ctx.Err()
}
func (f *favoriteFixture) Page(ctx context.Context, id string, page int) (favoritesync.Page, error) {
	f.mu.Lock()
	if f.calls == nil {
		f.calls = make(map[string]int)
	}
	f.calls[id]++
	f.mu.Unlock()
	if id == "99999" {
		return favoritesync.Page{}, &discovery.PlatformError{Message: "明确测试：收藏夹受到平台限制。", Restricted: true}
	}
	select {
	case <-ctx.Done():
		return favoritesync.Page{}, ctx.Err()
	case <-time.After(150 * time.Millisecond):
	}
	items := make([]content.Item, 0, 6)
	for i := 0; i < 6; i++ {
		items = append(items, fixtureVideo(fmt.Sprintf("BVfav%07d", i)))
	}
	return favoritesync.Page{Folder: favoritesync.Folder{ID: id, Title: "收藏同步测试夹", Count: 6}, Items: items, Entries: 6}, ctx.Err()
}

// Only the E2E composition root injects this external model fixture.
type aiFixture struct {
	mu    sync.Mutex
	calls map[string]int
}

func (f *aiFixture) Chat(ctx context.Context, c ai.Config, contextText string, _ []ai.ChatMessage) (string, error) {
	if c.BaseURL != "https://ai-fixture.example/v1" {
		return "", ai.ErrProvider
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return "当前字幕内容：\n\n" + contextText, nil
}

func (f *aiFixture) SupportsSummary(c ai.Config) bool {
	return (&aichat.Client{}).SupportsSummary(c)
}

func (f *aiFixture) Summarize(ctx context.Context, c ai.Config, input ai.SummaryRequest) (ai.SummaryDraft, error) {
	if c.BaseURL != "https://ai-fixture.example/v1" {
		return ai.SummaryDraft{}, ai.ErrProvider
	}
	if err := ctx.Err(); err != nil {
		return ai.SummaryDraft{}, err
	}
	if input.Mode == "leaf" {
		return ai.SummaryDraft{Overview: "测试摘要已生成", Points: []ai.SummaryPoint{{Text: "正文要点", Indices: []int{input.Segments[0].Index}}}}, nil
	}
	return ai.SummaryDraft{Overview: "测试摘要已合并", Points: []ai.SummaryPoint{{Text: "正文要点", Indices: input.Drafts[0].Points[0].Indices}}}, nil
}

func (f *aiFixture) Translate(ctx context.Context, c ai.Config, segments []ai.Segment) ([]ai.Segment, error) {
	if c.BaseURL != "https://ai-fixture.example/v1" {
		return nil, ai.ErrProvider
	}
	f.mu.Lock()
	f.calls[c.Model]++
	call := f.calls[c.Model]
	f.mu.Unlock()
	delay := 120 * time.Millisecond
	if c.Model == "fixture-navigation" || c.Model == "fixture-cancel" && call > 1 {
		delay = 3 * time.Second
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(delay):
	}
	if c.Model == "fixture-partial" && call == 2 {
		return nil, ai.ErrRate
	}
	result := make([]ai.Segment, len(segments))
	for i, segment := range segments {
		result[i] = ai.Segment{Index: segment.Index, Text: fmt.Sprintf("這是第%d句的中文譯文。", segment.Index+1)}
	}
	if c.Model == "fixture-invalid" {
		result[0].Index = 99999
	}
	return result, nil
}
