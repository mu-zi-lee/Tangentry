package httptransport

import "net/http"

func (h *Handler) registerLibraryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/library", h.library.list)
	mux.HandleFunc("GET /api/library/{id}", h.library.libraryItem)
	mux.HandleFunc("POST /api/library", h.library.save)
	mux.HandleFunc("DELETE /api/library/{id}", h.library.remove)
	mux.HandleFunc("GET /api/articles/{id}", h.library.articleGet)
	mux.HandleFunc("POST /api/articles/{id}/fetch", h.library.articleFetch)
	mux.HandleFunc("GET /api/articles/image", h.library.articleImage)
	mux.HandleFunc("POST /api/documents", h.library.documentUpload)
	mux.HandleFunc("GET /api/documents/{id}", h.library.documentGet)
	mux.HandleFunc("GET /api/library/{id}/page-text", h.library.pageTextGet)
	mux.HandleFunc("GET /api/documents/{id}/file", h.library.documentFile)
}
