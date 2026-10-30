package httptransport

import (
	"io/fs"
	"net/http"

	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/netpolicy"
)

func New(library *content.Service, discover *discovery.Service, assets fs.FS, options ...Options) http.Handler {
	var optionsValue Options
	if len(options) > 0 {
		optionsValue = options[0]
	}
	return NewWithDependencies(Dependencies{
		Accounts: AccountDependencies{
			BilibiliLogin: optionsValue.BilibiliLogin, XiaoyuzhouLogin: optionsValue.XiaoyuzhouLogin,
			LinuxdoLogin: optionsValue.LinuxdoLogin, LinuxdoSession: optionsValue.LinuxdoSession, Cookies: optionsValue.Cookies,
		},
		Preferences: optionsValue.Preferences,
		Browse: DiscoveryDependencies{
			Search: discover, BilibiliBrowser: optionsValue.BilibiliBrowser, RecommendationQueue: optionsValue.RecommendationQueue,
			RecommendationConfig: optionsValue.RecommendationConfig, Recommendations: optionsValue.Recommendations,
			RecommendationPage: optionsValue.RecommendationPage, Imports: optionsValue.Imports,
			DiscoveryBatch:    optionsValue.DiscoveryBatch,
			DiscoveryFeedback: optionsValue.DiscoveryFeedback,
			DiscoveryTopics:   optionsValue.DiscoveryTopics,
			XiaohongshuDetail: optionsValue.XiaohongshuDetail, XiaohongshuRefresh: optionsValue.XiaohongshuRefresh,
			XiaohongshuImages: optionsValue.XiaohongshuImages, XiaohongshuImageVersion: optionsValue.XiaohongshuImageVersion,
			XiaohongshuImageItems: optionsValue.XiaohongshuImageItems,
		},
		Library: LibraryDependencies{Content: library, Articles: optionsValue.Articles, ArticleImageHTTP: optionsValue.ArticleImageHTTP, Documents: optionsValue.Documents},
		AI:      AIDependencies{AI: optionsValue.AI, Transcription: optionsValue.Transcription, ModelDownloads: optionsValue.ModelDownloads, Automatic: optionsValue.Automatic},
		Podcast: PodcastDependencies{Captions: optionsValue.PodcastCaptions, EpisodeID: optionsValue.PodcastEpisodeID, PublicCaptions: optionsValue.PublicPodcastCaptions, SavedSubtitles: optionsValue.SavedSubtitles, Inbox: optionsValue.SubscriptionInbox, Content: library},
		Media: MediaDependencies{
			Subtitles: optionsValue.Subtitles, SavedSubtitles: optionsValue.SavedSubtitles,
			Downloads: optionsValue.Downloads, ToolStatus: optionsValue.ToolStatus, UpdateYTDLP: optionsValue.UpdateYTDLP,
			Playback: optionsValue.Playback, Compatibility: optionsValue.Compatibility, AudioHTTP: optionsValue.AudioHTTP,
		},
		Notes: NoteDependencies{
			Notes: optionsValue.Notes, NoteFrames: optionsValue.NoteFrames, NoteExports: optionsValue.NoteExports,
			ReadState: optionsValue.ReadState, History: optionsValue.History, Progress: optionsValue.Progress,
		},
		Feeds: SubscriptionDependencies{
			SubscriptionGroups: optionsValue.SubscriptionGroups, SubscriptionInbox: optionsValue.SubscriptionInbox, Favorites: optionsValue.Favorites,
			Subscriptions: optionsValue.Subscriptions, SavedViews: optionsValue.SavedViews,
		},
		Backup: optionsValue.Backup,
	}, assets)
}

func NewWithDependencies(deps Dependencies, assets fs.FS) http.Handler {
	limits := &requestLimits{browsing: make(chan struct{}, 4), importing: make(chan struct{}, 2)}
	if deps.Library.ArticleImageHTTP == nil {
		deps.Library.ArticleImageHTTP = netpolicy.NewClient()
	}
	if deps.Media.AudioHTTP == nil {
		deps.Media.AudioHTTP = netpolicy.NewStreamingClient()
	}
	h := &Handler{
		accounts:      &accountsHandler{accounts: deps.Accounts},
		discovery:     &discoveryHandler{browse: deps.Browse, browsing: limits.browsing, importing: limits.importing},
		library:       &libraryHandler{library: deps.Library},
		ai:            &aiHandler{ai: deps.AI},
		media:         &mediaHandler{media: deps.Media, audioHTTP: deps.Media.AudioHTTP},
		transcription: &transcriptionHandler{ai: deps.AI},
		podcast:       &podcastHandler{podcast: deps.Podcast, browsing: limits.browsing},
		notes:         &notesHandler{notes: deps.Notes},
		feeds:         &feedsHandler{feeds: deps.Feeds},
		backup:        &backupHandler{service: deps.Backup},
		preferences:   deps.Preferences,
		assets:        assets,
	}
	mux := http.NewServeMux()
	h.registerRoutes(mux)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		write(w, http.StatusNotFound, apiError{"not_found", "没有找到这个接口。"})
	})
	mux.HandleFunc("/", h.static)
	return securityHeaders(mux)
}
