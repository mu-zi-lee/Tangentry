// Package evalutil holds shared helpers for the eval-b Phase-7 harness
// (replay + vectorgen). Offline, deterministic, no provider calls here.
package evalutil

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"tangentry/internal/retrieval"
)

// Question is one gold record from questions.yaml (protocol §3 format).
type Question struct {
	QuestionID         string `yaml:"question_id" json:"question_id"`
	DocID              string `yaml:"doc_id" json:"doc_id"`
	Question           string `yaml:"question" json:"question"`
	Answerable         bool   `yaml:"answerable" json:"answerable"`
	GoldSource         string `yaml:"gold_source" json:"gold_source"`
	GoldLocator        string `yaml:"gold_locator" json:"gold_locator"`
	GoldPassageText    string `yaml:"gold_passage_text" json:"gold_passage_text"`
	GoldPassageSHA256  string `yaml:"gold_passage_sha256" json:"gold_passage_sha256"`
	GoldSourceVersion  string `yaml:"gold_source_version" json:"gold_source_version"`
	Annotator          string `yaml:"annotator" json:"annotator"`
	AnnotatedAt        string `yaml:"annotated_at" json:"annotated_at"`
	Subset             string `yaml:"subset" json:"subset"`
	PositionThird      string `yaml:"position_third" json:"position_third"`
	PrimaryDenominator bool   `yaml:"primary_denominator" json:"primary_denominator"`
	Notes              string `yaml:"notes" json:"notes"`
}

// EvalSet is the confirmed evaluation set.
type EvalSet struct {
	Version               int        `yaml:"version" json:"version"`
	Status                string     `yaml:"status" json:"status"`
	ConfirmedBy           string     `yaml:"confirmed_by" json:"confirmed_by"`
	ConfirmedAt           string     `yaml:"confirmed_at" json:"confirmed_at"`
	ConfirmationStatement string     `yaml:"confirmation_statement" json:"confirmation_statement"`
	Questions             []Question `yaml:"questions" json:"questions"`
}

// SHA256Hex returns the lowercase hex SHA-256 of s (UTF-8).
func SHA256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// LoadSnapshot reads a fixture snapshot JSON.
func LoadSnapshot(path string) (retrieval.Snapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return retrieval.Snapshot{}, err
	}
	var snap retrieval.Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return retrieval.Snapshot{}, fmt.Errorf("%s: %w", path, err)
	}
	return snap, nil
}

