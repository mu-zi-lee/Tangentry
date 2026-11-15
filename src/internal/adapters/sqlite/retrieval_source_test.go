package sqlite

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/content"
	"tangentry/internal/retrieval"
	"tangentry/internal/subtitles"
)

const goldB02 = "【B-BASE-02 黄金答案】字幕中段目标：cue 索引 2999。"

// subtitleFixtureB02 reproduces the B-BASE-02 baseline fixture: 6,000 cues,
// gold at cue 2,999, 144,011 runes joined with "\n" (docs/evidence/b-baseline.md).
func subtitleFixtureB02(t *testing.T) subtitles.Track {
	t.Helper()
	cues := make([]subtitles.Cue, 6000)
	total := 0
	for i := range cues {
		text := fmt.Sprintf("第 %04d 条字幕内容，用于构造长转录文本。", i)
		if i == 2999 {
			text = goldB02
		}
		cues[i] = subtitles.Cue{Start: float64(i * 2), End: float64(i*2) + 1.9, Text: text}
		total += retrieval.RuneLen(text)
	}
	total += len(cues) - 1 // newlines
	if total != 144011 {
		t.Fatalf("fixture total = %d, want 144011", total)
	}
	return subtitles.Track{Language: "zh", Label: "中文", Source: "cc", Cues: cues}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "retrieval.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

// TestBT03_SubtitleMiddleCue: fixed 144,011-rune subtitle fixture with the
// gold cue group at cue 2,999; the selected passage carries source=subtitle,
// language, cue IDs and cue range; the exact cue text is present once.
func TestBT03_SubtitleMiddleCue(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	const id = "bilibili:BV17x411w7KC"
	item := content.Item{
		ID: id, Platform: "bilibili", PlatformID: "BV17x411w7KC",
		Kind: "video", Title: "字幕中段测试", SavedAt: 100,
	}
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}
	track := subtitleFixtureB02(t)
	if _, err := store.SaveSubtitles(ctx, subtitles.SavedTrack{ContentID: id, Track: track, SavedAt: 100}, 0); err != nil {
		t.Fatal(err)
	}

	src := NewRetrievalSource(store)
	snap, err := src.Snapshot(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Kind != retrieval.SourceSubtitle || len(snap.Tracks) != 1 || len(snap.Tracks[0].Cues) != 6000 {
		t.Fatalf("snapshot = kind %s tracks %d", snap.Kind, len(snap.Tracks))
	}

	sel := retrieval.NewSelector(src, nil, retrieval.SelectorConfig{
		TopK: 100, Weights: retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes,
	})
	got, err := sel.Select(ctx, id, "中段目标 cue 索引 2999", 0)
	if err != nil {
		t.Fatal(err)
	}
	var gold *retrieval.Passage
	for i := range got.Passages {
		if strings.Contains(got.Passages[i].Text, goldB02) {
			gold = &got.Passages[i]
			break
		}
	}
	if gold == nil {
		t.Fatalf("gold cue group not selected (status=%s passages=%d)", got.Status, len(got.Passages))
	}
	if gold.Source != retrieval.SourceSubtitle {
		t.Fatalf("source = %s, want subtitle", gold.Source)
	}
	if gold.Locator != "subtitle:zh:2992-2999" {
		t.Fatalf("locator = %s, want subtitle:zh:2992-2999", gold.Locator)
	}
	if gold.SourceVersion != "content-revision:1" {
		t.Fatalf("version = %s, want content-revision:1", gold.SourceVersion)
	}
	foundID := false
	for _, cueID := range gold.CueIDs {
		if cueID == "zh:2999" {
			foundID = true
		}
	}
	if !foundID || len(gold.CueIDs) != 8 {
		t.Fatalf("cue IDs lost: %v", gold.CueIDs)
	}
	if strings.Count(gold.Text, goldB02) != 1 {
		t.Fatal("exact gold cue text must be present once")
	}
	if gold.TextSHA256 != retrieval.TextSHA256(gold.Text) {
		t.Fatal("hash mismatch")
	}
	// INV-05: the adapter re-read verifies the selected passage.
	kept, dropped, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{*gold})
	if err != nil || len(kept) != 1 || len(dropped) != 0 {
		t.Fatalf("verification: kept=%d dropped=%+v err=%v", len(kept), dropped, err)
	}
}

