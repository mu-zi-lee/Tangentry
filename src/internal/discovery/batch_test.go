package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"time"

	"tangentry/internal/content"
)

type batchProvider struct {
	feeds    map[string]Feed
	pages    map[string]map[int]Feed
	failures map[string]error
}

type slowBatchProvider struct {
	quick content.Item
}

type blockingContinuationProvider struct{}

type batchProviderFunc func(context.Context, string, int) (Feed, error)

func (f batchProviderFunc) Fetch(ctx context.Context, source string, page int) (Feed, error) {
	return f(ctx, source, page)
}

func (blockingContinuationProvider) Fetch(ctx context.Context, source string, _ int) (Feed, error) {
	if source == "douyin" {
		<-ctx.Done()
		return Feed{}, ctx.Err()
	}
	return Feed{}, nil
}

func (p slowBatchProvider) Fetch(ctx context.Context, source string, _ int) (Feed, error) {
	if source == "slow" {
		<-ctx.Done()
		return Feed{}, ctx.Err()
	}
	return Feed{Items: []content.Item{p.quick}}, nil
}

func (p batchProvider) Fetch(_ context.Context, source string, page int) (Feed, error) {
	if err := p.failures[source]; err != nil {
		return Feed{}, err
	}
	if pages := p.pages[source]; pages != nil {
		return pages[page], nil
	}
	return p.feeds[source], nil
}

type batchSnapshots struct {
	values map[string][]byte
	keys   map[string]string
}

func (r *batchSnapshots) PutDiscoveryBatch(_ context.Context, id, key string, payload []byte, _ int64) error {
	if r.values == nil {
		r.values = map[string][]byte{}
		r.keys = map[string]string{}
	}
	r.values[id], r.keys[id] = payload, key
	return nil
}
func (r *batchSnapshots) GetDiscoveryBatch(_ context.Context, id, key string, _ int64) ([]byte, error) {
	if r.keys[id] != key {
		return nil, errors.New("wrong request key")
	}
	return r.values[id], nil
}

func batchItem(platform, platformID, title, author string, published int64) content.Item {
	return content.Item{ID: platform + ":" + platformID, Platform: platform, PlatformID: platformID, Kind: "video", Title: title, Author: author, URL: "https://example.com/" + platformID, ThumbnailURL: "https://example.com/thumb/" + platformID, PublishedAt: published}
}

