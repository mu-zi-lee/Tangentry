package httptransport

import (
	"net/http"
	"strconv"
	"strings"
	"tangentry/internal/documents"
	"time"
)

func (h *libraryHandler) documentUpload(w http.ResponseWriter, r *http.Request) {
	if h.library.Documents == nil {
		fail(w, documents.ErrUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, documents.MaxSize+(1<<20))
	if r.ParseMultipartForm(1<<20) != nil {
		fail(w, documents.ErrInvalid)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, documents.ErrInvalid)
		return
	}
	defer file.Close()
	item, err := h.library.Documents.Import(r.Context(), file, header.Filename, "http://"+r.Host+"/library")
	if err != nil {
		fail(w, err)
		return
	}
	// Importing a file is an explicit library action.
	item.URL = "http://" + r.Host + "/api/documents/" + item.PlatformID + "/file"
	saved, err := h.library.Content.Save(r.Context(), item)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 201, saved)
}
func (h *libraryHandler) documentFile(w http.ResponseWriter, r *http.Request) {
	if h.library.Documents == nil {
		fail(w, documents.ErrUnavailable)
		return
	}
	file, err := h.library.Documents.File(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		fail(w, documents.ErrUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=\"document.pdf\"")
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	http.ServeContent(w, r, "document.pdf", info.ModTime(), file)
}

// pageTextGet returns one stored PDF page so the retrieval workbench can show
// the text around a hit. It reads the same store retrieval selects from, so an
// OCR-derived document returns the recognised text (the PDF text layer is
// unusable for those files).
func (h *libraryHandler) pageTextGet(w http.ResponseWriter, r *http.Request) {
	if h.library.PageText == nil {
		write(w, http.StatusServiceUnavailable, apiError{"page_text_unavailable", "原文文本暂不可用。"})
		return
	}
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 {
		write(w, http.StatusBadRequest, apiError{"invalid_page", "页码必须是正整数。"})
		return
	}
	for key := range r.URL.Query() {
		if key != "page" {
			write(w, http.StatusBadRequest, apiError{"unexpected_query", "请求包含不支持的查询参数。"})
			return
		}
	}
	stored, total, err := h.library.PageText.PageText(r.Context(), r.PathValue("id"), page)
	if err != nil {
		write(w, http.StatusNotFound, apiError{"page_text_not_found", "这一页没有可用的原文文本。"})
		return
	}
	write(w, http.StatusOK, map[string]any{
		"page":             stored.Number,
		"text":             stored.Text,
		"totalPages":       total,
		"extractor":        stored.Extractor,
		"extractorVersion": stored.ExtractorVersion,
	})
}

func (h *libraryHandler) documentGet(w http.ResponseWriter, r *http.Request) {
	if h.library.Documents == nil {
		fail(w, documents.ErrUnavailable)
		return
	}
	item, err := h.library.Documents.Get(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	if strings.HasSuffix(item.URL, "/library") {
		item.URL = "http://" + r.Host + "/api/documents/" + item.PlatformID + "/file"
	}
	write(w, 200, item)
}
