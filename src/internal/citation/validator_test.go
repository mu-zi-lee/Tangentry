package citation

import (
	"testing"

	"tangentry/internal/retrieval"
)

func TestValidateExactQuote(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc1",
			Locator:       "page-1",
			Text:          "QUIC reduces connection establishment latency.",
			SourceVersion: "v1",
			StartRune:     10,
		},
	}

	raw := []RawCitation{
		{
			PassageID: "p1",
			Quote:     "reduces connection establishment latency",
		},
	}

	result := Validate("doc1", raw, passages)

	if len(result) != 1 {
		t.Fatalf("expected 1 citation, got %d", len(result))
	}
	if result[0].Status != StatusVerified {
		t.Fatalf("expected verified, got %s: %s",
			result[0].Status, result[0].Reason)
	}
	if result[0].StartRune != 15 {
		t.Fatalf("unexpected StartRune: got %d, want 15",
			result[0].StartRune)
	}
	if result[0].EndRune != 55 {
		t.Fatalf("unexpected EndRune: got %d, want 55",
			result[0].EndRune)
	}
}

func TestValidateRejectsUnknownPassage(t *testing.T) {
	result := Validate("doc1", []RawCitation{
		{PassageID: "unknown", Quote: "some quote"},
	}, nil)

	if len(result) != 1 || result[0].Status != StatusInvalid {
		t.Fatalf("expected invalid citation, got %+v", result)
	}
}

func TestValidateRejectsWrongContentID(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc2",
			Text:          "This is the original text.",
			SourceVersion: "v1",
		},
	}

	result := Validate("doc1", []RawCitation{
		{PassageID: "p1", Quote: "original text"},
	}, passages)

	if result[0].Status != StatusInvalid {
		t.Fatalf("expected invalid, got %s", result[0].Status)
	}
}

func TestValidateRejectsAlteredQuote(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc1",
			Text:          "The original sentence is here.",
			SourceVersion: "v1",
		},
	}

	result := Validate("doc1", []RawCitation{
		{PassageID: "p1", Quote: "The modified sentence"},
	}, passages)

	if result[0].Status != StatusInvalid {
		t.Fatalf("expected invalid, got %s", result[0].Status)
	}
}

func TestValidateUnverifiedWithoutVersion(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:        "p1",
			ContentID: "doc1",
			Text:      "A sentence without a version.",
		},
	}

	result := Validate("doc1", []RawCitation{
		{PassageID: "p1", Quote: "without a version"},
	}, passages)

	if result[0].Status != StatusUnverified {
		t.Fatalf("expected unverified, got %s", result[0].Status)
	}
}

func TestValidateRejectsEmptyQuote(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc1",
			Text:          "Some source text.",
			SourceVersion: "v1",
		},
	}

	result := Validate("doc1", []RawCitation{
		{PassageID: "p1", Quote: ""},
	}, passages)

	if result[0].Status != StatusInvalid {
		t.Fatalf("expected invalid, got %s", result[0].Status)
	}
}
func TestValidateAmbiguousDuplicateQuote(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc1",
			Text:          "QUIC improves latency. QUIC improves latency.",
			SourceVersion: "v1",
		},
	}

	result := Validate("doc1", []RawCitation{
		{
			PassageID: "p1",
			Quote:     "QUIC improves latency.",
		},
	}, passages)

	if len(result) != 1 {
		t.Fatalf("expected 1 citation, got %d", len(result))
	}

	if result[0].Status != StatusAmbiguous {
		t.Fatalf("expected ambiguous, got %s: %s",
			result[0].Status, result[0].Reason)
	}
}
func TestValidateUnicodeRuneOffsets(t *testing.T) {
	passages := []retrieval.Passage{
		{
			ID:            "p1",
			ContentID:     "doc1",
			Text:          "QUIC 提高了连接速度。",
			SourceVersion: "v1",
			StartRune:     100,
		},
	}

	result := Validate("doc1", []RawCitation{
		{
			PassageID: "p1",
			Quote:     "提高了连接速度",
		},
	}, passages)

	if len(result) != 1 || result[0].Status != StatusVerified {
		t.Fatalf("expected verified, got %+v", result)
	}

	if result[0].StartRune != 105 {
		t.Fatalf("unexpected StartRune: got %d, want 105",
			result[0].StartRune)
	}

	if result[0].EndRune != 112 {
		t.Fatalf("unexpected EndRune: got %d, want 112",
			result[0].EndRune)
	}
}
