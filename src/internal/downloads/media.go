package downloads

import (
	"context"
	"net"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"tangentry/internal/discovery"
)

type Options struct {
	Mode               string   `json:"mode,omitempty"`
	Container          string   `json:"container,omitempty"`
	VideoOnly          bool     `json:"videoOnly,omitempty"`
	AudioFormat        string   `json:"audioFormat,omitempty"`
	VideoFormatID      string   `json:"videoFormatId,omitempty"`
	AudioFormatID      string   `json:"audioFormatId,omitempty"`
	SubtitleLanguages  []string `json:"subtitleLanguages,omitempty"`
	AutomaticSubtitles bool     `json:"automaticSubtitles,omitempty"`
	DownloadDanmaku    bool     `json:"downloadDanmaku,omitempty"`
	DownloadThumbnail  bool     `json:"downloadThumbnail,omitempty"`
	DownloadInfoJSON   bool     `json:"downloadInfoJSON,omitempty"`
	Compress           bool     `json:"compress,omitempty"`
}

type Format struct {
	ID           string  `json:"id"`
	Ext          string  `json:"ext"`
	Height       int     `json:"height"`
	Width        int     `json:"width"`
	FPS          float64 `json:"fps"`
	VideoCodec   string  `json:"videoCodec"`
	AudioCodec   string  `json:"audioCodec"`
	AudioBitrate float64 `json:"audioBitrate"`
	FileSize     int64   `json:"fileSize"`
	Approximate  bool    `json:"approximate"`
}

type Subtitle struct {
	Language  string `json:"language"`
	Label     string `json:"label"`
	Automatic bool   `json:"automatic"`
}

type MediaInfo struct {
	URL          string     `json:"url"`
	Title        string     `json:"title"`
	Author       string     `json:"author"`
	ThumbnailURL string     `json:"thumbnailUrl"`
	Duration     float64    `json:"duration"`
	Extractor    string     `json:"extractor"`
	Formats      []Format   `json:"formats"`
	Subtitles    []Subtitle `json:"subtitles"`
}

type Result struct {
	FileName     string
	Message      string
	FileSize     int64
	OriginalSize int64
	Compressed   bool
}

type MediaRunner interface {
	Inspect(context.Context, string) (MediaInfo, error)
	DownloadMedia(context.Context, string, string, int, Options) (Result, error)
}

// ProgressMediaRunner is implemented by download tools that can report the
// percentage emitted by their underlying media downloader.
type ProgressMediaRunner interface {
	MediaRunner
	DownloadMediaProgress(context.Context, string, string, int, Options, func(float64)) (Result, error)
}

var formatIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
var subtitleLanguagePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,48}$`)

func (o *Options) Normalize() error {
	if o.Mode == "" {
		o.Mode = "video"
	}
	if o.Container == "" {
		o.Container = "mp4"
	}
	if o.AudioFormat == "" {
		o.AudioFormat = "best"
	}
	if !slices.Contains([]string{"video", "audio"}, o.Mode) ||
		!slices.Contains([]string{"mp4", "mkv"}, o.Container) ||
		!slices.Contains([]string{"best", "mp3", "m4a", "flac", "wav", "opus"}, o.AudioFormat) {
		return ErrInvalid
	}
	for _, id := range []string{o.VideoFormatID, o.AudioFormatID} {
		if id != "" && !formatIDPattern.MatchString(id) {
			return ErrInvalid
		}
	}
	if len(o.SubtitleLanguages) > 32 {
		return ErrInvalid
	}
	for _, language := range o.SubtitleLanguages {
		if !subtitleLanguagePattern.MatchString(language) || language == "live_chat" || language == "danmaku" {
			return ErrInvalid
		}
	}
	o.SubtitleLanguages = slices.Clone(o.SubtitleLanguages)
	slices.Sort(o.SubtitleLanguages)
	o.SubtitleLanguages = slices.Compact(o.SubtitleLanguages)
	if slices.Contains(o.SubtitleLanguages, "all") {
		o.SubtitleLanguages = []string{"all"}
	}
	if o.Mode == "audio" {
		o.VideoOnly, o.Compress, o.VideoFormatID = false, false, ""
	}
	if o.VideoOnly {
		o.AudioFormatID = ""
	}
	return nil
}

func SameOptions(a, b Options) bool {
	_ = a.Normalize()
	_ = b.Normalize()
	return a.Mode == b.Mode && a.Container == b.Container && a.VideoOnly == b.VideoOnly &&
		a.AudioFormat == b.AudioFormat && a.VideoFormatID == b.VideoFormatID && a.AudioFormatID == b.AudioFormatID &&
		a.AutomaticSubtitles == b.AutomaticSubtitles && a.DownloadDanmaku == b.DownloadDanmaku && a.DownloadThumbnail == b.DownloadThumbnail && a.DownloadInfoJSON == b.DownloadInfoJSON && a.Compress == b.Compress &&
		slices.Equal(a.SubtitleLanguages, b.SubtitleLanguages)
}

func (o *Options) normalize() error { return o.Normalize() }

func sameOptions(a, b Options) bool { return SameOptions(a, b) }

// Preserve known platform identities, and signed query parameters on other sites.
func NormalizeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 {
		return "", ErrInvalid
	}
	if _, _, canonical, err := discovery.VideoURL(raw); err == nil {
		return canonical, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Opaque != "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.Hostname() == "" || strings.ContainsAny(raw, "\r\n\t ") {
		return "", ErrInvalid
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || !strings.Contains(host, ".") && net.ParseIP(host) == nil {
		return "", ErrInvalid
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsMulticast()) {
		return "", ErrInvalid
	}
	u.Fragment = ""
	return u.String(), nil
}

func sameURL(a, b string) bool { return a == b || discovery.SameVideo(a, b) }

func (s *Service) Inspect(ctx context.Context, raw string) (MediaInfo, error) {
	canonical, err := NormalizeURL(raw)
	if err != nil {
		return MediaInfo{}, err
	}
	runner, ok := s.runner.(MediaRunner)
	if !ok {
		return MediaInfo{}, ErrTools
	}
	// Bound concurrent extraction without blocking download cancellation.
	select {
	case s.inspectSlots <- struct{}{}:
		defer func() { <-s.inspectSlots }()
	default:
		return MediaInfo{}, ErrBusy
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	info, err := runner.Inspect(ctx, canonical)
	info.URL = canonical
	return info, err
}
