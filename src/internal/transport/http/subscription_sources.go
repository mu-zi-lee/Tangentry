package httptransport

import (
	"context"
	"errors"
	"net/http"

	"tangentry/internal/content"
	"tangentry/internal/subscriptions"
)

func subscriptionCardMode(w http.ResponseWriter, r *http.Request) (bool, bool) {
	query := r.URL.Query()
	values, cards := query["cards"]
	if len(query) != 0 && (!cards || len(query) != 1 || len(values) != 1 || values[0] != "true") {
		fail(w, subscriptions.ErrInvalid)
		return false, false
	}
	return cards, true
}

func projectSubscriptionCards(detail *subscriptions.Detail) {
	for index := range detail.Items {
		detail.Items[index] = content.Card(detail.Items[index])
	}
}

type subscriptionBatchRequest struct {
	Action          string   `json:"action"`
	IDs             []string `json:"ids"`
	GroupID         string   `json:"groupId"`
	ExpectedGroupID string   `json:"expectedGroupId"`
	Enabled         *bool    `json:"enabled"`
	IntervalSeconds int64    `json:"intervalSeconds"`
}

func (h *feedsHandler) subscriptionBatch(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	var input subscriptionBatchRequest
	if !decodeSubscription(w, r, &input) {
		return
	}
	var (
		results []subscriptions.BatchResult
		err     error
	)
	switch input.Action {
	case "delete":
		results, err = h.feeds.Subscriptions.BatchDelete(r.Context(), input.IDs)
	case "group":
		results, err = h.feeds.Subscriptions.BatchAssignGroup(r.Context(), input.IDs, input.GroupID, input.ExpectedGroupID)
	case "refresh-policy":
		if input.Enabled == nil {
			fail(w, subscriptions.ErrInvalid)
			return
		}
		results, err = h.feeds.Subscriptions.BatchConfigureRefresh(r.Context(), input.IDs, subscriptions.RefreshPolicy{Enabled: *input.Enabled, IntervalSeconds: input.IntervalSeconds})
	case "update":
		results, err = h.feeds.Subscriptions.BatchUpdate(r.Context(), input.IDs)
	default:
		fail(w, subscriptions.ErrInvalid)
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	type item struct {
		ID     string                `json:"id"`
		OK     bool                  `json:"ok"`
		Source *subscriptions.Source `json:"source,omitempty"`
		Detail *subscriptions.Detail `json:"detail,omitempty"`
		Error  string                `json:"error,omitempty"`
	}
	out := make([]item, 0, len(results))
	failed := 0
	for _, result := range results {
		entry := item{ID: result.ID, OK: result.Err == nil, Source: result.Source, Detail: result.Detail}
		if result.Err != nil {
			failed++
			entry.Error = result.Err.Error()
			if errors.Is(result.Err, context.Canceled) {
				entry.Error = "canceled"
			}
		}
		out = append(out, entry)
	}
	write(w, http.StatusOK, map[string]any{"results": out, "failed": failed})
}

func (h *feedsHandler) subscriptionList(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	items, err := h.feeds.Subscriptions.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"sources": items})
}

func (h *feedsHandler) subscriptionGet(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	cards, valid := subscriptionCardMode(w, r)
	if !valid {
		return
	}
	get := h.feeds.Subscriptions.Get
	if cards {
		if service, ok := h.feeds.Subscriptions.(interface {
			GetCards(context.Context, string) (subscriptions.Detail, error)
		}); ok {
			get = service.GetCards
		}
	}
	detail, err := get(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	if cards {
		projectSubscriptionCards(&detail)
	}
	write(w, 200, detail)
}

func (h *feedsHandler) subscriptionCreate(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	var input subscriptions.Input
	if !decodeSubscription(w, r, &input) {
		return
	}
	source, created, err := h.feeds.Subscriptions.Create(r.Context(), input)
	if err != nil {
		fail(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	write(w, status, map[string]any{"source": source, "created": created})
}

func (h *feedsHandler) subscriptionRename(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	var input subscriptions.Edit
	if !decodeSubscription(w, r, &input) {
		return
	}
	source, err := h.feeds.Subscriptions.Rename(r.Context(), r.PathValue("id"), input)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, source)
}

func (h *feedsHandler) subscriptionAddress(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	var input subscriptions.AddressEdit
	if len(r.URL.Query()) != 0 || !decodeSubscription(w, r, &input) {
		if len(r.URL.Query()) != 0 {
			fail(w, subscriptions.ErrInvalid)
		}
		return
	}
	source, err := h.feeds.Subscriptions.EditAddress(r.Context(), r.PathValue("id"), input)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, source)
}

func (h *feedsHandler) subscriptionUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	cards, valid := subscriptionCardMode(w, r)
	if !valid {
		return
	}
	detail, err := h.feeds.Subscriptions.Update(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	if cards {
		projectSubscriptionCards(&detail)
	}
	write(w, 200, detail)
}

func (h *feedsHandler) subscriptionDelete(w http.ResponseWriter, r *http.Request) {
	if !h.subscriptionReady(w) {
		return
	}
	if err := h.feeds.Subscriptions.Delete(r.Context(), r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}