func TestBatchIsDeterministicAndDeduplicatesWithSourceHealth(t *testing.T) {
	snapshots := &batchSnapshots{}
	service := NewBatchService(batchProvider{feeds: map[string]Feed{
		"bilibili": {Items: []content.Item{batchItem("bilibili", "BV17x411w7KC", "订阅重复", "作者", 5), batchItem("bilibili", "BV1xx411w7KC", "新视频", "作者2", 4)}},
		"youtube":  {Items: []content.Item{batchItem("youtube", "abcdefghijk", "跨来源重复", "作者3", 3)}},
	}, failures: map[string]error{"douyin": ErrUnavailable}}, func(context.Context) (Feed, error) {
		return Feed{Items: []content.Item{batchItem("bilibili", "BV17x411w7KC", "订阅重复", "作者", 6), batchItem("rss", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "订阅文章", "作者4", 2)}}, nil
	}, []string{"bilibili", "youtube", "douyin"}, snapshots)
	request := BatchRequest{View: "wander", Size: 10, Seed: 42, SubscriptionRatio: 60, ExplorationRatio: 15}
	first, err := service.Create(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Create(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if first.BatchID != second.BatchID || len(first.Items) != len(second.Items) {
		t.Fatalf("batch is not deterministic: %#v %#v", first, second)
	}
	if first.SourceStatus["douyin"].Status != "unavailable" {
		t.Fatalf("source failure was not preserved: %#v", first.SourceStatus)
	}
	seen := map[string]bool{}
	for _, item := range first.Items {
		if seen[item.Item.ID] {
			t.Fatalf("duplicate item %s", item.Item.ID)
		}
		seen[item.Item.ID] = true
	}
}

func TestBatchPreservesPlatformErrorDetails(t *testing.T) {
	want := &PlatformError{Message: "Linux.do 触发 Cloudflare 验证，请重新验证。", Restricted: true}
	service := NewBatchService(batchProvider{failures: map[string]error{"linuxdo": want}}, nil, []string{"linuxdo"})
	response, err := service.Create(context.Background(), BatchRequest{})
	if err != nil {
		t.Fatal(err)
	}
	status := response.SourceStatus["linuxdo"]
	if status.Status != "unavailable" || status.Message != want.Message || !status.Restricted || !status.RequiresVerification {
		t.Fatalf("platform details were lost: %#v", status)
	}
}

func TestBatchCanRequestLocalSubscriptionsOnly(t *testing.T) {
	service := NewBatchService(batchProvider{feeds: map[string]Feed{
		"bilibili": {Items: []content.Item{batchItem("bilibili", "remote", "推荐", "作者", 2)}},
	}}, func(context.Context) (Feed, error) {
		return Feed{Items: []content.Item{batchItem("rss", "local", "我的订阅", "播客", 3)}}, nil
	}, []string{"bilibili"})
	response, err := service.Create(context.Background(), BatchRequest{Source: "subscriptions", Size: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 1 || response.Items[0].Source != "subscriptions" {
		t.Fatalf("subscriptions-only batch = %#v", response.Items)
	}
}

func TestBatchCursorReadsPersistedSnapshotAndEnds(t *testing.T) {
	snapshots := &batchSnapshots{}
	service := NewBatchService(batchProvider{feeds: map[string]Feed{"bilibili": {Items: []content.Item{
		batchItem("bilibili", "BV17x411w7KC", "一", "a", 3), batchItem("bilibili", "BV1xx411w7KC", "二", "b", 2), batchItem("bilibili", "BV2xx411w7KC", "三", "c", 1),
	}}}, failures: map[string]error{}}, nil, []string{"bilibili"}, snapshots)
	service.clock = func() time.Time { return time.UnixMilli(1000) }
	first, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 9})
	if err != nil {
		t.Fatal(err)
	}
	if first.HasNextBatch || first.EndReason != "暂时没有更多了" {
		t.Fatalf("short candidate pool should end: %#v", first)
	}
	_ = first
}

func TestBatchContinuesAfterEmptyPageWithContinuation(t *testing.T) {
	snapshots := &batchSnapshots{}
	provider := batchProvider{pages: map[string]map[int]Feed{
		"bilibili": {
			1: {Items: []content.Item{batchItem("bilibili", "first", "首批", "作者", 2)}, HasMore: true},
			2: {Items: nil, HasMore: true},
			3: {Items: []content.Item{batchItem("bilibili", "third", "续页", "作者", 1)}, HasMore: false},
		},
	}}
	service := NewBatchService(provider, nil, []string{"bilibili"}, snapshots)
	first, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 12})
	if err != nil || !first.HasNextBatch || first.NextCursor == "" {
		t.Fatalf("first page lost continuation: %#v, err=%v", first, err)
	}
	second, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 12, Cursor: first.NextCursor})
	if err != nil || len(second.Items) != 1 || second.Items[0].Item.ID != "bilibili:third" || second.HasNextBatch {
		t.Fatalf("empty continuation page did not advance to next source page: %#v, err=%v", second, err)
	}
}

