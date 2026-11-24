package app

import (
	"context"
	"io/fs"
	"net/http"

	httptransport "tangentry/internal/transport/http"
)

// httpWiring is the narrow composition-root view needed to expose the HTTP
// protocol. Keeping this boundary explicit prevents handlers from depending on
// the entire application services registry.
type httpWiring struct{ dependencies httptransport.Dependencies }

func newHTTPWiring(s *services) httpWiring {
	adapters := newHTTPAdapterBundle(s.adapters, s.features.downloads)
	return httpWiring{dependencies: httptransport.Dependencies{
		Preferences: s.runtime.preferences,
		Accounts:    httpAccountDependencies(adapters),
		Browse:      httpDiscoveryDependencies(s, adapters),
		Library:     httpLibraryDependencies(s),
		AI:          httpAIDependencies(s),
		Podcast: httpPodcastDependencies(s, adapters, func(ctx context.Context, id string) string {
			return podcastEpisodeID(ctx, s.features.api.inbox, s.features.content, id)
		}),
		Media:   httpMediaDependencies(s, adapters),
		Notes:   httpNoteDependencies(s),
		Feeds:   httpSubscriptionDependencies(s),
		Backup:  s.runtime.backup,
		Samples: s.features.api.samples,
	}}
}

// newHTTPHandler is the only place where domain services become an HTTP API.
// Desktop and headless entry points therefore share the same protocol surface
// without making domain packages depend on net/http.
func newHTTPHandler(w httpWiring, assets fs.FS) http.Handler {
	return httptransport.NewWithDependencies(httpDependencies(w), assets)
}
