package retrieval

import (
	"context"
	"errors"
)

// Drop reasons for INV-05 verification (distinct, never generic).
const (
	DropSourceUnverified = "source_unverified"
	DropStaleSource      = "stale_source"
)

// DroppedPassage records why a candidate was dropped before assembly.
type DroppedPassage struct {
	ID     string
	Reason string
}

// VerifyPassages re-reads every selected passage through the domain port
// (INV-05): exact text, range and source version/hash must match. Forged,
// out-of-range or mismatched passages drop as source_unverified; a version
// change drops as stale_source. Nothing is synthesized or repaired. When no
// passage survives, the caller returns no_verified_passages.
func VerifyPassages(ctx context.Context, src PassageSource, ps []Passage) ([]Passage, []DroppedPassage, error) {
	var kept []Passage
	var dropped []DroppedPassage
	for _, p := range ps {
		if reason := structuralCheck(p); reason != "" {
			dropped = append(dropped, DroppedPassage{ID: p.ID, Reason: reason})
			continue
		}
		text, version, err := src.ReadRange(ctx, p.ContentID, p.Locator, p.StartRune, p.EndRune)
		if err != nil {
			reason := DropSourceUnverified
			if errors.Is(err, ErrStaleSource) {
				reason = DropStaleSource
			}
			dropped = append(dropped, DroppedPassage{ID: p.ID, Reason: reason})
			continue
		}
		if version != p.SourceVersion {
			dropped = append(dropped, DroppedPassage{ID: p.ID, Reason: DropStaleSource})
			continue
		}
		if text != p.Text {
			dropped = append(dropped, DroppedPassage{ID: p.ID, Reason: DropSourceUnverified})
			continue
		}
		kept = append(kept, p)
	}
	return kept, dropped, nil
}

// structuralCheck rejects forged ranges and hash mismatches without any
// source read (they can never be valid).
func structuralCheck(p Passage) string {
	if p.StartRune < 0 || p.EndRune <= p.StartRune {
		return DropSourceUnverified
	}
	if RuneLen(p.Text) != p.EndRune-p.StartRune {
		return DropSourceUnverified
	}
	if p.TextSHA256 != TextSHA256(p.Text) {
		return DropSourceUnverified
	}
	if _, err := parseLocator(p.Locator); err != nil {
		return DropSourceUnverified
	}
	return ""
}