func TestBatchContinuationBoundsDuplicatePagesAndRetainsNextPage(t *testing.T) {
	item := batchItem("bilibili", "existing", "已有内容", "作者", 1)
	var pages []int
	service := NewBatchService(batchProviderFunc(func(_ context.Context, _ string, page int) (Feed, error) {
		pages = append(pages, page)
		if page <= maxContinuationPagesPerSource+1 {
			return Feed{Items: []content.Item{item}, HasMore: true}, nil
		}
		return Feed{Items: []content.Item{batchItem("bilibili", "new", "新内容", "作者", 1)}}, nil
	}), nil, []string{"bilibili"})
	snapshot := batchSnapshot{
		Candidates: []batchCandidate{{Item: item, Source: "bilibili"}},
		Status:     map[string]BatchSourceStatus{}, NextPages: map[string]int{"bilibili": 2}, Exhausted: map[string]bool{"bilibili": false},
	}
	if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 1); err != nil {
		t.Fatal(err)
	}
	if len(pages) != maxContinuationPagesPerSource || snapshot.NextPages["bilibili"] != 2+maxContinuationPagesPerSource || snapshot.Exhausted["bilibili"] {
		t.Fatalf("unbounded or lost duplicate-page continuation: pages=%v snapshot=%+v", pages, snapshot)
	}
	if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 1); err != nil {
		t.Fatal(err)
	}
	if len(pages) != maxContinuationPagesPerSource+1 || len(snapshot.Candidates) != 2 || snapshot.Candidates[1].Item.ID != "bilibili:new" {
		t.Fatalf("bounded request failed to resume at next source page: pages=%v candidates=%+v", pages, snapshot.Candidates)
	}
}

func TestBatchContinuationHasRequestWideFetchBudget(t *testing.T) {
	var calls []string
	item := batchItem("bilibili", "existing", "已有内容", "作者", 1)
	service := NewBatchService(batchProviderFunc(func(_ context.Context, source string, page int) (Feed, error) {
		calls = append(calls, source+":"+strconv.Itoa(page))
		return Feed{Items: []content.Item{item}, HasMore: true}, nil
	}), nil, []string{"bilibili", "youtube", "xiaohongshu", "linuxdo"})
	snapshot := batchSnapshot{
		Candidates: []batchCandidate{{Item: item, Source: "bilibili"}},
		Status:     map[string]BatchSourceStatus{},
		NextPages:  map[string]int{"bilibili": 2, "youtube": 2, "xiaohongshu": 2, "linuxdo": 2},
		Exhausted:  map[string]bool{"bilibili": false, "youtube": false, "xiaohongshu": false, "linuxdo": false},
	}
	if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 1); err != nil {
		t.Fatal(err)
	}
	if len(calls) != maxContinuationFetchesPerBatch {
		t.Fatalf("continuation exceeded request budget: calls=%d want=%d (%v)", len(calls), maxContinuationFetchesPerBatch, calls)
	}
	if len(calls) > 4 {
		t.Fatalf("one scroll fetched more than four platform pages: %v", calls)
	}
	if snapshot.Exhausted["linuxdo"] || snapshot.NextPages["linuxdo"] == 0 {
		t.Fatalf("budgeted source lost its continuation: %+v", snapshot)
	}
}

func TestBatchContinuationRotatesBudgetAcrossSources(t *testing.T) {
	var calls []string
	sources := []string{"bilibili", "youtube", "xiaohongshu", "linuxdo", "xiaoyuzhou", "douyin", "huggingface"}
	service := NewBatchService(batchProviderFunc(func(_ context.Context, source string, _ int) (Feed, error) {
		calls = append(calls, source)
		return Feed{HasMore: true}, nil
	}), nil, sources)
	snapshot := batchSnapshot{Status: map[string]BatchSourceStatus{}, NextPages: map[string]int{}, Exhausted: map[string]bool{}}
	for request := 0; request < len(sources); request++ {
		before := len(calls)
		if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 0); err != nil {
			t.Fatal(err)
		}
		if count := len(calls) - before; count > 4 || count == 0 {
			t.Fatalf("invalid continuation work: calls=%v", calls[before:])
		}
		// Source rotation must survive the same persistence boundary as a cursor.
		payload, err := json.Marshal(snapshot)
		if err != nil {
			t.Fatal(err)
		}
		if err := unmarshalBatchSnapshot(payload, &snapshot); err != nil {
			t.Fatal(err)
		}
	}
	for _, source := range sources {
		found := false
		for _, called := range calls {
			found = found || called == source
		}
		if !found {
			t.Fatalf("source %q starved behind duplicate pages: %v", source, calls)
		}
	}
}

