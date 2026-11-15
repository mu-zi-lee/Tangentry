package retrieval

import (
	"strings"
	"testing"
)

// TestSnapshotHashDeterminism: the normalized snapshot hash is deterministic,
// insensitive to whitespace/line-ending-only edits, sensitive to text edits,
// and independent of the version/contentID fields (B-T38 hash half).
func TestSnapshotHashDeterminism(t *testing.T) {
	snap := Snapshot{
		ContentID: "fixture:hash",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks: []Block{
			{Index: 0, Kind: "paragraph", Text: "第一段证据文本。"},
			{Index: 1, Kind: "paragraph", Text: "第二段证据文本。"},
		},
	}
	h1 := SnapshotHash(snap)
	if len(h1) != 64 || strings.ToLower(h1) != h1 {
		t.Fatalf("hash must be 64 lowercase hex: %q", h1)
	}
	if SnapshotHash(snap) != h1 {
		t.Fatal("hash is not deterministic")
	}
	// Version and contentID are excluded (no circularity).
	snap2 := snap
	snap2.Version = "content-revision:99"
	snap2.ContentID = "fixture:other"
	if SnapshotHash(snap2) != h1 {
		t.Fatal("hash must not depend on version/contentID")
	}
	// Whitespace/line-ending normalization only.
	snap3 := snap
	snap3.Blocks = []Block{
		{Index: 0, Kind: "paragraph", Text: "第一段证据文本。\r\n"},
		{Index: 1, Kind: "paragraph", Text: "  第二段证据文本。  "},
	}
	if SnapshotHash(snap3) != h1 {
		t.Fatal("whitespace-only edit must not change the normalized hash")
	}
	// Real text edit changes the hash.
	snap4 := snap
	snap4.Blocks = append([]Block(nil), snap.Blocks...)
	snap4.Blocks[0].Text = "修改后的证据文本。"
	if SnapshotHash(snap4) == h1 {
		t.Fatal("text edit must change the hash")
	}
	// Case is preserved (case-only edit changes the hash).
	snap5 := snap
	snap5.Blocks = []Block{{Index: 0, Kind: "paragraph", Text: "ABC text."}, {Index: 1, Kind: "paragraph", Text: "第二段证据文本。"}}
	snap6 := snap5
	snap6.Blocks = []Block{{Index: 0, Kind: "paragraph", Text: "abc text."}, {Index: 1, Kind: "paragraph", Text: "第二段证据文本。"}}
	if SnapshotHash(snap5) == SnapshotHash(snap6) {
		t.Fatal("case-only edit must change the hash (case preserved)")
	}
}

// TestSnapshotRange: exact re-read of article/discussion/subtitle/PDF ranges
// from a snapshot, with the matching source version; forged locators and
// out-of-range offsets are ErrSourceNotFound (INV-05 adapter support).
func TestSnapshotRange(t *testing.T) {
	snap := Snapshot{
		ContentID: "fixture:range",
		Kind:      SourceArticle,
		Version:   "content-revision:7",
		Blocks:    []Block{{Index: 0, Kind: "paragraph", Text: "第一段证据文本。第二段。"}},
	}
	text, version, err := SnapshotRange(snap, ArticleLocator(0, 0, 1), 0, 8)
	if err != nil || text != "第一段证据文本。" || version != "content-revision:7" {
		t.Fatalf("article range: %q %q %v", text, version, err)
	}
	if _, _, err := SnapshotRange(snap, ArticleLocator(99, 0, 1), 0, 8); err == nil {
		t.Fatal("forged block index must fail")
	}
	if _, _, err := SnapshotRange(snap, ArticleLocator(0, 0, 1), 0, 1000); err == nil {
		t.Fatal("out-of-range end must fail")
	}
	if _, _, err := SnapshotRange(snap, ArticleLocator(0, 0, 1), -1, 8); err == nil {
		t.Fatal("negative start must fail")
	}
	if _, _, err := SnapshotRange(snap, "bogus:locator", 0, 8); err == nil {
		t.Fatal("forged locator must fail")
	}

	sub := Snapshot{
		ContentID: "fixture:range-sub",
		Kind:      SourceSubtitle,
		Tracks: []SubtitleTrack{{
			Language: "zh", Revision: 3,
			Cues: []Cue{
				{ID: "zh:0", Language: "zh", StartMs: 0, EndMs: 2000, Text: "字幕零"},
				{ID: "zh:1", Language: "zh", StartMs: 2000, EndMs: 4000, Text: "字幕一"},
				{ID: "zh:2", Language: "zh", StartMs: 4000, EndMs: 6000, Text: "字幕二"},
			},
		}},
	}
	joined := "字幕零\n字幕一\n字幕二"
	text, version, err = SnapshotRange(sub, SubtitleLocator("zh", 0, 2), 0, RuneLen(joined))
	if err != nil || text != joined || version != "content-revision:3" {
		t.Fatalf("subtitle range: %q %q %v", text, version, err)
	}
	if _, _, err := SnapshotRange(sub, SubtitleLocator("en", 0, 2), 0, 3); err == nil {
		t.Fatal("unknown language must fail")
	}

	hash := strings.Repeat("cd", 32)
	pdf := Snapshot{
		ContentID: "fixture:range-pdf",
		Kind:      SourcePDF,
		Pages:     []Page{{Number: 50, Text: "第五十页的答案文本。", DocumentSHA256: hash, Extractor: "native", ExtractorVersion: "1.0"}},
	}
	text, version, err = SnapshotRange(pdf, PDFLocator(hash, 50, 0, 1), 0, 10)
	if err != nil || text != "第五十页的答案文本。" || version != pdfVersion(pdf.Pages[0]) {
		t.Fatalf("pdf range: %q %q %v", text, version, err)
	}
	if _, _, err := SnapshotRange(pdf, PDFLocator(strings.Repeat("ee", 32), 50, 0, 1), 0, 10); err == nil {
		t.Fatal("changed document hash must invalidate the old locator")
	}

	disc := Snapshot{
		ContentID: "fixture:range-disc",
		Kind:      SourceDiscussion,
		Version:   "content-revision:2",
		Posts: []DiscussionPost{
			{Index: 0, Blocks: []Block{{Index: 0, Kind: "paragraph", Text: "楼主发言。"}}},
			{Index: 1, Blocks: []Block{{Index: 0, Kind: "paragraph", Text: "回复发言。"}}},
		},
	}
	text, version, err = SnapshotRange(disc, DiscussionLocator(1, 0, 0, 1), 0, 5)
	if err != nil || text != "回复发言。" || version != "content-revision:2" {
		t.Fatalf("discussion range: %q %q %v", text, version, err)
	}
}
