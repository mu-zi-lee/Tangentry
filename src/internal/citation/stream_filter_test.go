package citation

import (
	"strings"
	"testing"
)

func TestStreamFilterPlainText(t *testing.T) {
	filter := NewStreamFilter()

	got := filter.Push("Hello, this is ordinary text.")
	if got != "Hello, this is ordinary text." {
		t.Fatalf("Push() = %q", got)
	}

	if tail := filter.Flush(); tail != "" {
		t.Fatalf("Flush() = %q, want empty", tail)
	}
}

func TestStreamFilterCompleteCitation(t *testing.T) {
	filter := NewStreamFilter()

	got := filter.Push(
		"Answer [[cite:passage-1|exact quote]] continues.",
	)

	want := "Answer  continues."
	if got != want {
		t.Fatalf("Push() = %q, want %q", got, want)
	}

	if tail := filter.Flush(); tail != "" {
		t.Fatalf("Flush() = %q, want empty", tail)
	}
}

func TestStreamFilterCitationAcrossChunks(t *testing.T) {
	filter := NewStreamFilter()

	chunks := []string{
		"The answer is supported by [[ci",
		"te:passage-123|exact quote",
		" here]] the source.",
	}

	var got strings.Builder
	for _, chunk := range chunks {
		got.WriteString(filter.Push(chunk))
	}
	got.WriteString(filter.Flush())

	want := "The answer is supported by  the source."
	if got.String() != want {
		t.Fatalf("stream output = %q, want %q", got.String(), want)
	}

	if strings.Contains(got.String(), "[[cite:") {
		t.Fatalf("citation marker leaked into output: %q", got.String())
	}
}

func TestStreamFilterMultipleCitations(t *testing.T) {
	filter := NewStreamFilter()

	input := "A [[cite:p1|quote one]] B [[cite:p2|quote two]] C"

	got := filter.Push(input)
	want := "A  B  C"

	if got != want {
		t.Fatalf("Push() = %q, want %q", got, want)
	}
}

func TestStreamFilterMalformedCitation(t *testing.T) {
	filter := NewStreamFilter()

	// Missing the passage/quote separator.
	input := "Text [[cite:malformed]] remains."

	got := filter.Push(input)
	if got != input {
		t.Fatalf("Push() = %q, want original %q", got, input)
	}
}

func TestStreamFilterIncompleteCitationOnFlush(t *testing.T) {
	filter := NewStreamFilter()

	first := filter.Push("Answer before [[cite:passage-1|unfinished")
	if first != "Answer before " {
		t.Fatalf("Push() = %q", first)
	}

	tail := filter.Flush()
	want := "[[cite:passage-1|unfinished"

	if tail != want {
		t.Fatalf("Flush() = %q, want %q", tail, want)
	}
}

func TestStreamFilterPartialPrefixAcrossChunks(t *testing.T) {
	filter := NewStreamFilter()

	first := filter.Push("Hello [[ci")
	if first != "Hello " {
		t.Fatalf("first Push() = %q", first)
	}

	second := filter.Push("tation is ordinary text")
	want := "[[citation is ordinary text"

	if second != want {
		t.Fatalf("second Push() = %q, want %q", second, want)
	}

	if tail := filter.Flush(); tail != "" {
		t.Fatalf("Flush() = %q, want empty", tail)
	}
}
func TestStreamFilterEveryCitationSplitPoint(t *testing.T) {
	const marker = "[[cite:passage-1|exact quote]]"

	for split := 0; split <= len(marker); split++ {
		t.Run(strings.ReplaceAll(
			strings.TrimSpace(string(rune(split+'A'))),
			"/", "_",
		), func(t *testing.T) {
			filter := NewStreamFilter()

			var got strings.Builder
			got.WriteString(filter.Push(marker[:split]))
			got.WriteString(filter.Push(marker[split:]))
			got.WriteString(filter.Flush())

			if got.String() != "" {
				t.Fatalf(
					"split at %d leaked marker: %q",
					split,
					got.String(),
				)
			}
		})
	}
}
