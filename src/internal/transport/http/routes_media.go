package httptransport

import "net/http"

func (h *Handler) registerMediaRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/downloads", h.media.downloadList)
	mux.HandleFunc("DELETE /api/downloads", h.media.downloadClear)
	mux.HandleFunc("DELETE /api/downloads/{id}", h.media.downloadDelete)
	mux.HandleFunc("POST /api/downloads", h.media.downloadStart)
	mux.HandleFunc("POST /api/downloads/info", h.media.downloadInfo)
	mux.HandleFunc("GET /api/downloads/{id}/files/{name...}", h.media.downloadArtifact)
	mux.HandleFunc("POST /api/downloads/{id}/cancel", h.media.downloadCancel)
	mux.HandleFunc("GET /api/downloads/{id}/file", h.media.downloadFile)
	mux.HandleFunc("GET /api/downloads/{id}/media", h.media.downloadMedia)
	mux.HandleFunc("GET /api/media/audio", h.media.audioProxy)
	mux.HandleFunc("GET /api/subtitles/bilibili", h.media.subtitleRead)
	mux.HandleFunc("GET /api/subtitles/youtube", h.media.youtubeSubtitleRead)
	mux.HandleFunc("GET /api/saved-subtitles", h.media.savedSubtitleList)
	mux.HandleFunc("PUT /api/saved-subtitles/{contentId}/{language}", h.media.savedSubtitleSave)
	mux.HandleFunc("DELETE /api/saved-subtitles/{contentId}/{language}", h.media.savedSubtitleDelete)
	mux.HandleFunc("POST /api/playback/bilibili/{id}", h.media.playbackOpen)
	mux.HandleFunc("POST /api/playback/douyin/{id}", h.media.douyinPlaybackOpen)
	mux.HandleFunc("GET /api/playback/sessions/{id}/media", h.media.playbackMedia)
	mux.HandleFunc("POST /api/playback/sessions/{id}/diagnostics", h.media.playbackDiagnostics)
	mux.HandleFunc("DELETE /api/playback/sessions/{id}", h.media.playbackRelease)
	mux.HandleFunc("POST /api/playback/compatibility", h.media.compatibilityOpen)
	mux.HandleFunc("GET /api/playback/compatibility/{id}", h.media.compatibilityGet)
	mux.HandleFunc("GET /api/playback/compatibility/{id}/media", h.media.compatibilityMedia)
	mux.HandleFunc("DELETE /api/playback/compatibility/{id}", h.media.compatibilityRelease)
}
