package httptransport

import (
	"io/fs"

	"tangentry/internal/preferences"
)

type Handler struct {
	accounts      *accountsHandler
	discovery     *discoveryHandler
	library       *libraryHandler
	ai            *aiHandler
	media         *mediaHandler
	transcription *transcriptionHandler
	podcast       *podcastHandler
	notes         *notesHandler
	feeds         *feedsHandler
	backup        *backupHandler
	preferences   preferences.Store
	assets        fs.FS
}

// Feature handlers keep each HTTP module's dependency surface local. Handler
// only owns protocol-wide middleware and joins these modules to stable routes.
type accountsHandler struct{ accounts AccountDependencies }
type discoveryHandler struct {
	browse    DiscoveryDependencies
	browsing  chan struct{}
	importing chan struct{}
}
type libraryHandler struct{ library LibraryDependencies }
type aiHandler struct{ ai AIDependencies }
type mediaHandler struct {
	media     MediaDependencies
	audioHTTP HTTPClient
}
type transcriptionHandler struct {
	ai AIDependencies
}
type podcastHandler struct {
	podcast  PodcastDependencies
	browsing chan struct{}
}
type notesHandler struct{ notes NoteDependencies }
type feedsHandler struct{ feeds SubscriptionDependencies }
type requestLimits struct {
	browsing  chan struct{}
	importing chan struct{}
}
