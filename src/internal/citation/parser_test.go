package citation

import "testing"

func TestParseValidCitation(t *testing.T) {
	answer := "QUIC improves latency. [[cite:p1|QUIC improves latency.]]"

	clean, citations := Parse(answer)

	if clean != "QUIC improves latency." {
		t.Fatalf("unexpected clean answer: %q", clean)
	}

	if len(citations) != 1 {
		t.Fatalf("expected 1 citation, got %d", len(citations))
	}

	if citations[0].PassageID != "p1" {
		t.Fatalf("unexpected passage ID: %s", citations[0].PassageID)
	}

	if citations[0].Quote != "QUIC improves latency." {
		t.Fatalf("unexpected quote: %s", citations[0].Quote)
	}
}

func TestParseAnswerWithoutCitation(t *testing.T) {
	answer := "QUIC improves connection establishment latency."

	clean, citations := Parse(answer)

	if clean != answer {
		t.Fatalf("answer changed: %q", clean)
	}

	if len(citations) != 0 {
		t.Fatalf("expected no citations, got %d", len(citations))
	}
}

func TestParseMalformedCitation(t *testing.T) {
	answer := "Answer [[cite:p1|missing closing bracket"

	clean, citations := Parse(answer)

	if len(citations) != 0 {
		t.Fatalf("expected no valid citations, got %d", len(citations))
	}

	if clean != answer {
		t.Fatalf("malformed marker should remain visible, got %q", clean)
	}
}

func TestParseMultipleCitations(t *testing.T) {
	answer := "First claim [[cite:p1|First quote]]. Second claim [[cite:p2|Second quote]]."

	clean, citations := Parse(answer)

	if len(citations) != 2 {
		t.Fatalf("expected 2 citations, got %d", len(citations))
	}

	if citations[0].PassageID != "p1" ||
		citations[1].PassageID != "p2" {
		t.Fatalf("unexpected citation order: %+v", citations)
	}

	if clean != "First claim . Second claim ." {
		t.Fatalf("unexpected clean answer: %q", clean)
	}
}
