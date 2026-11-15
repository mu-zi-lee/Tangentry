package retrieval

import (
	"context"
	"strings"
	"testing"
)

// mixedSnapshot builds an article + subtitle + PDF snapshot for B-T14.
func mixedSnapshot() Snapshot {
	return Snapshot{
		ContentID: "fixture:mixed",
		Kind:      SourceArticle,
		Version:   "content-revision:7",
		Blocks: []Block{
			{Index: 0, Kind: "paragraph", Text: "第一段证据文本。第二段证据文本。"},
		},
	}
}

func subtitleSnapshot() Snapshot {
	return Snapshot{
		ContentID: "fixture:mixed-sub",
		Kind:      SourceSubtitle,
		Tracks: []SubtitleTrack{{
			Language: "zh", Revision: 3,
			Cues: []Cue{
				{ID: "c0", Language: "zh", StartMs: 0, EndMs: 2000, Text: "字幕零"},
				{ID: "c1", Language: "zh", StartMs: 2000, EndMs: 4000, Text: "字幕一"},
				{ID: "c2", Language: "zh", StartMs: 4000, EndMs: 6000, Text: "字幕二"},
				{ID: "c3", Language: "zh", StartMs: 6000, EndMs: 8000, Text: "字幕三"},
			},
		}},
	}
}

func pdfSnapshot() Snapshot {
	hash := strings.Repeat("ab", 32)
	return Snapshot{
		ContentID: "fixture:mixed-pdf",
		Kind:      SourcePDF,
		Pages: []Page{{
			Number: 50, Text: "第五十页的答案文本。后续句子。",
			DocumentSHA256: hash, Extractor: "native", ExtractorVersion: "1.0",
		}},
	}
}

// TestBT14_VerifyReread: every selected passage is re-read through the port;
// contentId, source, locator, range, exact text, version and hash match; two
// runs produce the same passage IDs.
func TestBT14_VerifyReread(t *testing.T) {
	ctx := context.Background()
	art := mixedSnapshot()
	sub := subtitleSnapshot()
	pdf := pdfSnapshot()

	artPassage := Passage{
		ID:        PassageID(art.ContentID, SourceArticle, ArticleLocator(0, 0, 1), 0, 8),
		ContentID: art.ContentID, Source: SourceArticle, Locator: ArticleLocator(0, 0, 1),
		SentenceStart: 0, SentenceEnd: 1, StartRune: 0, EndRune: 8,
		Text: "第一段证据文本。", SourceVersion: "content-revision:7",
		TextSHA256: TextSHA256("第一段证据文本。"),
	}
	subText := "字幕零\n字幕一\n字幕二"
	subPassage := Passage{
		ID:        PassageID(sub.ContentID, SourceSubtitle, SubtitleLocator("zh", 0, 2), 0, RuneLen(subText)),
		ContentID: sub.ContentID, Source: SourceSubtitle, Locator: SubtitleLocator("zh", 0, 2),
		SentenceStart: 0, SentenceEnd: 3, StartRune: 0, EndRune: RuneLen(subText),
		Text: subText, SourceVersion: "content-revision:3", TextSHA256: TextSHA256(subText),
		CueIDs: []string{"c0", "c1", "c2"},
	}
	pdfText := "第五十页的答案文本。"
	pdfPassage := Passage{
		ID:        PassageID(pdf.ContentID, SourcePDF, PDFLocator(pdf.Pages[0].DocumentSHA256, 50, 0, 1), 0, RuneLen(pdfText)),
		ContentID: pdf.ContentID, Source: SourcePDF, Locator: PDFLocator(pdf.Pages[0].DocumentSHA256, 50, 0, 1),
		SentenceStart: 0, SentenceEnd: 1, StartRune: 0, EndRune: RuneLen(pdfText),
		Text: pdfText, SourceVersion: pdfVersion(pdf.Pages[0]), TextSHA256: TextSHA256(pdfText),
	}

	for _, tc := range []struct {
		snap Snapshot
		p    Passage
	}{
		{art, artPassage}, {sub, subPassage}, {pdf, pdfPassage},
	} {
		src := &fakeSource{snap: tc.snap}
		kept, dropped, err := VerifyPassages(ctx, src, []Passage{tc.p})
		if err != nil {
			t.Fatal(err)
		}
		if len(dropped) != 0 || len(kept) != 1 {
			t.Fatalf("%s: kept=%d dropped=%+v", tc.snap.ContentID, len(kept), dropped)
		}
		if src.readCalls != 1 {
			t.Fatalf("%s: passage must be re-read through the port", tc.snap.ContentID)
		}
		if kept[0].ID != tc.p.ID {
			t.Fatal("ID changed across verification")
		}
	}

	// Two runs produce identical IDs (determinism).
	src := &fakeSource{snap: art}
	k1, _, _ := VerifyPassages(ctx, src, []Passage{artPassage})
	k2, _, _ := VerifyPassages(ctx, src, []Passage{artPassage})
	if k1[0].ID != k2[0].ID {
		t.Fatal("non-deterministic passage IDs")
	}
}