func TestBatchContinuationOnlyFetchesSourcesWithoutBufferedCandidates(t *testing.T) {
	var calls []string
	service := NewBatchService(batchProviderFunc(func(_ context.Context, source string, _ int) (Feed, error) {
		calls = append(calls, source)
		return Feed{Items: []content.Item{batchItem(source, "next", "新内容", "作者", 1)}}, nil
	}), nil, []string{"bilibili", "youtube"})
	snapshot := batchSnapshot{
		Candidates: []batchCandidate{
			{Item: batchItem("youtube", "read", "已浏览", "作者", 1), Source: "youtube"},
			{Item: batchItem("bilibili", "buffered", "待浏览", "作者", 1), Source: "bilibili"},
		},
		Status: map[string]BatchSourceStatus{}, NextPages: map[string]int{"bilibili": 2, "youtube": 2}, Exhausted: map[string]bool{"bilibili": false, "youtube": false},
	}
	if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 1); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || calls[0] != "youtube" || snapshot.NextPages["bilibili"] != 2 {
		t.Fatalf("refetched a buffered source: calls=%v pages=%v", calls, snapshot.NextPages)
	}
}

func TestBatchContinuationStopsOnRequestCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	service := NewBatchService(batchProviderFunc(func(context.Context, string, int) (Feed, error) {
		calls++
		cancel()
		return Feed{HasMore: true}, nil
	}), nil, []string{"bilibili", "youtube"})
	snapshot := batchSnapshot{Status: map[string]BatchSourceStatus{}, NextPages: map[string]int{}, Exhausted: map[string]bool{"bilibili": false, "youtube": false}}
	if err := service.extendSnapshot(ctx, BatchRequest{Size: 10}, &snapshot, 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation was swallowed: %v", err)
	}
	if calls != 1 || len(snapshot.NextPages) != 0 {
		t.Fatalf("canceled request continued fetching or advanced cursor: calls=%d pages=%v", calls, snapshot.NextPages)
	}
	if err := service.extendSnapshot(ctx, BatchRequest{Size: 10}, &snapshot, 0); !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("already canceled request fetched another page: calls=%d err=%v", calls, err)
	}
}

func TestBatchEndReasonNamesUnavailableSources(t *testing.T) {
	service := NewBatchService(batchProvider{failures: map[string]error{"youtube": ErrUnavailable}}, nil, []string{"youtube"})
	response, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 13})
	if err != nil {
		t.Fatal(err)
	}
	if response.EndReason != "部分来源暂不可用（YouTube），暂时没有更多了" {
		t.Fatalf("empty response should not claim a source-specific end reason: %#v", response)
	}

	snapshot := batchSnapshot{Candidates: []batchCandidate{{Item: batchItem("bilibili", "one", "一", "作者", 1), Source: "bilibili"}}, Status: map[string]BatchSourceStatus{"youtube": {Status: "unavailable"}}, Exhausted: map[string]bool{"bilibili": true, "youtube": true}}
	page := service.page(BatchRequest{Size: 10}, "key", batchCursor{BatchID: "batch"}, snapshot)
	if page.EndReason != "部分来源暂不可用（YouTube），暂时没有更多了" {
		t.Fatalf("source failure was not included in end reason: %#v", page)
	}
}

func TestBatchUsesDefaultsWhenOptionsAreOmitted(t *testing.T) {
	service := NewBatchService(batchProvider{feeds: map[string]Feed{
		"bilibili": {Items: []content.Item{batchItem("bilibili", "BV17x411w7KC", "默认", "作者", 1)}},
	}}, nil, []string{"bilibili"})
	response, err := service.Create(context.Background(), BatchRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 1 || response.Reason == "" {
		t.Fatalf("omitted options were not defaulted: %#v", response)
	}
}

func TestBatchSlowSourceDoesNotBlockFirstBatch(t *testing.T) {
	service := NewBatchService(slowBatchProvider{quick: batchItem("bilibili", "fast", "快速来源", "作者", 1)}, nil, []string{"bilibili", "slow"})
	service.initialSourceTimeout = 20 * time.Millisecond
	started := time.Now()
	response, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 13})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("slow source blocked first batch for %s", elapsed)
	}
	if len(response.Items) != 1 || response.Items[0].Source != "bilibili" {
		t.Fatalf("fast source missing from first batch: %#v", response.Items)
	}
	if status := response.SourceStatus["slow"]; status.Status != "loading" {
		t.Fatalf("slow source was not marked loading: %#v", response.SourceStatus)
	}
	if !response.HasNextBatch || response.NextCursor == "" {
		t.Fatalf("loading source did not preserve continuation: %#v", response)
	}
}

