package app

import (
	"context"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	httptransport "tangentry/internal/transport/http"
)

// httpDependencies exposes only the feature-specific ports prepared by the
// composition root. Transport code never traverses the application registry.
func httpDependencies(w httpWiring) httptransport.Dependencies { return w.dependencies }

func httpAccountDependencies(adapters httpAdapterBundle) httptransport.AccountDependencies {
	return adapters.accounts
}

func httpDiscoveryDependencies(s *services, adapters httpAdapterBundle) httptransport.DiscoveryDependencies {
	p := s.adapters.discovery
	search := discovery.NewSearchService(s.features.content.Page, map[string]discovery.SearchProvider{
		"bilibili":    p.bilibili,
		"youtube":     youtubeSearchProvider{toolkit: s.adapters.network.toolkit},
		"linuxdo":     p.forum,
		"xiaoyuzhou":  p.podcasts,
		"xiaohongshu": p.notes,
		"douyin":      p.douyin,
	})
	// Subscription snapshots are part of the local search surface. They are
	// merged after the FTS-backed library query so saved and subscribed content
	// share one local result group without changing the library repository.
	search.Subscribed = s.features.sources.Gallery
	search.Creators = map[string]discovery.CreatorSearchProvider{
		"bilibili":   p.bilibili,
		"youtube":    p.youtube,
		"linuxdo":    p.forum,
		"xiaoyuzhou": p.podcasts,
	}
	return httptransport.DiscoveryDependencies{
		Search: discovery.NewService(p.creators), UnifiedSearch: search, BilibiliBrowser: adapters.bilibiliBrowser,
		RecommendationConfig: s.features.api.preferences, RecommendationQueue: s.features.recommendations.queue,
		RecommendationPage: s.features.recommendations.Page, Imports: s.imports.importSource,
		LinuxdoPosts: func(ctx context.Context, id string, postIDs []int64) (content.Discussion, error) {
			return s.adapters.discovery.forum.TopicPosts(ctx, id, postIDs)
		},
		DiscoveryBatch:        s.features.discoveryBatch,
		DiscoveryFeedback:     s.features.discoveryFeedback,
		DiscoveryTopics:       discovery.NewTopicRules(s.runtime.store),
		XiaohongshuDetail:     s.runtime.repositories.xiaohongshu.XiaohongshuDetail,
		XiaohongshuImageItems: s.runtime.repositories.xiaohongshu.XiaohongshuImageCandidates,
		XiaohongshuImages:     adapters.imageCache, XiaohongshuImageVersion: adapters.imageVersion,
		XiaohongshuRefresh: s.imports.refreshXiaohongshu,
		PaperImport:        s.imports.importSource,
	}
}

type youtubeSearchProvider struct {
	toolkit interface {
		YouTubeSearch(context.Context, string, string) (discovery.SearchPage, error)
	}
}

func (p youtubeSearchProvider) Search(ctx context.Context, query, cursor string) (discovery.SearchPage, error) {
	return p.toolkit.YouTubeSearch(ctx, query, cursor)
}

func httpLibraryDependencies(s *services) httptransport.LibraryDependencies {
	return httptransport.LibraryDependencies{
		Content: s.features.content, Documents: s.runtime.documents, Articles: s.features.articles, ArticleImageHTTP: s.adapters.network.public,
	}
}

func httpAIDependencies(s *services) httptransport.AIDependencies {
	var languageAI httptransport.AIService
	if s.features.api.ai != nil {
		languageAI = s.features.api.ai
	}
	return httptransport.AIDependencies{AI: languageAI, Transcription: s.features.transcription, ModelDownloads: s.features.modelDownloads, Automatic: s.features.automaticSubtitles}
}

func httpPodcastDependencies(s *services, adapters httpAdapterBundle, episodeID func(context.Context, string) string) httptransport.PodcastDependencies {
	return httptransport.PodcastDependencies{
		Captions:       adapters.podcastCaptions,
		EpisodeID:      episodeID,
		PublicCaptions: adapters.publicPodcastCaptions,
		SavedSubtitles: s.features.api.savedSubtitles, Inbox: s.features.api.inbox, Content: s.features.content,
	}
}

func httpMediaDependencies(s *services, adapters httpAdapterBundle) httptransport.MediaDependencies {
	var compatibility httptransport.CompatibilityService
	if s.features.api.compatibility != nil {
		compatibility = s.features.api.compatibility
	}
	return httptransport.MediaDependencies{
		Subtitles: s.features.api.subtitles, SavedSubtitles: s.features.api.savedSubtitles, Downloads: s.features.downloads,
		ToolStatus: adapters.toolStatus, UpdateYTDLP: adapters.updateYTDLP,
		Playback: s.features.api.playback, Compatibility: compatibility, AudioHTTP: s.adapters.network.audio,
	}
}

func httpNoteDependencies(s *services) httptransport.NoteDependencies {
	return httptransport.NoteDependencies{
		Notes: s.features.api.notes, NoteFrames: s.features.api.noteFrames, NoteExports: s.features.api.noteExports,
		ReadState: s.features.api.readState, History: s.features.api.history, Progress: s.features.api.progress,
	}
}

func httpSubscriptionDependencies(s *services) httptransport.SubscriptionDependencies {
	return httptransport.SubscriptionDependencies{
		Subscriptions: s.features.sources, SubscriptionGroups: s.features.api.groupService,
		SubscriptionInbox: s.features.api.inbox, Favorites: s.features.api.favorites,
		SavedViews: s.features.api.savedViews,
	}
}
