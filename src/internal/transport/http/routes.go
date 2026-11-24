package httptransport

import "net/http"

// registerRoutes is the transport map. Each route group is registered by a
// focused method so the protocol map stays independent from handler logic.
func (h *Handler) registerRoutes(mux *http.ServeMux) {
	h.registerCoreRoutes(mux)
	h.registerAccountRoutes(mux)
	h.registerToolRoutes(mux)
	h.registerDiscoveryRoutes(mux)
	h.registerLibraryRoutes(mux)
	h.registerAIRoutes(mux)
	h.registerMediaRoutes(mux)
	h.registerPodcastRoutes(mux)
	h.registerNotesRoutes(mux)
	h.registerSubscriptionRoutes(mux)
	h.registerBackupRoutes(mux)
	h.registerSamplesRoutes(mux)
}