// TestBT19_StaleAfterUpdate (storage half): after the source is updated, the
// old revision is stale; old text is never presented as current; a fresh
// selection carries the new revision.
func TestBT19_StaleAfterUpdate(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	const id = "bilibili:BV17x411w7KC"
	item := versionTestItem(id, "第一版证据文本。")
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}
	src := NewRetrievalSource(store)
	cfg := retrieval.SelectorConfig{
		TopK: 100, Weights: retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes,
	}
	sel := retrieval.NewSelector(src, nil, cfg)
	got, err := sel.Select(ctx, id, "证据文本", 0)
	if err != nil || len(got.Passages) == 0 {
		t.Fatalf("first selection: %+v %v", got, err)
	}
	old := got.Passages[0]
	if old.SourceVersion != "content-revision:1" {
		t.Fatalf("old version = %s", old.SourceVersion)
	}

	// Update the source: revision increments, hash replaced.
	item.ArticleBlocks[0].Text = "第二版证据文本。"
	updated, err := store.Save(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ContentRevision != 2 {
		t.Fatalf("revision = %d, want 2", updated.ContentRevision)
	}

	// The old reference is stale, never current evidence.
	kept, dropped, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{old})
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 0 || len(dropped) != 1 || dropped[0].Reason != retrieval.DropStaleSource {
		t.Fatalf("old reference must be stale_source: kept=%d dropped=%+v", len(kept), dropped)
	}
	// A fresh selection carries the new revision and the new text.
	got2, err := sel.Select(ctx, id, "证据文本", 0)
	if err != nil || len(got2.Passages) == 0 {
		t.Fatalf("second selection: %+v %v", got2, err)
	}
	fresh := got2.Passages[0]
	if fresh.SourceVersion != "content-revision:2" || !strings.Contains(fresh.Text, "第二版") {
		t.Fatalf("fresh passage = %+v", fresh)
	}
	for _, p := range got2.Passages {
		if strings.Contains(p.Text, "第一版") {
			t.Fatal("old text presented as current evidence")
		}
	}
}

// TestBT28_RevisionInvalidation (revision part; PDF hash part is phase 3):
// a content revision change invalidates old passage references; the new
// selection uses the new revision and the old version/hash never verify.
func TestBT28_RevisionInvalidation(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	const id = "bilibili:BV17x411w7KC"
	item := versionTestItem(id, "原始答案文本。")
	saved1, err := store.Save(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	src := NewRetrievalSource(store)
	cfg := retrieval.SelectorConfig{
		TopK: 100, Weights: retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes,
	}
	sel := retrieval.NewSelector(src, nil, cfg)
	got1, err := sel.Select(ctx, id, "答案文本", 0)
	if err != nil || len(got1.Passages) == 0 {
		t.Fatalf("selection 1: %+v %v", got1, err)
	}
	oldPassage := got1.Passages[0]

	item.ArticleBlocks[0].Text = "替换后的答案文本。"
	saved2, err := store.Save(ctx, item)
	if err != nil {
		t.Fatal(err)
	}
	if saved2.ContentRevision != saved1.ContentRevision+1 {
		t.Fatalf("revision must increment: %d -> %d", saved1.ContentRevision, saved2.ContentRevision)
	}
	if saved2.ContentHash == saved1.ContentHash {
		t.Fatal("content hash must change with the text")
	}
	got2, err := sel.Select(ctx, id, "答案文本", 0)
	if err != nil || len(got2.Passages) == 0 {
		t.Fatalf("selection 2: %+v %v", got2, err)
	}
	newPassage := got2.Passages[0]
	if newPassage.SourceVersion == oldPassage.SourceVersion {
		t.Fatal("new selection must use the new revision")
	}
	// Old reference invalid; new reference verifies.
	kept, dropped, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{oldPassage, newPassage})
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 1 || kept[0].ID != newPassage.ID || len(dropped) != 1 || dropped[0].Reason != retrieval.DropStaleSource {
		t.Fatalf("kept=%d dropped=%+v, want only the new passage kept", len(kept), dropped)
	}
}

// TestRetrievalSourceDiscussionAndReadRange: discussion snapshots and
// ReadRange re-reads through the adapter; unknown content is not found.
func TestRetrievalSourceDiscussionAndReadRange(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	const id = "linuxdo:12345"
	item := content.Item{
		ID: id, Platform: "linuxdo", PlatformID: "12345",
		Kind: "article", Title: "讨论", SavedAt: 100,
		Discussion: &content.Discussion{Posts: []content.DiscussionPost{
			{Number: 1, Blocks: []content.ArticleBlock{{Kind: "paragraph", Text: "楼主的第一句话。"}}},
			{Number: 2, Blocks: []content.ArticleBlock{{Kind: "paragraph", Text: "回复的关键证据。"}}},
		}},
	}
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}
	src := NewRetrievalSource(store)
	snap, err := src.Snapshot(ctx, id)
	if err != nil || snap.Kind != retrieval.SourceDiscussion || len(snap.Posts) != 2 {
		t.Fatalf("discussion snapshot: %+v %v", snap, err)
	}
	text, version, err := src.ReadRange(ctx, id, retrieval.DiscussionLocator(1, 0, 0, 1), 0, 8)
	if err != nil || text != "回复的关键证据。" || version != "content-revision:1" {
		t.Fatalf("ReadRange: %q %q %v", text, version, err)
	}
	if _, _, err := src.ReadRange(ctx, id, retrieval.DiscussionLocator(99, 0, 0, 1), 0, 8); err == nil {
		t.Fatal("forged post index must fail")
	}
	if _, err := src.Snapshot(ctx, "bilibili:BV0000000000"); err == nil {
		t.Fatal("unknown content must fail")
	}
}
