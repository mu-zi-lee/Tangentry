package retrieval

import "context"

// Block is one normalized article/discussion block. Index is the stable
// zero-based position in the source array (article blocks have no DB ID).
type Block struct {
	Index int
	Kind  string // "paragraph", "heading", ... (content.ArticleBlock.Kind)
	Level int    // heading level when Kind == "heading"
	Text  string
}

// DiscussionPost is one post's ordered blocks.
type DiscussionPost struct {
	Index  int
	Blocks []Block
}

// Cue is one saved subtitle cue with its stable ID and timing.
type Cue struct {
	ID       string
	Language string
	StartMs  int64
	EndMs    int64
	Text     string
}

// SubtitleTrack is one saved language track with its saved-row revision.
type SubtitleTrack struct {
	Language string
	Revision int64
	Cues     []Cue
}

// Page is stored server-side PDF page text (pdf_page_text store, phase 3).
type Page struct {
	Number           int
	Text             string
	DocumentSHA256   string
	Extractor        string
	ExtractorVersion string
}

// Snapshot is the normalized document snapshot loaded through PassageSource.
// Version is the article/discussion source version ("content-revision:<n>"
// or legacy "text-sha256:<hex>"); subtitle tracks and PDF pages carry their
// own versions (saved revision; document hash + extractor provenance).
type Snapshot struct {
	ContentID string
	Kind      SourceKind
	Version   string
	Blocks    []Block          // article
	Posts     []DiscussionPost // discussion
	Tracks    []SubtitleTrack  // subtitle
	Pages     []Page           // pdf
}

// PassageSource loads normalized snapshots and re-reads exact source ranges
// for INV-05 verification. Implemented by adapters (phase 2+); the domain
// never trusts a passage that the port cannot re-read.
type PassageSource interface {
	// Snapshot returns the current normalized document for contentID.
	Snapshot(ctx context.Context, contentID string) (Snapshot, error)
	// ReadRange re-reads the exact current text at a locator range and
	// returns it with the current source version. locator uses the plan
	// forms: article:<block>:s<sent>, discussion:<post>:<block>:s<sent>,
	// subtitle:<lang>:<cueStart>-<cueEnd>, pdf:<docHash>:<page>:s<sent>.
	// startRune/endRune are zero-based half-open code-point offsets within
	// the named unit (joined cue text for subtitles).
	ReadRange(ctx context.Context, contentID, locator string, startRune, endRune int) (text string, version string, err error)
}

// PDFText reads stored server-side PDF page text. Implemented in phase 3;
// retrieval never trusts browser-supplied page text.
type PDFText interface {
	Pages(ctx context.Context, contentID string) ([]Page, error)
}

// UsageSink receives the usage validity of one embedding response. The
// per-invocation BudgetTracker implements it: a response without valid usage
// stops the remaining requests of that invocation only.
type UsageSink interface {
	MarkUsageUnknown()
}

// UsageReportingEmbedder is an optional Embedder extension for adapters that
// can report provider usage validity per call. The engine supplies its
// per-invocation tracker as the sink; the adapter reports into it without
// reserving a second budget slot (the engine wrapper already reserved one).
type UsageReportingEmbedder interface {
	EmbedWithUsage(ctx context.Context, texts []string, role EmbedRole, usage UsageSink) ([][]float32, error)
}
