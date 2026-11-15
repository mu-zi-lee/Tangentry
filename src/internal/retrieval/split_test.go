package retrieval

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestBT29_Splitter: CJK punctuation, Latin abbreviations, quotes, code
// blocks, emoji and boundary runes; no empty/duplicate segments, no split
// surrogate, every range maps back to exact source text.
func TestBT29_Splitter(t *testing.T) {
	cases := []struct {
		name string
		text string
		want int // expected sentence count
	}{
		{"cjk", "第一句。第二句！第三句？第四句；第五句……", 5},
		{"latin", "Hello world. This is fine! Really? Yes.", 4},
		{"abbrev", "Dr. Smith went home. He was tired.", 2},
		{"eg", "Some fruits, e.g. apples and pears, are sweet. They sell well.", 2},
		{"decimal", "The value is 3.14 exactly. Round it.", 2},
		{"quotes", "He said “ stop. now ” and left. She stayed.", 2},
		{"ascii_quotes", "He said \"stop. now\" and left. She stayed.", 2},
		{"code", "Before. ```\ncode.line()\nmore.code()\n``` After.", 2},
		{"emoji", "😀😀😀。Next sentence! 🎉", 3}, // trailing 🎉 is a terminator-less sentence
		{"empty", "", 0},
		{"whitespace", "   \n\t  ", 0},
		{"no_terminator", "one long run on sentence without any terminator", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sents := SplitSentences(tc.text)
			if len(sents) != tc.want {
				t.Fatalf("sentence count = %d, want %d (%+v)", len(sents), tc.want, sents)
			}
			runes := []rune(tc.text)
			seen := map[string]bool{}
			prevEnd := 0
			for _, s := range sents {
				if s.StartRune < prevEnd || s.EndRune <= s.StartRune || s.EndRune > len(runes) {
					t.Fatalf("invalid/overlapping range %+v", s)
				}
				prevEnd = s.EndRune
				exact := string(runes[s.StartRune:s.EndRune])
				if exact != s.Text {
					t.Fatalf("range does not map to exact text: %q vs %q", exact, s.Text)
				}
				if strings.TrimSpace(s.Text) == "" {
					t.Fatal("empty segment emitted")
				}
				if seen[s.Text] {
					t.Fatalf("duplicate segment %q", s.Text)
				}
				seen[s.Text] = true
				if !utf8.ValidString(s.Text) {
					t.Fatal("invalid UTF-8 (split surrogate?)")
				}
			}
		})
	}
}

// TestBT29_SegmentGrouping: 1–3 sentences or 200–800 runes, no overlap,
// exact ranges; headings never crossed (selector-level).
func TestBT29_SegmentGrouping(t *testing.T) {
	// Short sentences: capped at 3 per segment.
	var b strings.Builder
	for i := 0; i < 12; i++ {
		b.WriteString("短句。")
	}
	text := b.String()
	segs := segmentsFromUnit(0, text, DefaultMaxSentencesPerSegment, DefaultMinSegmentRunes, DefaultMaxSegmentRunes)
	if len(segs) != 4 {
		t.Fatalf("segments = %d, want 4", len(segs))
	}
	for _, s := range segs {
		if s.SentenceEnd-s.SentenceStart > 3 {
			t.Fatalf("segment spans >3 sentences: %+v", s)
		}
	}
	// Long sentences (~300 runes): one per segment (>= 200 min).
	long := strings.Repeat("长", 299) + "。"
	text2 := strings.Repeat(long, 4)
	segs2 := segmentsFromUnit(0, text2, DefaultMaxSentencesPerSegment, DefaultMinSegmentRunes, DefaultMaxSegmentRunes)
	if len(segs2) != 4 {
		t.Fatalf("long segments = %d, want 4", len(segs2))
	}
	// 800-rune cap: two 500-rune sentences never share a segment.
	mid := strings.Repeat("中", 499) + "。"
	segs3 := segmentsFromUnit(0, mid+mid, DefaultMaxSentencesPerSegment, DefaultMinSegmentRunes, DefaultMaxSegmentRunes)
	if len(segs3) != 2 {
		t.Fatalf("mid segments = %d, want 2 (800-rune cap)", len(segs3))
	}
	// Exact range mapping for every segment.
	runes := []rune(text2)
	for _, s := range segs2 {
		if string(runes[s.StartRune:s.EndRune]) != s.Text {
			t.Fatal("segment range mismatch")
		}
	}
}

