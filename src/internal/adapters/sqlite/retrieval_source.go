package sqlite

import (
	"context"
	"errors"
	"fmt"

	"tangentry/internal/content"
	"tangentry/internal/retrieval"
)

// RetrievalSource implements the retrieval.PassageSource port on top of the
// confirmed SQLite store: normalized snapshots for article/discussion blocks
// and saved subtitle tracks, plus exact re-reads for INV-05 verification.
// PDF page text joins in phase 3 (pdf_page_text store); browser-supplied text
// is never trusted.
type RetrievalSource struct{ store *Store }

// NewRetrievalSource wires the domain port to the store.
func NewRetrievalSource(store *Store) *RetrievalSource { return &RetrievalSource{store: store} }

// Snapshot loads the current normalized document for contentID.
func (r *RetrievalSource) Snapshot(ctx context.Context, contentID string) (retrieval.Snapshot, error) {
	item, err := r.store.Get(ctx, contentID)
	if err != nil {
		if errors.Is(err, content.ErrNotFound) {
			return retrieval.Snapshot{}, retrieval.ErrSourceNotFound
		}
		return retrieval.Snapshot{}, err
	}
	snap := itemSnapshot(item)
	switch snap.Kind {
	case retrieval.SourceSubtitle:
		tracks, err := r.store.ListSavedSubtitles(ctx, contentID)
		if err != nil {
			return retrieval.Snapshot{}, err
		}
		for _, saved := range tracks {
			track := retrieval.SubtitleTrack{Language: saved.Track.Language, Revision: saved.Revision}
			for i, cue := range saved.Track.Cues {
				track.Cues = append(track.Cues, retrieval.Cue{
					// Saved cues have no database ID; the cue ID is the
					// deterministic language-qualified index (ADR-002:
					// locators derive from content ID, kind and index).
					ID:       cueID(saved.Track.Language, i),
					Language: saved.Track.Language,
					StartMs:  int64(cue.Start * 1000),
					EndMs:    int64(cue.End * 1000),
					Text:     cue.Text,
				})
			}
			snap.Tracks = append(snap.Tracks, track)
		}
	case retrieval.SourcePDF:
		// Retrieval reads only the stored server-side page text; browser
		// page text is never authoritative (phase 3 store).
		pages, err := r.store.ListPDFPages(ctx, contentID)
		if err != nil {
			return retrieval.Snapshot{}, err
		}
		snap.Pages = pages
	}
	return snap, nil
}

// ReadRange re-reads the exact current text at a locator range (INV-05).
// The snapshot is loaded fresh on every call, so a source update between
// selection and verification surfaces as a version/text mismatch.
func (r *RetrievalSource) ReadRange(ctx context.Context, contentID, locator string, startRune, endRune int) (string, string, error) {
	snap, err := r.Snapshot(ctx, contentID)
	if err != nil {
		return "", "", err
	}
	// A replaced PDF document hash makes old references stale (not merely
	// unverified): C sees stale_source (ADR-002 PDF item 9).
	if hash, ok := retrieval.LocatorDocumentHash(locator); ok && snap.Kind == retrieval.SourcePDF && len(snap.Pages) > 0 && snap.Pages[0].DocumentSHA256 != hash {
		return "", "", retrieval.ErrStaleSource
	}
	return retrieval.SnapshotRange(snap, locator, startRune, endRune)
}

func cueID(language string, index int) string { return fmt.Sprintf("%s:%d", language, index) }

// Compile-time port conformance.
var _ retrieval.PassageSource = (*RetrievalSource)(nil)
