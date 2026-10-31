package httptransport

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"

	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
)

func (h *feedsHandler) savedViewsReady(w http.ResponseWriter) bool {
	if h.feeds.SavedViews != nil {
		return true
	}
	write(w, http.StatusServiceUnavailable, apiError{"saved_views_unavailable", "保存视图暂时不可用。"})
	return false
}

func (h *feedsHandler) savedViewList(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	views, err := h.feeds.SavedViews.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, map[string]any{"views": views})
}

func (h *feedsHandler) savedViewGet(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	view, err := h.feeds.SavedViews.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, view)
}

func (h *feedsHandler) savedViewCreate(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	var input subscriptions.SavedViewInput
	if !decodeSavedView(w, r, &input) {
		return
	}
	view, err := h.feeds.SavedViews.Create(r.Context(), input)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusCreated, view)
}

func (h *feedsHandler) savedViewUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	var edit subscriptions.SavedViewEdit
	if !decodeSavedView(w, r, &edit) {
		return
	}
	view, err := h.feeds.SavedViews.Update(r.Context(), r.PathValue("id"), edit)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, view)
}

func (h *feedsHandler) savedViewDelete(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	if err := h.feeds.SavedViews.Delete(r.Context(), r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *feedsHandler) savedViewOrder(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) {
		return
	}
	var input struct {
		IDs []string `json:"ids"`
	}
	if !decodeSavedView(w, r, &input) {
		return
	}
	if err := h.feeds.SavedViews.Reorder(r.Context(), input.IDs); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *feedsHandler) savedViewInbox(w http.ResponseWriter, r *http.Request) {
	if !h.savedViewsReady(w) || h.feeds.SubscriptionInbox == nil {
		if h.feeds.SavedViews != nil && h.feeds.SubscriptionInbox == nil {
			write(w, http.StatusServiceUnavailable, apiError{"inbox_unavailable", "历史收件箱暂时不可用。"})
		}
		return
	}
	q := r.URL.Query()
	for key, values := range q {
		if key != "cursor" && key != "limit" && key != "cards" || len(values) != 1 {
			fail(w, subscriptions.ErrInboxInvalid)
			return
		}
	}
	if q.Has("cards") && q.Get("cards") != "true" {
		fail(w, subscriptions.ErrInboxInvalid)
		return
	}
	limit := subscriptions.InboxPageSize
	if q.Has("limit") {
		parsed, err := strconv.Atoi(q.Get("limit"))
		if err != nil || strconv.Itoa(parsed) != q.Get("limit") || parsed <= 0 {
			fail(w, subscriptions.ErrInboxInvalid)
			return
		}
		limit = parsed
	}
	query := h.feeds.SavedViews.Query
	if q.Get("cards") == "true" {
		if cards, ok := h.feeds.SavedViews.(interface {
			QueryCards(context.Context, string, string, int) (subscriptions.InboxPage, int, error)
		}); ok {
			query = cards.QueryCards
		}
	}
	page, count, err := query(r.Context(), r.PathValue("id"), q.Get("cursor"), limit)
	if err != nil {
		fail(w, err)
		return
	}
	if q.Get("cards") == "true" {
		for index := range page.Entries {
			page.Entries[index].Item = content.Card(page.Entries[index].Item)
		}
	}
	write(w, http.StatusOK, map[string]any{"page": page, "count": count})
}

func decodeSavedView(w http.ResponseWriter, r *http.Request, value any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		write(w, http.StatusUnsupportedMediaType, apiError{"invalid_input", "请使用 JSON 格式提交视图。"})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, subscriptions.ErrSavedViewInvalid)
		return false
	}
	return true
}