// ConcatText is the canonical normalized document text (units joined "\n"),
// identical to the generator's baseline-replay text.
func ConcatText(snap retrieval.Snapshot) string {
	var parts []string
	switch snap.Kind {
	case retrieval.SourceArticle:
		for _, b := range snap.Blocks {
			parts = append(parts, b.Text)
		}
	case retrieval.SourceSubtitle:
		for _, tr := range snap.Tracks {
			for _, c := range tr.Cues {
				parts = append(parts, c.Text)
			}
		}
	case retrieval.SourcePDF:
		for _, p := range snap.Pages {
			parts = append(parts, p.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// BaselineContext reproduces buildChatContext (chatContext.ts) head/tail
// truncation with no summary material, counting runes (BMP-only fixtures).
func BaselineContext(source string, limit int) string {
	r := []rune(source)
	if len(r) <= limit {
		return source
	}
	remaining := limit - 40
	head := (remaining + 1) / 2
	tail := remaining - head
	return "相关内容片段：\n" + string(r[:head]) + "\n……\n" + string(r[len(r)-tail:])
}

// BaselineHit is normalized containment of the gold in the baseline context.
func BaselineHit(source, gold string, limit int) bool {
	return strings.Contains(retrieval.NormalizeMatch(BaselineContext(source, limit)), retrieval.NormalizeMatch(gold))
}

// MemSource is an exact in-memory PassageSource for replay (same contract as
// the generator's validation source).
type MemSource struct{ Snap retrieval.Snapshot }

func (m MemSource) Snapshot(ctx context.Context, contentID string) (retrieval.Snapshot, error) {
	if contentID != m.Snap.ContentID {
		return retrieval.Snapshot{}, retrieval.ErrSourceNotFound
	}
	return m.Snap, nil
}

func parseSentRangeStr(s string) (int, int, bool) {
	if !strings.HasPrefix(s, "s") {
		return 0, 0, false
	}
	body := s[1:]
	if i := strings.Index(body, "-s"); i >= 0 {
		var a, b int
		if _, err := fmt.Sscanf(body[:i], "%d", &a); err != nil {
			return 0, 0, false
		}
		if _, err := fmt.Sscanf(body[i+2:], "%d", &b); err != nil {
			return 0, 0, false
		}
		return a, b, true
	}
	var a int
	if _, err := fmt.Sscanf(body, "%d", &a); err != nil {
		return 0, 0, false
	}
	return a, a + 1, true
}

func (m MemSource) ReadRange(ctx context.Context, contentID, locator string, startRune, endRune int) (string, string, error) {
	snap := m.Snap
	if contentID != snap.ContentID {
		return "", "", retrieval.ErrSourceNotFound
	}
	parts := strings.Split(locator, ":")
	var unitText, version string
	switch {
	case strings.HasPrefix(locator, "article:") && len(parts) == 3:
		var block int
		if _, err := fmt.Sscanf(parts[1], "%d", &block); err != nil {
			return "", "", retrieval.ErrSourceNotFound
		}
		if _, _, ok := parseSentRangeStr(parts[2]); !ok {
			return "", "", retrieval.ErrSourceNotFound
		}
		if block < 0 || block >= len(snap.Blocks) {
			return "", "", retrieval.ErrSourceNotFound
		}
		unitText, version = snap.Blocks[block].Text, snap.Version
	case strings.HasPrefix(locator, "subtitle:") && len(parts) == 3:
		lang := parts[1]
		var cs, ce int
		if _, err := fmt.Sscanf(parts[2], "%d-%d", &cs, &ce); err != nil {
			return "", "", retrieval.ErrSourceNotFound
		}
		var track *retrieval.SubtitleTrack
		for i := range snap.Tracks {
			if snap.Tracks[i].Language == lang {
				track = &snap.Tracks[i]
				break
			}
		}
		if track == nil || cs < 0 || ce >= len(track.Cues) || ce < cs {
			return "", "", retrieval.ErrSourceNotFound
		}
		texts := make([]string, 0, ce-cs+1)
		for i := cs; i <= ce; i++ {
			texts = append(texts, track.Cues[i].Text)
		}
		unitText, version = strings.Join(texts, "\n"), fmt.Sprintf("content-revision:%d", track.Revision)
	case strings.HasPrefix(locator, "pdf:") && len(parts) == 4:
		hash := parts[1]
		var page int
		if _, err := fmt.Sscanf(parts[2], "%d", &page); err != nil {
			return "", "", retrieval.ErrSourceNotFound
		}
		if _, _, ok := parseSentRangeStr(parts[3]); !ok {
			return "", "", retrieval.ErrSourceNotFound
		}
		var pg *retrieval.Page
		for i := range snap.Pages {
			if snap.Pages[i].Number == page && snap.Pages[i].DocumentSHA256 == hash {
				pg = &snap.Pages[i]
				break
			}
		}
		if pg == nil {
			return "", "", retrieval.ErrSourceNotFound
		}
		unitText, version = pg.Text, retrieval.PDFPageVersion(*pg)
	default:
		return "", "", retrieval.ErrSourceNotFound
	}
	runes := []rune(unitText)
	if startRune < 0 || endRune > len(runes) || startRune >= endRune {
		return "", "", retrieval.ErrSourceNotFound
	}
	return string(runes[startRune:endRune]), version, nil
}

// Candidates reproduces selector.segments with the exported retrieval API
// (same defaults). Used by vectorgen to enumerate the full candidate pool.
type Candidate struct {
	Kind             retrieval.SourceKind
	Unit             int
	Lang             string
	DocHash          string
	Version          string
	Text             string
	SS, SE           int
	SR, ER           int
	IsCue            bool
	CueStart, CueEnd int
}

func (c Candidate) Locator() string {
	if c.IsCue {
		return retrieval.SubtitleLocator(c.Lang, c.CueStart, c.CueEnd)
	}
	switch c.Kind {
	case retrieval.SourceArticle:
		return retrieval.ArticleLocator(c.Unit, c.SS, c.SE)
	case retrieval.SourcePDF:
		return retrieval.PDFLocator(c.DocHash, c.Unit, c.SS, c.SE)
	}
	return ""
}

func CandidatesOf(snap retrieval.Snapshot) []Candidate {
	var out []Candidate
	addText := func(kind retrieval.SourceKind, unit int, version, docHash, text string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		sents := retrieval.SplitSentences(text)
		for _, seg := range retrieval.GroupSegments(text, sents,
			retrieval.DefaultMaxSentencesPerSegment, retrieval.DefaultMinSegmentRunes, retrieval.DefaultMaxSegmentRunes) {
			if retrieval.RuneLen(seg.Text) > retrieval.DefaultMaxSegmentRunes {
				continue
			}
			out = append(out, Candidate{Kind: kind, Unit: unit, Version: version, DocHash: docHash,
				Text: seg.Text, SS: seg.SentenceStart, SE: seg.SentenceEnd, SR: seg.StartRune, ER: seg.EndRune})
		}
	}
	switch snap.Kind {
	case retrieval.SourceArticle:
		for _, b := range snap.Blocks {
			if b.Kind == "heading" || b.Kind == "code" {
				if strings.TrimSpace(b.Text) == "" || retrieval.RuneLen(b.Text) > retrieval.DefaultMaxSegmentRunes {
					continue
				}
				out = append(out, Candidate{Kind: retrieval.SourceArticle, Unit: b.Index, Version: snap.Version,
					Text: b.Text, SS: 0, SE: 1, SR: 0, ER: retrieval.RuneLen(b.Text)})
				continue
			}
			addText(retrieval.SourceArticle, b.Index, snap.Version, "", b.Text)
		}
	case retrieval.SourceSubtitle:
		for _, track := range snap.Tracks {
			version := fmt.Sprintf("content-revision:%d", track.Revision)
			for _, cs := range retrieval.GroupCueSegments(track.Cues, track.Language,
				retrieval.DefaultMinCuesPerSegment, retrieval.DefaultMaxCuesPerSegment,
				retrieval.DefaultMinCueSpanMs, retrieval.DefaultMaxCueSpanMs) {
				if strings.TrimSpace(cs.Text) == "" || retrieval.RuneLen(cs.Text) > retrieval.DefaultMaxSegmentRunes {
					continue
				}
				out = append(out, Candidate{Kind: retrieval.SourceSubtitle, Lang: track.Language, Version: version,
					Text: cs.Text, SS: cs.CueStart, SE: cs.CueEnd + 1, SR: 0, ER: retrieval.RuneLen(cs.Text),
					IsCue: true, CueStart: cs.CueStart, CueEnd: cs.CueEnd})
			}
		}
	case retrieval.SourcePDF:
		for _, p := range snap.Pages {
			addText(retrieval.SourcePDF, p.Number, retrieval.PDFPageVersion(p), p.DocumentSHA256, p.Text)
		}
	}
	return out
}