func TestDouyinSourceKeepsWebViewBudgetSeparateFromFastSources(t *testing.T) {
	service := NewBatchService(batchProvider{}, nil, []string{"douyin"})
	if got := service.initialTimeout("douyin"); got != douyinInitialSourceTimeout {
		t.Fatalf("douyin initial timeout = %s, want %s", got, douyinInitialSourceTimeout)
	}
	if got := service.sourceTimeout("douyin"); got != douyinBackgroundSourceTimeout {
		t.Fatalf("douyin continuation timeout = %s, want %s", got, douyinBackgroundSourceTimeout)
	}
	if got := service.continuationTimeout("douyin"); got != douyinContinuationTimeout {
		t.Fatalf("douyin continuation timeout = %s, want %s", got, douyinContinuationTimeout)
	}
	if got := service.initialTimeout("bilibili"); got != defaultInitialSourceTimeout {
		t.Fatalf("default initial timeout = %s, want %s", got, defaultInitialSourceTimeout)
	}
}

func TestDouyinContinuationTimeoutMarksLoadingWithoutLongBlock(t *testing.T) {
	service := NewBatchService(blockingContinuationProvider{}, nil, []string{"douyin"})
	service.continuationTimeoutOverride = 15 * time.Millisecond
	snapshot := batchSnapshot{Candidates: []batchCandidate{{Item: batchItem("douyin", "6961737553342991651", "已有内容", "作者", 1), Source: "douyin"}}, Status: map[string]BatchSourceStatus{}, NextPages: map[string]int{"douyin": 2}, Exhausted: map[string]bool{"douyin": false}}
	started := time.Now()
	if err := service.extendSnapshot(context.Background(), BatchRequest{Size: 10}, &snapshot, 1); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("continuation blocked too long: %s", elapsed)
	}
	if snapshot.Status["douyin"].Status != "loading" || snapshot.Exhausted["douyin"] {
		t.Fatalf("continuation timeout did not preserve loading state: %+v", snapshot)
	}
}

func TestBatchRoundRobinsSourcesAndCapsRuns(t *testing.T) {
	feeds := map[string]Feed{
		"bilibili": {Items: make([]content.Item, 0, 8)},
		"youtube":  {Items: make([]content.Item, 0, 5)},
	}
	bilibiliItems := feeds["bilibili"].Items
	for index := 0; index < 8; index++ {
		bilibiliItems = append(bilibiliItems, batchItem("bilibili", "b"+strconv.Itoa(index), "B站", "b", int64(100-index)))
	}
	feeds["bilibili"] = Feed{Items: bilibiliItems}
	youtubeItems := feeds["youtube"].Items
	for index := 0; index < 5; index++ {
		youtubeItems = append(youtubeItems, batchItem("youtube", "y"+strconv.Itoa(index), "YouTube", "y", int64(90-index)))
	}
	feeds["youtube"] = Feed{Items: youtubeItems}
	service := NewBatchService(batchProvider{feeds: feeds}, func(context.Context) (Feed, error) {
		items := make([]content.Item, 0, 12)
		for index := 0; index < 12; index++ {
			items = append(items, batchItem("rss", "s"+strconv.Itoa(index), "订阅", "s", int64(120-index)))
		}
		return Feed{Items: items}, nil
	}, []string{"bilibili", "youtube"})
	response, err := service.Create(context.Background(), BatchRequest{Size: 15, Seed: 77, SubscriptionRatio: 60, ExplorationRatio: 15})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 15 {
		t.Fatalf("expected a full page, got %d", len(response.Items))
	}
	counts := map[string]int{}
	last, streak := "", 0
	for _, item := range response.Items {
		counts[item.Source]++
		if item.Source == last {
			streak++
		} else {
			last, streak = item.Source, 1
		}
		if streak > 2 {
			t.Fatalf("source %q appeared %d times consecutively: %#v", item.Source, streak, response.Items)
		}
	}
	if counts["subscriptions"] != 5 || counts["bilibili"] != 5 || counts["youtube"] != 5 {
		t.Fatalf("round-robin distribution was not balanced: %#v", counts)
	}
}

