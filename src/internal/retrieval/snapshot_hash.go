package retrieval

import (
	"fmt"
	"strings"
)

// SnapshotHash returns the SHA-256 of the canonical normalized source
// snapshot (plan: content_hash = SHA-256 of the normalized snapshot).
// Normalization is line-ending/whitespace collapse with case preserved
// (NormalizeWhitespace); the version and contentID fields are excluded so
// the hash never depends on itself. Structure (block/post/page/cue indices,
// kinds, levels, cue IDs and timings) is included. Deterministic.
func SnapshotHash(snap Snapshot) string {
	var b strings.Builder
	b.WriteString(string(snap.Kind))
	b.WriteByte(0x1f)
	for _, blk := range snap.Blocks {
		writeBlockForHash(&b, blk)
	}
	for _, post := range snap.Posts {
		fmt.Fprintf(&b, "P%d\x1f", post.Index)
		for _, blk := range post.Blocks {
			writeBlockForHash(&b, blk)
		}
	}
	for _, track := range snap.Tracks {
		fmt.Fprintf(&b, "T%s\x1f", track.Language)
		for _, cue := range track.Cues {
			fmt.Fprintf(&b, "%s\x1f%d\x1f%d\x1f%s\x1e", cue.ID, cue.StartMs, cue.EndMs, NormalizeWhitespace(cue.Text))
		}
	}
	for _, page := range snap.Pages {
		fmt.Fprintf(&b, "G%d\x1f%s\x1e", page.Number, NormalizeWhitespace(page.Text))
	}
	return TextSHA256(b.String())
}

func writeBlockForHash(b *strings.Builder, blk Block) {
	fmt.Fprintf(b, "B%d\x1f%s\x1f%d\x1f%s\x1e", blk.Index, blk.Kind, blk.Level, NormalizeWhitespace(blk.Text))
}

// SnapshotRange re-reads the exact current text at a locator range from a
// snapshot and returns it with the matching source version. It is the pure
// domain half of the INV-05 re-read: adapters load a fresh snapshot and call
// this; forged locators and out-of-range offsets return ErrSourceNotFound.
func SnapshotRange(snap Snapshot, locator string, startRune, endRune int) (string, string, error) {
	info, err := parseLocator(locator)
	if err != nil {
		return "", "", ErrSourceNotFound
	}
	if startRune < 0 || endRune <= startRune {
		return "", "", ErrSourceNotFound
	}
	var unitText, version string
	switch info.Kind {
	case SourceArticle:
		if snap.Kind != SourceArticle || info.BlockIndex >= len(snap.Blocks) {
			return "", "", ErrSourceNotFound
		}
		unitText, version = snap.Blocks[info.BlockIndex].Text, snap.Version
	case SourceDiscussion:
		if snap.Kind != SourceDiscussion || info.PostIndex >= len(snap.Posts) {
			return "", "", ErrSourceNotFound
		}
		post := snap.Posts[info.PostIndex]
		if info.BlockIndex >= len(post.Blocks) {
			return "", "", ErrSourceNotFound
		}
		unitText, version = post.Blocks[info.BlockIndex].Text, snap.Version
	case SourceSubtitle:
		if snap.Kind != SourceSubtitle {
			return "", "", ErrSourceNotFound
		}
		var track *SubtitleTrack
		for i := range snap.Tracks {
			if snap.Tracks[i].Language == info.Language {
				track = &snap.Tracks[i]
				break
			}
		}
		if track == nil || info.CueEnd >= len(track.Cues) {
			return "", "", ErrSourceNotFound
		}
		texts := make([]string, 0, info.CueEnd-info.CueStart+1)
		for i := info.CueStart; i <= info.CueEnd; i++ {
			texts = append(texts, track.Cues[i].Text)
		}
		unitText, version = strings.Join(texts, "\n"), subtitleVersion(track.Revision)
	case SourcePDF:
		if snap.Kind != SourcePDF {
			return "", "", ErrSourceNotFound
		}
		var page *Page
		for i := range snap.Pages {
			if snap.Pages[i].Number == info.Page && snap.Pages[i].DocumentSHA256 == info.DocHash {
				page = &snap.Pages[i]
				break
			}
		}
		if page == nil {
			return "", "", ErrSourceNotFound
		}
		unitText, version = page.Text, pdfVersion(*page)
	default:
		return "", "", ErrSourceNotFound
	}
	runes := []rune(unitText)
	if endRune > len(runes) {
		return "", "", ErrSourceNotFound
	}
	return string(runes[startRune:endRune]), version, nil
}
