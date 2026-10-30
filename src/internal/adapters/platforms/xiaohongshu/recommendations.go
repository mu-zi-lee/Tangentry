package xiaohongshu

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
)

// Read the website's hydrated feed, without executing page scripts or sending
// credentials to third-party hosts. Private signed APIs are not assumed usable.
func (c *Client) Recommendations(ctx context.Context) (discovery.Feed, error) {
	const homepage = "https://www.xiaohongshu.com/explore"
	if c.HTTP == nil {
		return discovery.Feed{}, discovery.ErrUnavailable
	}
	if c.Cookie == nil || c.Cookie(homepage) == "" {
		return discovery.Feed{}, &discovery.PlatformError{Message: "请先在工具设置导入小红书 Cookie。"}
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := *c.HTTP
	client.Jar = nil
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, homepage, nil)
	userAgent := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
	if c.UserAgent != nil && c.UserAgent(homepage) != "" {
		userAgent = c.UserAgent(homepage)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Cookie", c.Cookie(homepage))
	res, err := client.Do(req)
	if err != nil {
		return discovery.Feed{}, requestError(ctx)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		if res.StatusCode == http.StatusTooManyRequests {
			return discovery.Feed{}, &discovery.PlatformError{Message: "小红书暂时限制推荐请求，请稍后重试。", Restricted: true}
		}
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
			return discovery.Feed{}, &discovery.PlatformError{Message: "小红书拒绝了当前登录凭据，请在原站完成验证后重新导入 Cookie。"}
		}
		return discovery.Feed{}, recommendationUnavailable()
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if err != nil || len(data) > 4<<20 {
		return discovery.Feed{}, recommendationUnavailable()
	}
	feed, err := ParseRecommendations(data)
	if err == nil {
		for _, item := range feed.Items {
			c.remember(item)
		}
	}
	return feed, err
}

func recommendationUnavailable() error {
	return &discovery.PlatformError{Message: "小红书首页没有返回可读取的推荐，可能需要登录验证或 Cookie 已失效。请在小红书原站完成验证后重新导入 Cookie。"}
}

func ParseRecommendations(data []byte) (discovery.Feed, error) {
	z := html.NewTokenizer(strings.NewReader(string(data)))
	var payload []byte
	for kind := z.Next(); kind != html.ErrorToken; kind = z.Next() {
		if kind != html.StartTagToken || z.Token().Data != "script" {
			continue
		}
		if z.Next() != html.TextToken {
			continue
		}
		script := strings.TrimSpace(string(z.Text()))
		const prefix = "window.__INITIAL_STATE__"
		if !strings.HasPrefix(script, prefix) {
			continue
		}
		script = strings.TrimSpace(strings.TrimPrefix(script, prefix))
		if !strings.HasPrefix(script, "=") || payload != nil {
			return discovery.Feed{}, recommendationUnavailable()
		}
		var err error
		payload, err = stateJSON(strings.TrimSpace(script[1:]))
		if err != nil {
			return discovery.Feed{}, recommendationUnavailable()
		}
	}
	if len(payload) == 0 {
		return discovery.Feed{}, &discovery.PlatformError{Message: "小红书返回的页面没有推荐数据，可能是验证页或未登录页面。请在原站完成验证后重试。"}
	}
	var state struct {
		Feed struct {
			Feeds []struct {
				ID    string `json:"id"`
				Token string `json:"xsecToken"`
				Card  struct {
					Type        string          `json:"type"`
					Title       string          `json:"displayTitle"`
					Time        json.RawMessage `json:"time"`
					PublishTime json.RawMessage `json:"publishTime"`
					User        struct {
						Avatar string `json:"avatar"`
						Name   string `json:"nickname"`
						ID     string `json:"userId"`
					} `json:"user"`
					Cover struct {
						URL     string `json:"urlDefault"`
						Preview string `json:"urlPre"`
						Width   int    `json:"width"`
						Height  int    `json:"height"`
					} `json:"cover"`
				} `json:"noteCard"`
			} `json:"feeds"`
		} `json:"feed"`
	}
	if json.Unmarshal(payload, &state) != nil || len(state.Feed.Feeds) > 200 {
		return discovery.Feed{}, recommendationUnavailable()
	}
	feed := discovery.Feed{Items: []content.Item{}, Page: 1, SourceTitle: "小红书推荐"}
	seen := map[string]bool{}
	for _, note := range state.Feed.Feeds {
		raw := "https://www.xiaohongshu.com/explore/" + note.ID
		if note.Token != "" {
			raw += "?xsec_token=" + url.QueryEscape(note.Token) + "&xsec_source=pc_feed"
		}
		ref, err := discovery.ParseXiaohongshu(raw)
		if err != nil || seen[note.ID] || (note.Card.Type != "normal" && note.Card.Type != "video") {
			continue
		}
		kind := "image"
		if note.Card.Type == "video" {
			kind = "video"
		}
		cover := imageURL(note.Card.Cover.URL)
		if cover == "" {
			cover = imageURL(note.Card.Cover.Preview)
		}
		item := content.Item{ID: "xiaohongshu:" + note.ID, Platform: "xiaohongshu", PlatformID: note.ID, Kind: kind, Title: note.Card.Title, Author: note.Card.User.Name, AuthorID: note.Card.User.ID, URL: ref.URL, ThumbnailURL: cover}
		if cover != "" && note.Card.Cover.Width > 0 && note.Card.Cover.Height > 0 {
			item.ThumbnailWidth, item.ThumbnailHeight = note.Card.Cover.Width, note.Card.Cover.Height
		}
		item.PublishedAt = recommendationTime(note.Card.Time)
		if item.PublishedAt == 0 {
			item.PublishedAt = recommendationTime(note.Card.PublishTime)
		}
		item.AuthorAvatarURL = imageURL(note.Card.User.Avatar)
		if content.Validate(item) != nil {
			continue
		}
		seen[note.ID] = true
		feed.Items = append(feed.Items, item)
	}
	if len(feed.Items) == 0 {
		return discovery.Feed{}, recommendationUnavailable()
	}
	feed.Total = len(feed.Items)
	return feed, nil
}

func recommendationTime(raw json.RawMessage) int64 {
	var number json.Number
	if json.Unmarshal(raw, &number) != nil {
		return 0
	}
	value, err := number.Int64()
	if err != nil || value <= 0 {
		return 0
	}
	if value > 100000000000 {
		value /= 1000
	}
	if value > 253402300799 {
		return 0
	}
	return value
}