// TestBT29_CueGrouping: 3–8 cues or 15–60 seconds, IDs/language/times kept.
func TestBT29_CueGrouping(t *testing.T) {
	var cues []Cue
	for i := 0; i < 24; i++ {
		cues = append(cues, Cue{
			ID: string(rune('A'+i%26)) + strings.Repeat("x", i/26), Language: "zh",
			StartMs: int64(i * 2000), EndMs: int64(i*2000 + 1900),
			Text: "字幕" + strings.Repeat("内", i%3),
		})
	}
	segs := GroupCueSegments(cues, "zh", DefaultMinCuesPerSegment, DefaultMaxCuesPerSegment, DefaultMinCueSpanMs, DefaultMaxCueSpanMs)
	covered := 0
	for _, s := range segs {
		n := s.CueEnd - s.CueStart + 1
		if n < 1 || n > 8 {
			t.Fatalf("cue group size %d out of 1..8", n)
		}
		if s.EndMs-s.StartMs > 60000 {
			t.Fatalf("cue group span %d > 60s", s.EndMs-s.StartMs)
		}
		if len(s.CueIDs) != n {
			t.Fatalf("cue IDs lost: %d vs %d", len(s.CueIDs), n)
		}
		if s.Language != "zh" {
			t.Fatal("language lost")
		}
		if RuneLen(s.Text) != s.EndRune-s.StartRune {
			t.Fatal("cue text range mismatch")
		}
		covered += n
	}
	if covered != len(cues) {
		t.Fatalf("coverage %d != %d (overlap or gap)", covered, len(cues))
	}
}

// TestBT08_Oversize: one 10,000-rune sentence with a 2,000-rune passage
// budget is dropped with oversize_dropped (no half locator); a long
// multi-sentence block splits at sentence boundaries with exact ranges.
func TestBT08_Oversize(t *testing.T) {
	huge := strings.Repeat("巨", 9999) + "。" // one 10,000-rune sentence
	snap := Snapshot{
		ContentID: "fixture:oversize",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks:    []Block{{Index: 0, Kind: "paragraph", Text: huge}},
	}
	src := &fakeSource{snap: snap}
	sel := NewSelector(src, nil, SelectorConfig{
		TopK: 100, MaxPassageRunes: 2000,
		Weights: DefaultWeights(), AssemblyBudgetRunes: DefaultBudgetRunes,
	})
	got, err := sel.Select(context.Background(), "fixture:oversize", "巨大的问题", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != SelectionOversizeDropped {
		t.Fatalf("status = %q, want oversize_dropped", got.Status)
	}
	if len(got.Passages) != 0 || got.Dropped == 0 {
		t.Fatalf("oversize passage must be dropped whole: %+v", got)
	}

	// Multi-sentence block: split at sentence boundaries, each <= 2000 runes.
	var b strings.Builder
	for i := 0; i < 10; i++ {
		b.WriteString(strings.Repeat("句", 999) + "。")
	}
	snap2 := Snapshot{
		ContentID: "fixture:oversize",
		Kind:      SourceArticle,
		Version:   "content-revision:1",
		Blocks:    []Block{{Index: 0, Kind: "paragraph", Text: b.String()}},
	}
	src2 := &fakeSource{snap: snap2}
	sel2 := NewSelector(src2, nil, SelectorConfig{
		TopK: 100, MaxPassageRunes: 2000,
		Weights: DefaultWeights(), AssemblyBudgetRunes: DefaultBudgetRunes,
	})
	got2, err := sel2.Select(context.Background(), "fixture:oversize", "句句", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got2.Passages) == 0 {
		t.Fatal("multi-sentence block must split, not drop")
	}
	for _, p := range got2.Passages {
		if RuneLen(p.Text) > 2000 {
			t.Fatalf("passage exceeds budget: %d", RuneLen(p.Text))
		}
		if p.EndRune <= p.StartRune || p.TextSHA256 != TextSHA256(p.Text) {
			t.Fatalf("invalid passage range/hash: %+v", p)
		}
	}
}
