package content

import (
	"strings"
	"testing"
	"unicode/utf8"
	"unsafe"
)

func TestTruncateRunesCopiesOnlyTheRequiredPrefix(t *testing.T) {
	for _, value := range []struct {
		text      string
		limit     int
		want      string
		truncated bool
	}{{"a文🙂tail", 3, "a文🙂", true}, {"文🙂", 2, "文🙂", false}, {"", 0, "", false}, {"文", 0, "", true}, {"文", -1, "", true}} {
		got, truncated := TruncateRunes(value.text, value.limit)
		if got != value.want || truncated != value.truncated {
			t.Fatalf("TruncateRunes(%q, %d) = %q, %v", value.text, value.limit, got, truncated)
		}
		if truncated && len(got) > 0 && unsafe.StringData(got) == unsafe.StringData(value.text) {
			t.Fatal("truncated card retains the full article backing string")
		}
	}
}

func TestCardDescriptionProjectionPreservesUnicodeAndSource(t *testing.T) {
	for _, text := range []string{"", "简短内容", strings.Repeat("a", CardDescriptionRunes), strings.Repeat("文", CardDescriptionRunes), strings.Repeat("文🙂a", 800)} {
		t.Run(string([]rune(text)[:min(8, utf8.RuneCountInString(text))]), func(t *testing.T) {
			input := Item{Description: text}
			card := Card(input)
			want := []rune(text)
			truncated := len(want) > CardDescriptionRunes
			if truncated {
				want = want[:CardDescriptionRunes]
			}
			if card.Description != string(want) || card.Partial != truncated || !utf8.ValidString(card.Description) {
				t.Fatal("card description changed content, split Unicode, or lost its partial flag")
			}
			if input.Description != text {
				t.Fatal("card projection changed the full source")
			}
		})
	}
	input := Item{Description: "正文保留", ArticleBlocks: []ArticleBlock{{Kind: "paragraph", Text: "完整正文"}}, Transcripts: []Transcript{{URL: "https://example.com/captions"}}, Discussion: &Discussion{TopicID: "topic"}}
	card := Card(input)
	if !card.Partial || card.ArticleBlocks != nil || card.Transcripts != nil || card.Discussion != nil || card.Description != input.Description {
		t.Fatal("card projection retained full bodies or discarded the summary")
	}
	if len(input.ArticleBlocks) != 1 || len(input.Transcripts) != 1 || input.Discussion == nil {
		t.Fatal("card projection mutated source fields")
	}
}

var projectedCard Item

func BenchmarkCardDescriptionProjection(b *testing.B) {
	for _, size := range []struct {
		name    string
		repeats int
	}{{"short", 20}, {"long", 20_000}, {"very_long", 200_000}} {
		b.Run(size.name, func(b *testing.B) {
			item := Item{Description: strings.Repeat("文🙂a", size.repeats)}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				projectedCard = Card(item)
			}
		})
	}
}