func TestBatchContinuesRoundRobinAfterSourcesNeedNextPage(t *testing.T) {
	snapshots := &batchSnapshots{}
	bilibiliFirst := make([]content.Item, 0, 6)
	youtubeFirst := make([]content.Item, 0, 6)
	bilibiliSecond := make([]content.Item, 0, 6)
	youtubeSecond := make([]content.Item, 0, 6)
	for index := 0; index < 6; index++ {
		bilibiliFirst = append(bilibiliFirst, batchItem("bilibili", "b1-"+strconv.Itoa(index), "B1", "b", int64(40-index)))
		youtubeFirst = append(youtubeFirst, batchItem("youtube", "y1-"+strconv.Itoa(index), "Y1", "y", int64(39-index)))
		bilibiliSecond = append(bilibiliSecond, batchItem("bilibili", "b2-"+strconv.Itoa(index), "B2", "b", int64(20-index)))
		youtubeSecond = append(youtubeSecond, batchItem("youtube", "y2-"+strconv.Itoa(index), "Y2", "y", int64(19-index)))
	}
	service := NewBatchService(batchProvider{pages: map[string]map[int]Feed{
		"bilibili": {
			1: {Items: bilibiliFirst, HasMore: true},
			2: {Items: bilibiliSecond, HasMore: false},
		},
		"youtube": {
			1: {Items: youtubeFirst, HasMore: true},
			2: {Items: youtubeSecond, HasMore: false},
		},
	}}, nil, []string{"bilibili", "youtube"}, snapshots)
	first, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 88})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 10 || first.Items[0].Source == first.Items[1].Source {
		t.Fatalf("first page should interleave sources: %#v cursor=%q hasNext=%v", first.Items, first.NextCursor, first.HasNextBatch)
	}
	if first.NextCursor == "" {
		t.Fatalf("expected continuation cursor: %#v", first)
	}
	second, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 88, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 2 || second.Items[0].Source == second.Items[1].Source {
		t.Fatalf("extended page should continue interleaving sources: %#v cursor=%q hasNext=%v", second.Items, second.NextCursor, second.HasNextBatch)
	}
}

func TestBatchAppliesFeedbackWithoutBreakingSourceRotation(t *testing.T) {
	service := NewBatchService(batchProvider{feeds: map[string]Feed{
		"bilibili": {Items: []content.Item{batchItem("bilibili", "b1", "一", "creator", 3), batchItem("bilibili", "b2", "二", "other", 2)}},
		"youtube":  {Items: []content.Item{batchItem("youtube", "y1", "三", "creator", 3), batchItem("youtube", "y2", "四", "other", 2)}},
	}}, nil, []string{"bilibili", "youtube"})
	service.SetFeedback(func(context.Context) ([]Feedback, error) {
		return []Feedback{
			{Type: FeedbackHide, Target: TargetItem, Value: "youtube:y2"},
			{Type: FeedbackMore, Target: TargetCreator, Value: "creator"},
		}, nil
	})
	response, err := service.Create(context.Background(), BatchRequest{Size: 10, Seed: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 3 || response.Items[0].Item.Author != "creator" || response.Items[0].Reason != "因你选择想多看看：creator" {
		t.Fatalf("feedback ordering/reason: %#v", response.Items)
	}
	for _, item := range response.Items {
		if item.Item.ID == "youtube:y2" {
			t.Fatal("hidden item leaked")
		}
	}
	if response.Items[0].Source == response.Items[1].Source {
		t.Fatalf("source rotation broken: %#v", response.Items)
	}
}