// TestBT15_ForgedPassages: forged ID, negative start, end beyond source and
// text-hash mismatch each drop as source_unverified; none left →
// no_verified_passages (selector level) with zero embedder calls when the
// forgery is detectable before embedding.
func TestBT15_ForgedPassages(t *testing.T) {
	ctx := context.Background()
	art := mixedSnapshot()
	good := Passage{
		ID:        PassageID(art.ContentID, SourceArticle, ArticleLocator(0, 0, 1), 0, 8),
		ContentID: art.ContentID, Source: SourceArticle, Locator: ArticleLocator(0, 0, 1),
		StartRune: 0, EndRune: 8, Text: "第一段证据文本。",
		SourceVersion: "content-revision:7", TextSHA256: TextSHA256("第一段证据文本。"),
	}
	forgedID := good
	forgedID.ID = "forged#article:999:s0:0-8"
	forgedID.Locator = ArticleLocator(999, 0, 1)
	negStart := good
	negStart.StartRune = -1
	beyondEnd := good
	beyondEnd.EndRune = 10000
	beyondEnd.Text = good.Text // hash ok, range impossible
	hashMismatch := good
	hashMismatch.TextSHA256 = strings.Repeat("0", 64)
	textMismatch := good
	textMismatch.Text = "完全不同的文本。"
	textMismatch.TextSHA256 = TextSHA256(textMismatch.Text)
	textMismatch.EndRune = RuneLen(textMismatch.Text)

	for _, tc := range []struct {
		name string
		p    Passage
	}{
		{"forged_id", forgedID}, {"negative_start", negStart},
		{"beyond_end", beyondEnd}, {"hash_mismatch", hashMismatch},
		{"text_mismatch", textMismatch},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeSource{snap: art}
			kept, dropped, err := VerifyPassages(ctx, src, []Passage{tc.p})
			if err != nil {
				t.Fatal(err)
			}
			if len(kept) != 0 || len(dropped) != 1 || dropped[0].Reason != DropSourceUnverified {
				t.Fatalf("kept=%d dropped=%+v, want one source_unverified drop", len(kept), dropped)
			}
		})
	}

	// Selector level: source text mutated after selection → all dropped →
	// no_verified_passages. The embedder is fake; the domain starts no chat.
	src := &fakeSource{snap: art, mutateText: func(s string) string { return "被篡改的文本。" }}
	emb := newFakeEmbedder(BatchingShared)
	sel := NewSelector(src, emb, defaultSelectorConfig())
	got, err := sel.Select(ctx, art.ContentID, "证据文本", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != SelectionNoVerifiedPassages {
		t.Fatalf("status = %q, want no_verified_passages", got.Status)
	}
	if len(got.Passages) != 0 {
		t.Fatal("unverified passages must not survive")
	}
}

// TestBT19_StaleVersion: a version change marks the reference stale_source;
// old text is never presented as current.
func TestBT19_StaleVersion(t *testing.T) {
	ctx := context.Background()
	art := mixedSnapshot()
	src := &fakeSource{snap: art, versionOverride: "content-revision:8"}
	p := Passage{
		ID:        PassageID(art.ContentID, SourceArticle, ArticleLocator(0, 0, 1), 0, 8),
		ContentID: art.ContentID, Source: SourceArticle, Locator: ArticleLocator(0, 0, 1),
		StartRune: 0, EndRune: 8, Text: "第一段证据文本。",
		SourceVersion: "content-revision:7", TextSHA256: TextSHA256("第一段证据文本。"),
	}
	kept, dropped, err := VerifyPassages(ctx, src, []Passage{p})
	if err != nil {
		t.Fatal(err)
	}
	if len(kept) != 0 || len(dropped) != 1 || dropped[0].Reason != DropStaleSource {
		t.Fatalf("kept=%d dropped=%+v, want stale_source", len(kept), dropped)
	}
}
