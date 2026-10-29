// Package tools contains CLI-specific behavior. Business code never builds shell commands.
package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"tangentry/internal/adapters/platforms/douyin"
	"tangentry/internal/adapters/platforms/youtube"
	"tangentry/internal/config"
	"tangentry/internal/credentials"
	"tangentry/internal/discovery"
	"tangentry/internal/downloads"
	"tangentry/internal/playback"
)

type Toolkit struct {
	youtubeAvatarMu    sync.Mutex
	youtubeAvatars     map[string]youtubeAvatarEntry
	youtubeAvatarSlots chan struct{}
	youtubePages       youtubePageState
	youtubeSessions    map[string]*youtubePageState
	youtubeMu          sync.Mutex
	youtubeHome        func(context.Context, string, json.RawMessage) youtube.HomeResult
	youtubePlayer      func(context.Context, string, string) youtube.PlayerResult
	youtubeHTTP        *http.Client
	youtubeUserAgent   func() string
	credentials        *credentials.Store
	config             config.Config
	status             downloads.ToolReport
	// ytdlp and deno are downloaded into the app data directory on first use
	// when the desktop runtime configures a tools directory.
	ytdlp          *managedTool
	deno           *managedTool
	douyinPlayback func(context.Context, string) (playback.Source, error)
	douyinHTTP     *http.Client
}

func New(c config.Config) *Toolkit {
	t := &Toolkit{config: c, youtubeAvatars: map[string]youtubeAvatarEntry{}, youtubeAvatarSlots: make(chan struct{}, 2)}
	t.youtubeHome = func(ctx context.Context, cookie string, continuation json.RawMessage) youtube.HomeResult {
		home := youtube.NewHome()
		if t.youtubeUserAgent != nil {
			home.UserAgent = t.youtubeUserAgent()
		}
		return home.Fetch(ctx, cookie, continuation)
	}
	t.config.FFmpegPath = executable(c.FFmpegPath, "ffmpeg")
	ytdlp := downloads.ToolStatus{Name: "yt-dlp"}
	if c.YTDLPPath == "" && c.ToolsDir != "" {
		t.ytdlp = newManagedTool("yt-dlp", c.ToolsDir, pinnedYTDLP)
		t.deno = newManagedTool("deno", c.ToolsDir, pinnedDeno)
	} else {
		t.config.YTDLPPath = executable(c.YTDLPPath, "yt-dlp")
		ytdlp = probe("yt-dlp", t.config.YTDLPPath, "--version")
	}
	t.status = downloads.ToolReport{DownloadDir: c.DownloadDir, CookieConfigured: c.CookieFile != "", Tools: []downloads.ToolStatus{ytdlp, probe("FFmpeg", t.config.FFmpegPath, "-version")}}
	return t
}

// ytdlpReady reports whether yt-dlp is installed or will be downloaded on use.
func (t *Toolkit) ytdlpReady() bool { return t.ytdlp != nil || t.status.Tools[0].Available }

// YTDLP returns the yt-dlp executable, downloading the pinned release first
// when the app manages it.
func (t *Toolkit) YTDLP(ctx context.Context) (string, error) {
	if t.ytdlp == nil {
		if t.config.YTDLPPath == "" {
			return "", downloads.ErrTools
		}
		return t.config.YTDLPPath, nil
	}
	return t.ytdlp.ensure(ctx)
}

// ytdlpCommand prepares a yt-dlp invocation. Managed installs also receive a
// JavaScript runtime for YouTube extraction: a system deno or node when one
// exists, otherwise the pinned Deno downloaded on first use. A failed runtime
// download degrades extraction instead of failing it.
func (t *Toolkit) ytdlpCommand(ctx context.Context, args ...string) (*exec.Cmd, error) {
	binary, err := t.YTDLP(ctx)
	if err != nil {
		return nil, err
	}
	if t.ytdlp != nil && needsJavaScript(args) {
		if runtime := t.javaScriptRuntime(ctx); runtime != "" {
			args = append([]string{"--js-runtimes", runtime}, args...)
		}
	}
	cmd := command(ctx, binary, args...)
	cmd.Env = toolEnvironment()
	return cmd, nil
}

