package httptransport

import (
	"context"

	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/documents"
	"tangentry/internal/downloads"
	"tangentry/internal/preferences"
	"tangentry/internal/subscriptions"
	"tangentry/internal/subtitles"
)

// Options is retained for focused HTTP handler tests. Application wiring uses
// Dependencies so each feature receives only its own collaborators.
type Options struct {
	Preferences             preferences.Store
	BilibiliBrowser         BilibiliBrowser
	LinuxdoLogin            BrowserLoginFlow[LinuxdoState]
	LinuxdoSession          func(context.Context) (LinuxdoSession, error)
	BilibiliLogin           LoginFlow[QRLoginState]
	XiaoyuzhouLogin         LoginFlow[QRLoginState]
	PodcastCaptions         func(context.Context, string) (subtitles.Document, error)
	PodcastEpisodeID        func(context.Context, string) string
	PublicPodcastCaptions   func(context.Context, content.Item) (subtitles.Document, error)
	RecommendationQueue     RecommendationQueue
	RecommendationConfig    RecommendationConfig
	AI                      AIService
	NoteExports             NoteExportService
	NoteFrames              NoteFrameService
	Articles                ArticleService
	ReadState               ReadStateService
	Favorites               FavoriteService
	ModelDownloads          ModelDownloadService
	Transcription           TranscriptionService
	Automatic               AutomaticSubtitleService
	Playback                PlaybackService
	Compatibility           CompatibilityService
	AudioHTTP               HTTPClient
	Recommendations         func(context.Context, string) (discovery.Feed, error)
	RecommendationPage      func(context.Context, string, int) (discovery.Feed, error)
	DiscoveryBatch          DiscoveryBatchService
	DiscoveryFeedback       DiscoveryFeedbackService
	DiscoveryTopics         DiscoveryTopicService
	Documents               documents.Service
	Imports                 func(context.Context, string, string) (discovery.Feed, error)
	LinuxdoPosts            func(context.Context, string, []int64) (content.Discussion, error)
	XiaohongshuDetail       func(context.Context, string) (content.Item, bool, error)
	XiaohongshuRefresh      func(context.Context, string, string) (content.Item, error)
	XiaohongshuImages       ImageCache
	XiaohongshuImageVersion func(string) string
	XiaohongshuImageItems   func(context.Context, string) ([]content.Item, error)
	ArticleImageHTTP        HTTPClient
	Cookies                 CredentialStore
	SavedSubtitles          SavedSubtitleService
	Progress                ProgressService
	Downloads               DownloadService
	ToolStatus              func() downloads.ToolReport
	UpdateYTDLP             func() error
	Subtitles               SubtitleService
	Notes                   NoteService
	Subscriptions           SubscriptionService
	History                 HistoryService
	SubscriptionGroups      GroupService
	SubscriptionInbox       InboxService
	SavedViews              SavedViewService
	Backup                  BackupService
}

type SavedViewService interface {
	List(context.Context) ([]subscriptions.SavedView, error)
	Get(context.Context, string) (subscriptions.SavedView, error)
	Query(context.Context, string, string, int) (subscriptions.InboxPage, int, error)
	Create(context.Context, subscriptions.SavedViewInput) (subscriptions.SavedView, error)
	Update(context.Context, string, subscriptions.SavedViewEdit) (subscriptions.SavedView, error)
	Delete(context.Context, string) error
	Reorder(context.Context, []string) error
}

type Dependencies struct {
	Preferences preferences.Store
	Accounts    AccountDependencies
	Browse      DiscoveryDependencies
	Library     LibraryDependencies
	AI          AIDependencies
	Podcast     PodcastDependencies
	Media       MediaDependencies
	Notes       NoteDependencies
	Feeds       SubscriptionDependencies
	Backup      BackupService
}

type AccountDependencies struct {
	BilibiliLogin   LoginFlow[QRLoginState]
	XiaoyuzhouLogin LoginFlow[QRLoginState]
	LinuxdoLogin    BrowserLoginFlow[LinuxdoState]
	LinuxdoSession  func(context.Context) (LinuxdoSession, error)
	Cookies         CredentialStore
}

type DiscoveryDependencies struct {
	Search                  DiscoveryService
	UnifiedSearch           UnifiedSearchService
	BilibiliBrowser         BilibiliBrowser
	RecommendationQueue     RecommendationQueue
	RecommendationConfig    RecommendationConfig
	Recommendations         func(context.Context, string) (discovery.Feed, error)
	RecommendationPage      func(context.Context, string, int) (discovery.Feed, error)
	DiscoveryBatch          DiscoveryBatchService
	DiscoveryFeedback       DiscoveryFeedbackService
	DiscoveryTopics         DiscoveryTopicService
	Imports                 func(context.Context, string, string) (discovery.Feed, error)
	LinuxdoPosts            func(context.Context, string, []int64) (content.Discussion, error)
	XiaohongshuDetail       func(context.Context, string) (content.Item, bool, error)
	XiaohongshuRefresh      func(context.Context, string, string) (content.Item, error)
	XiaohongshuImages       ImageCache
	XiaohongshuImageVersion func(string) string
	XiaohongshuImageItems   func(context.Context, string) ([]content.Item, error)
	PaperImport             func(context.Context, string, string) (discovery.Feed, error)
}

type LibraryDependencies struct {
	Content          ContentService
	Articles         ArticleService
	ArticleImageHTTP HTTPClient
	Documents        documents.Service
}

type AIDependencies struct {
	AI             AIService
	Transcription  TranscriptionService
	ModelDownloads ModelDownloadService
	Automatic      AutomaticSubtitleService
}

type MediaDependencies struct {
	Subtitles      SubtitleService
	SavedSubtitles SavedSubtitleService
	Downloads      DownloadService
	ToolStatus     func() downloads.ToolReport
	UpdateYTDLP    func() error
	Playback       PlaybackService
	Compatibility  CompatibilityService
	AudioHTTP      HTTPClient
}

// PodcastDependencies isolates transcript acquisition from general media
// playback/download operations. This keeps the podcast endpoint from gaining
// an accidental dependency on the entire media or library surface.
type PodcastDependencies struct {
	Captions       func(context.Context, string) (subtitles.Document, error)
	EpisodeID      func(context.Context, string) string
	PublicCaptions func(context.Context, content.Item) (subtitles.Document, error)
	SavedSubtitles SavedSubtitleService
	Inbox          InboxService
	Content        ContentService
}

type NoteDependencies struct {
	Notes       NoteService
	NoteFrames  NoteFrameService
	NoteExports NoteExportService
	ReadState   ReadStateService
	History     HistoryService
	Progress    ProgressService
}

type SubscriptionDependencies struct {
	Subscriptions      SubscriptionService
	SubscriptionGroups GroupService
	SubscriptionInbox  InboxService
	SavedViews         SavedViewService
	Favorites          FavoriteService
}
