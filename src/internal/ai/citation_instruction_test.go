package ai

import (
	"strings"
	"testing"
)

// TestWithCitationInstruction: the per-paragraph citation requirement is added
// only when asked for, only to a non-empty source, and never twice.
func TestWithCitationInstruction(t *testing.T) {
	t.Run("off leaves the source untouched", func(t *testing.T) {
		if got := withCitationInstruction("source text", false); got != "source text" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("empty source stays empty", func(t *testing.T) {
		for _, source := range []string{"", "   ", "\n"} {
			if got := withCitationInstruction(source, true); got != source {
				t.Fatalf("source %q became %q", source, got)
			}
		}
	})

	t.Run("on appends the requirement", func(t *testing.T) {
		got := withCitationInstruction("source text", true)
		if !strings.HasPrefix(got, "source text") {
			t.Fatal("the assembled context must stay first")
		}
		for _, want := range []string{"[p:<id>]", "[p:none]", "EVERY paragraph", "Use only the ids listed"} {
			if !strings.Contains(got, want) {
				t.Fatalf("instruction missing %q", want)
			}
		}
	})

	t.Run("is idempotent", func(t *testing.T) {
		once := withCitationInstruction("source", true)
		twice := withCitationInstruction(once, true)
		if once != twice {
			t.Fatal("the instruction was appended twice")
		}
	})
}