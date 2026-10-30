// Package downloads owns explicit download requests and their durable lifecycle.
package downloads

import (
	"context"
	"errors"
	"sync"
	"time"

	"tangentry/internal/discovery"
)

var (
	ErrInvalid         = errors.New("invalid download request")
	ErrNotFound        = errors.New("download not found")
	ErrBusy            = errors.New("download queue full")
	ErrActive          = errors.New("download is active")
	ErrTools           = errors.New("download tools unavailable")
	ErrToolBusy        = errors.New("tool download in progress")
	ErrDouyinShortLink = errors.New("douyin short link unavailable")
)

type Job struct {
	Options
	ID              string   `json:"id"`
	URL             string   `json:"url"`
	Title           string   `json:"title"`
	ThumbnailURL    string   `json:"thumbnailUrl,omitempty"`
	Subdirectory    string   `json:"subdirectory,omitempty"`
	OutputDirectory string   `json:"outputDirectory,omitempty"`
	MaxHeight       int      `json:"maxHeight"`
	State           string   `json:"state"`
	Message         string   `json:"message,omitempty"`
	Progress        float64  `json:"progress,omitempty"`
	FileName        string   `json:"fileName,omitempty"`
	Files           []string `json:"files,omitempty"`
	FileSize        int64    `json:"fileSize,omitempty"`
	OriginalSize    int64    `json:"originalSize,omitempty"`
	Compressed      bool     `json:"compressed,omitempty"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
}

type Request struct {
	Options
	URL             string `json:"url"`
	Title           string `json:"title,omitempty"`
	ThumbnailURL    string `json:"thumbnailUrl,omitempty"`
	MaxHeight       int    `json:"maxHeight"`
	Subdirectory    string `json:"subdirectory,omitempty"`
	OutputDirectory string `json:"outputDirectory,omitempty"`
}

type Repository interface {
	ListDownloads(context.Context) ([]Job, error)
	SaveDownload(context.Context, Job) error
	GetDownload(context.Context, string) (Job, error)
	DeleteDownload(context.Context, string) error
	DeleteDownloads(context.Context, []string) error
}

type Runner interface {
	Ready() bool
	Download(context.Context, string, string, int) (string, error)
}

type ToolStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Version   string `json:"version,omitempty"`
	// Managed tools are downloaded into the app data directory on first use.
	Managed     bool   `json:"managed,omitempty"`
	Installed   bool   `json:"installed,omitempty"`
	Downloading bool   `json:"downloading,omitempty"`
	Received    int64  `json:"received,omitempty"`
	Total       int64  `json:"total,omitempty"`
	Error       string `json:"error,omitempty"`
}

type ToolReport struct {
	YouTubeRecommendation ToolStatus   `json:"youtubeRecommendation"`
	Tools                 []ToolStatus `json:"tools"`
	DownloadReady         bool         `json:"downloadReady"`
	DownloadDir           string       `json:"downloadDir"`
	CookieConfigured      bool         `json:"cookieConfigured"`
}

type Service struct {
	repo              Repository
	runner            Runner
	directory         string
	originalDirectory string
	settingsPath      string
	locations         directorySettings
	timeout           time.Duration
	ctx               context.Context
	stop              context.CancelFunc
	mu                sync.Mutex
	queue             chan string
	cancel            map[string]context.CancelFunc
	wg                sync.WaitGroup
	failure           error
	inspectSlots      chan struct{}
	observer          func(Job)
	douyinResolve     func(context.Context, string) (discovery.DouyinReference, error)
}

// SetDouyinResolver supplies the authenticated platform resolver used to turn
// v.douyin.com share locators into canonical numeric video IDs before queueing.
func (s *Service) SetDouyinResolver(resolve func(context.Context, string) (discovery.DouyinReference, error)) {
	s.mu.Lock()
	s.douyinResolve = resolve
	s.mu.Unlock()
}