func needsJavaScript(args []string) bool {
	youtube := false
	for _, arg := range args {
		switch {
		case arg == "--flat-playlist", arg == "--force-generic-extractor":
			return false
		case strings.Contains(arg, "youtube.com/"), strings.Contains(arg, "youtu.be/"):
			youtube = true
		}
	}
	return youtube
}

// UpdateYTDLP replaces the managed yt-dlp with the latest verified release in
// the background; Status reports its progress.
func (t *Toolkit) UpdateYTDLP() error {
	if t.ytdlp == nil {
		return downloads.ErrTools
	}
	if err := t.ytdlp.update(func(ctx context.Context) (managedRelease, error) { return latestYTDLP(ctx, t.ytdlp.client) }); err != nil {
		return downloads.ErrToolBusy
	}
	return nil
}

func (t *Toolkit) Ready() bool { return t.ytdlpReady() && t.status.Tools[1].Available }
func (t *Toolkit) Status() downloads.ToolReport {
	report := t.status
	report.Tools = append([]downloads.ToolStatus{}, t.status.Tools...)
	if t.ytdlp != nil {
		state := t.ytdlp.snapshot()
		report.Tools[0] = downloads.ToolStatus{Name: "yt-dlp", Available: true, Version: state.Version, Managed: true, Installed: state.Installed,
			Downloading: state.Downloading, Received: state.Received, Total: state.Total, Error: state.Error}
	}
	report.DownloadReady = t.Ready()
	report.YouTubeRecommendation = t.YouTubeRecommendationStatus()
	if t.credentials != nil {
		for _, state := range t.credentials.States() {
			if state.Platform == "bilibili" {
				report.CookieConfigured = state.Configured
			}
		}
	}
	return report
}
func (t *Toolkit) SetCredentials(value *credentials.Store) { t.credentials = value }
func (t *Toolkit) SetDouyinPlaybackResolver(resolve func(context.Context, string) (playback.Source, error)) {
	t.douyinPlayback = resolve
}

// SetDouyinHTTPClient is used by the desktop composition root and offline
// fixtures. The downloader clones this client and strips credentials before
// every CDN request.
func (t *Toolkit) SetDouyinHTTPClient(client *http.Client) { t.douyinHTTP = client }

func (t *Toolkit) SetYouTubeUserAgent(provider func() string) { t.youtubeUserAgent = provider }

func (t *Toolkit) SetYouTubeHTTPClient(client *http.Client) {
	t.youtubeHTTP = client
	t.youtubePlayer = func(ctx context.Context, videoID, cookie string) youtube.PlayerResult {
		player := youtube.NewPlayer(client)
		if t.youtubeUserAgent != nil {
			player.UserAgent = t.youtubeUserAgent()
		}
		return player.Fetch(ctx, videoID, cookie)
	}
}

// Invocations snapshot their own platform jar; no shared file is passed to yt-dlp.
func (t *Toolkit) cookieArguments(rawURL string) ([]string, func(), error) {
	platform := credentials.PlatformForURL(rawURL)
	if platform == "" {
		return nil, func() {}, nil
	}
	if t.credentials != nil {
		file, clean, err := t.credentials.Snapshot(platform)
		if err != nil {
			return nil, clean, err
		}
		if file != "" {
			return []string{"--cookies", file}, clean, nil
		}
		return nil, clean, nil
	}
	if platform == "bilibili" && t.config.CookieFile != "" {
		return []string{"--cookies", t.config.CookieFile}, func() {}, nil
	}
	return nil, func() {}, nil
}

