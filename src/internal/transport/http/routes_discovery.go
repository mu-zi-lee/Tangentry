package httptransport

import "net/http"

func (h *Handler) registerDiscoveryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/discovery/batch", h.discovery.batch)
	mux.HandleFunc("GET /api/discovery/feedback", h.discovery.feedbackList)
	mux.HandleFunc("POST /api/discovery/feedback", h.discovery.feedbackSave)
	mux.HandleFunc("DELETE /api/discovery/feedback/{id}", h.discovery.feedbackDelete)
	mux.HandleFunc("DELETE /api/discovery/feedback", h.discovery.feedbackClear)
	mux.HandleFunc("GET /api/discovery/topics", h.discovery.topicList)
	mux.HandleFunc("POST /api/discovery/topics", h.discovery.topicCreate)
	mux.HandleFunc("PATCH /api/discovery/topics/{id}", h.discovery.topicUpdate)
	mux.HandleFunc("DELETE /api/discovery/topics/{id}", h.discovery.topicDelete)
	mux.HandleFunc("GET /api/discovery/bilibili", h.discovery.search)
	mux.HandleFunc("GET /api/search", h.discovery.unifiedSearch)
	mux.HandleFunc("GET /api/search/creator/{platform}/{id}", h.discovery.creator)
	mux.HandleFunc("GET /api/discovery/{source}", h.discovery.importSearch)
	mux.HandleFunc("POST /api/papers/import", h.discovery.paperImport)
	mux.HandleFunc("GET /api/discovery/linuxdo/posts", h.discovery.linuxdoPosts)
	mux.HandleFunc("GET /api/recommendations/{source}", h.discovery.recommendationRead)
	mux.HandleFunc("GET /api/recommendations/{source}/pending", h.discovery.recommendationPending)
	mux.HandleFunc("GET /api/recommendations/{source}/items/{id}", h.discovery.recommendationItem)
	mux.HandleFunc("PUT /api/recommendations/{source}/marks", h.discovery.recommendationMark)
	mux.HandleFunc("GET /api/settings/recommendations", h.discovery.recommendationSettingsRead)
	mux.HandleFunc("PUT /api/settings/recommendations/{source}", h.discovery.recommendationSettingsSave)
	mux.HandleFunc("GET /api/bilibili/browse/{kind}", h.discovery.bilibiliBrowse)
	mux.HandleFunc("GET /api/bilibili/profile", h.discovery.bilibiliProfile)
	mux.HandleFunc("GET /api/xiaohongshu/details/{id}", h.discovery.xiaohongshuDetailRead)
	mux.HandleFunc("POST /api/xiaohongshu/details/{id}/refresh", h.discovery.xiaohongshuDetailRefresh)
	mux.HandleFunc("GET /api/xiaohongshu/images/{id}/{version}", h.discovery.xiaohongshuImageRead)
}
