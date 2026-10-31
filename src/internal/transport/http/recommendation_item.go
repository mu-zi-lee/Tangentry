package httptransport

import (
	"context"
	"net/http"

	"tangentry/internal/content"
	"tangentry/internal/discovery"
)

func (h *discoveryHandler) recommendationItem(w http.ResponseWriter, r *http.Request) {
	reader, ok := h.browse.RecommendationQueue.(interface {
		Item(context.Context, string, string) (content.Item, error)
	})
	if !ok {
		fail(w, discovery.ErrUnavailable)
		return
	}
	item, err := reader.Item(r.Context(), r.PathValue("source"), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, http.StatusOK, item)
}