func (t *Toolkit) arguments(rawURL, outputDir string, maxHeight int) []string {
	return t.mediaArguments(rawURL, outputDir, maxHeight, downloads.Options{})
}

func (t *Toolkit) Download(ctx context.Context, rawURL, outputDir string, maxHeight int) (string, error) {
	result, err := t.DownloadMedia(ctx, rawURL, outputDir, maxHeight, downloads.Options{})
	return result.FileName, err
}

func classify(raw string) error {
	text := strings.ToLower(raw)
	switch {
	case strings.Contains(text, "412"), strings.Contains(text, "403"), strings.Contains(text, "429"), strings.Contains(text, "-352"), strings.Contains(text, "risk control"):
		return errors.New("平台限制了下载请求，请稍后重试；登录态或网络环境可能影响访问。")
	case strings.Contains(text, "http error 567"), strings.Contains(text, "error 567"):
		return errors.New("视频 CDN 暂时拒绝了分片请求，已自动改用小分片下载；请稍后重试。")
	case strings.Contains(text, "login"), strings.Contains(text, "sign in"), strings.Contains(text, "cookies"), strings.Contains(text, "premium"):
		return errors.New("此视频需要有效登录态或账号权限，请检查登录配置。")
	case strings.Contains(text, "requested format"), strings.Contains(text, "no video formats"):
		return errors.New("这段视频没有可用的对应画质，请尝试其他画质。")
	case strings.Contains(text, "no space left"):
		return errors.New("下载磁盘空间不足。")
	default:
		return fmt.Errorf("下载未完成，请检查视频是否可访问、网络和工具配置后重试。")
	}
}

func classifyDouyin(raw string, cookieProvided bool) error {
	text := strings.ToLower(raw)
	if strings.Contains(text, "timed out") || strings.Contains(text, "timeout") || strings.Contains(text, "connection reset") || strings.Contains(text, "network is unreachable") || strings.Contains(text, "temporary failure in name resolution") || strings.Contains(text, "name or service not known") {
		return errors.New("抖音视频解析网络或超时，请稍后重试。")
	}
	if strings.Contains(text, "fresh cookies") || strings.Contains(text, "not necessarily logged in") || strings.Contains(text, "http error 403") || strings.Contains(text, "403 forbidden") {
		if !cookieProvided {
			return errors.New("未配置抖音 Cookie，且 yt-dlp 的抖音解析器被接口拒绝；请在应用内打开抖音完成登录或验证后重试。")
		}
		return errors.New("已配置 Cookie，但 yt-dlp 的抖音解析器被抖音接口拒绝（HTTP 403 / 需要新 Cookie）。这通常是 yt-dlp 暂不支持当前抖音接口，不一定是你的 Cookie 有问题；请在应用内抖音页面重试。")
	}
	if !cookieProvided && (strings.Contains(text, "no cookies") || strings.Contains(text, "cookies are required") || strings.Contains(text, "login required") || strings.Contains(text, "authentication required")) {
		return errors.New("未配置抖音 Cookie，请在应用内打开抖音完成登录或验证后重试。")
	}
	return errors.New("抖音视频解析失败，请在应用内抖音页面重试。")
}

