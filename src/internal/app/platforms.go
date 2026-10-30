package app

import (
	"context"
	"net/http"
	"path/filepath"
	"time"

	"tangentry/internal/adapters/feeds"
	paperadapter "tangentry/internal/adapters/papers"
	"tangentry/internal/adapters/platforms/bilibili"
	"tangentry/internal/adapters/platforms/discourse"
	"tangentry/internal/adapters/platforms/douyin"
	"tangentry/internal/adapters/platforms/xiaohongshu"
	"tangentry/internal/adapters/platforms/xiaoyuzhou"
	"tangentry/internal/adapters/platforms/youtube"
	"tangentry/internal/adapters/tools"
	"tangentry/internal/config"
	"tangentry/internal/credentials"
	"tangentry/internal/discovery"
	"tangentry/internal/netpolicy"
	"tangentry/internal/playback"
)

// platforms is an application-level capability registry. The concrete clients
// are still assembled here, but callers consume a bundle named after the
// capability they need instead of reaching through one flat platform bag.
// Shared clients intentionally remain single instances across bundles.
type platforms struct {
	network       platformNetwork
	discovery     platformDiscovery
	imports       platformImports
	subscriptions platformSubscriptions
	media         platformMedia
}

type platformNetwork struct {
	public  *http.Client
	audio   *http.Client
	cookies *credentials.Store
	toolkit *tools.Toolkit
	papers  *paperadapter.Client
}

type platformDiscovery struct {
	creators discovery.Provider
	bilibili *bilibili.Client
	douyin   *douyin.Client
	notes    *xiaohongshu.Client
	forum    *discourse.Client
	podcasts *xiaoyuzhou.Client
	youtube  *youtube.Client
}

type platformImports struct {
	feeds      *feeds.Client
	youtube    *youtube.Client
	douyin     *douyin.Client
	notes      *xiaohongshu.Client
	forum      *discourse.Client
	podcasts   *xiaoyuzhou.Client
	toolkit    *tools.Toolkit
	noteImages *xiaohongshu.Images
}

type platformSubscriptions struct {
	feeds    *feeds.Client
	youtube  *youtube.Client
	creators discovery.Provider
	toolkit  *tools.Toolkit
	papers   *paperadapter.Client
}

type platformMedia struct {
	bilibili *bilibili.Client
	douyin   *douyin.Client
	toolkit  *tools.Toolkit
	notes    *xiaohongshu.Client
	podcasts *xiaoyuzhou.Client
}

func newPlatforms(dataDir string, configuration config.Config, toolkit *tools.Toolkit, cookies *credentials.Store, option Options) (*platforms, error) {
	public := option.PublicHTTP
	if public == nil {
		public = netpolicy.NewClient()
	}
	audio := option.AudioHTTP
	if audio == nil {
		audio = netpolicy.NewStreamingClient()
	}
	client := bilibili.NewClient(&http.Client{Timeout: 15 * time.Second}, configuration.BilibiliCookie, toolkit)
	client.PageFetcher = option.PlatformPageFetcher
	client.SetCookieProvider(func(rawURL string) string { return cookies.Header("bilibili", rawURL) })
	client.SetUserAgentProvider(func(rawURL string) string { return cookies.UserAgent("bilibili") })
	client.SetCredentialRefresher(&bilibili.CredentialRefresher{HTTP: public, Load: cookies.BilibiliPair, Save: cookies.SaveBilibiliIfCurrent, UserAgent: func() string { return cookies.UserAgent("bilibili") }})
	var creators discovery.Provider = client
	if option.Platform != nil {
		creators = option.Platform
	}
	noteImages, err := xiaohongshu.OpenImages(filepath.Join(dataDir, "xiaohongshu-images"), public)
	if err != nil {
		return nil, err
	}
	podcasts := &xiaoyuzhou.Client{HTTP: public, Cookie: cookieFor(cookies, "xiaoyuzhou")}
	podcasts.Auth = &xiaoyuzhou.AuthSession{HTTP: public, Tokens: func() (string, string) {
		return cookies.TokenPair("xiaoyuzhou")
	}, Save: cookies.SaveTokensIfCurrent}
	feedClient := &feeds.Client{HTTP: public}
	paperClient := &paperadapter.Client{HTTP: public, UserAgent: "Tangentry/0.1 (paper reader)"}
	youtubeClient := youtube.New(public)
	youtubeClient.SetChannelFallback(toolkit.YouTubeChannelFeed)
	douyinClient := &douyin.Client{HTTP: public, Cookie: cookieFor(cookies, "douyin"), UserAgent: userAgentFor(cookies, "douyin"), Page: option.PlatformPageFetcher}
	toolkit.SetDouyinPlaybackResolver(func(ctx context.Context, id string) (playback.Source, error) {
		media, err := douyinClient.ResolveVideoMedia(ctx, id)
		if err != nil {
			return playback.Source{}, err
		}
		return playback.Source{URL: media.URL, Backups: media.Backups, Platform: "douyin", Referer: "https://www.douyin.com/video/" + id}, nil
	})
	toolkit.SetYouTubeHTTPClient(public)
	notesClient := &xiaohongshu.Client{HTTP: public, Cookie: cookieFor(cookies, "xiaohongshu"), UserAgent: userAgentFor(cookies, "xiaohongshu"), Page: option.PlatformPageFetcher}
	forumClient := &discourse.Client{HTTP: public, UserAgent: userAgentFor(cookies, "linuxdo"), Session: cookies.PrepareLinuxdoSession, UserKey: cookies.LinuxdoUserKey, Page: option.PlatformPageFetcher}
	return &platforms{
		network:       platformNetwork{public: public, audio: audio, cookies: cookies, toolkit: toolkit, papers: paperClient},
		discovery:     platformDiscovery{creators: creators, bilibili: client, douyin: douyinClient, notes: notesClient, forum: forumClient, podcasts: podcasts, youtube: youtubeClient},
		imports:       platformImports{feeds: feedClient, youtube: youtubeClient, douyin: douyinClient, notes: notesClient, forum: forumClient, podcasts: podcasts, toolkit: toolkit, noteImages: noteImages},
		subscriptions: platformSubscriptions{feeds: feedClient, youtube: youtubeClient, creators: creators, toolkit: toolkit, papers: paperClient},
		media:         platformMedia{bilibili: client, douyin: douyinClient, toolkit: toolkit, notes: notesClient, podcasts: podcasts},
	}, nil
}

func cookieFor(cookies *credentials.Store, platform string) func(string) string {
	return func(raw string) string { return cookies.Header(platform, raw) }
}

func userAgentFor(cookies *credentials.Store, platform string) func(string) string {
	return func(string) string { return cookies.UserAgent(platform) }
}

func (p *platforms) podcastToken() string { return p.network.cookies.AccessToken("xiaoyuzhou") }
