package httptransport

import (
	"net/http"
	"strconv"

	"tangentry/internal/subscriptions"
)

func (h *feedsHandler) inboxList(w http.ResponseWriter, r *http.Request) {
	if h.feeds.SubscriptionInbox == nil {
		write(w, 503, apiError{"inbox_unavailable", "历史收件箱暂时不可用。"})
		return
	}
	q := r.URL.Query()
	for key, values := range q {
		if len(values) != 1 {
			fail(w, subscriptions.ErrInboxInvalid)
			return
		}
		switch key {
		case "q", "sourceId", "groupId", "platform", "kind", "topic", "tag", "read", "favorite", "since", "until", "cursor", "limit", "cards":
		default:
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
	favorite := false
	if q.Has("favorite") {
		parsed, err := strconv.ParseBool(q.Get("favorite"))
		if err != nil {
			fail(w, subscriptions.ErrInboxInvalid)
			return
		}
		favorite = parsed
	}
	parseTime := func(key string) (int64, bool) {
		if !q.Has(key) {
			return 0, true
		}
		value, err := strconv.ParseInt(q.Get(key), 10, 64)
		return value, err == nil
	}
	since, sinceOK := parseTime("since")
	until, untilOK := parseTime("until")
	if !sinceOK || !untilOK {
		fail(w, subscriptions.ErrInboxInvalid)
		return
	}
	page, err := h.feeds.SubscriptionInbox.List(r.Context(), subscriptions.InboxQuery{Query: q.Get("q"), SourceID: q.Get("sourceId"), GroupID: q.Get("groupId"), Platform: q.Get("platform"), Kind: q.Get("kind"), Topic: q.Get("topic"), Tag: q.Get("tag"), Read: q.Get("read"), Favorite: favorite, Since: since, Until: until, Cursor: q.Get("cursor"), Limit: limit, Cards: q.Get("cards") == "true"})
	if err != nil {
		fail(w, err)
		return
	}
	count, err := h.feeds.SubscriptionInbox.Count(r.Context(), subscriptions.InboxQuery{Query: q.Get("q"), SourceID: q.Get("sourceId"), GroupID: q.Get("groupId"), Platform: q.Get("platform"), Kind: q.Get("kind"), Topic: q.Get("topic"), Tag: q.Get("tag"), Read: q.Get("read"), Favorite: favorite, Since: since, Until: until})
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"page": page, "count": count})
}
func (h *feedsHandler) inboxItem(w http.ResponseWriter, r *http.Request) {
	if h.feeds.SubscriptionInbox == nil {
		write(w, 503, apiError{"inbox_unavailable", "历史收件箱暂时不可用。"})
		return
	}
	item, err := h.feeds.SubscriptionInbox.Item(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, item)
}