func (t *Toolkit) downloadDouyinFallback(ctx context.Context, rawURL, directory string, height int, options downloads.Options) (downloads.Result, error) {
	if options.Mode == "audio" {
		return downloads.Result{}, errors.New("抖音应用内下载暂不支持仅音频选项，请选择视频下载。")
	}
	// A direct progressive MP4 cannot honor yt-dlp's format, subtitle, remux,
	// height or post-processing options. Skip it rather than silently changing
	// the requested download.
	if height > 0 || options.Container != "" && options.Container != "mp4" || options.VideoOnly || options.VideoFormatID != "" || options.AudioFormatID != "" || len(options.SubtitleLanguages) > 0 || options.AutomaticSubtitles || options.Compress {
		return downloads.Result{}, errors.New("抖音应用内地址不支持当前下载选项")
	}
	if t.douyinPlayback == nil {
		return downloads.Result{}, errors.New("应用内抖音页面不可用")
	}
	ref, err := discovery.ParseDouyin(rawURL)
	if err != nil {
		return downloads.Result{}, errors.New("抖音链接无效")
	}
	source, err := t.douyinPlayback(ctx, ref.ID)
	if err != nil {
		return downloads.Result{}, err
	}
	candidates := append([]string{source.URL}, source.Backups...)
	valid := make([]string, 0, 3)
	for _, candidate := range candidates {
		if douyin.PlaybackURL(candidate) && douyinPlaybackURLLive(candidate, time.Now()) {
			valid = append(valid, candidate)
		}
	}
	if len(valid) == 0 {
		return downloads.Result{}, errors.New("应用内抖音页面未提供可下载地址")
	}
	baseClient := t.douyinHTTP
	if baseClient == nil {
		baseClient = http.DefaultClient
	}
	clientValue := *baseClient
	clientValue.Timeout = 30 * time.Minute
	clientValue.Jar = nil
	clientValue.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("redirect limit exceeded")
		}
		if !douyin.PlaybackURL(req.URL.String()) {
			return errors.New("redirect denied")
		}
		req.Header.Del("Cookie")
		req.Header.Del("Authorization")
		req.Header.Set("Referer", "https://www.douyin.com/video/"+ref.ID)
		return nil
	}
	client := &clientValue
	var response *http.Response
	for _, candidate := range valid {
		req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, candidate, nil)
		if requestErr != nil {
			continue
		}
		req.Header.Set("Referer", "https://www.douyin.com/video/"+ref.ID)
		response, err = client.Do(req)
		if err == nil && response.StatusCode >= 200 && response.StatusCode < 300 {
			break
		}
		if response != nil {
			response.Body.Close()
		}
		response = nil
	}
	if response == nil {
		if ctx.Err() != nil {
			return downloads.Result{}, ctx.Err()
		}
		return downloads.Result{}, errors.New("抖音播放地址已过期或 CDN 拒绝，请重试。")
	}
	defer response.Body.Close()
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	if contentType != "" && contentType != "video/mp4" && contentType != "application/octet-stream" {
		return downloads.Result{}, errors.New("抖音 CDN 返回了非视频内容，请重试。")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return downloads.Result{}, errors.New("无法创建下载目录，请检查磁盘权限。")
	}
	name := filepath.Join(directory, ref.ID+".mp4")
	file, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return downloads.Result{}, errors.New("无法创建下载文件，请检查磁盘权限。")
	}
	limited := io.LimitReader(response.Body, 2<<30+1)
	written, copyErr := io.Copy(file, limited)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written > 2<<30 {
		return downloads.Result{}, errors.New("抖音视频下载未完成，请重试。")
	}
	info, err := os.Stat(name)
	if err != nil || info.Size() == 0 {
		return downloads.Result{}, errors.New("抖音视频下载未产生完整文件。")
	}
	return downloads.Result{FileName: filepath.Base(name), FileSize: info.Size(), OriginalSize: info.Size(), Message: "已通过应用内抖音页面下载。"}, nil
}

func douyinPlaybackURLLive(raw string, now time.Time) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	deadline := u.Query().Get("deadline")
	if deadline == "" {
		return true
	}
	value, err := strconv.ParseInt(deadline, 10, 64)
	return err == nil && value > now.Unix()
}

// Subprocess output can be large and sensitive. Retain only a bounded tail in memory.
type boundedBuffer struct {
	mu   sync.Mutex
	data []byte
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	if n > 16384 {
		p = p[n-16384:]
	}
	b.data = append(b.data, p...)
	if len(b.data) > 16384 {
		b.data = b.data[len(b.data)-16384:]
	}
	return n, nil
}
func (b *boundedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(bytes.Clone(b.data))
}
