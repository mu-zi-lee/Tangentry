package httptransport

import "net/http"

func (h *Handler) registerSamplesRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/samples", h.samples.samplesStatusGet)
	mux.HandleFunc("PUT /api/samples", h.samples.samplesSettingsPut)
	mux.HandleFunc("POST /api/samples/load", h.samples.samplesLoad)
	mux.HandleFunc("DELETE /api/samples", h.samples.samplesRemove)
}
