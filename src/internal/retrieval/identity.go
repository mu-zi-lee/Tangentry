package retrieval

import (
	"fmt"
	"strconv"
	"strings"
)

// Locator/ID forms (ADR-002 "Passage contract for C"):
//
//	article:    <contentId>#article:<blockIndex>:s<sent>[:<start>-<end>]
//	            multi-sentence: article:<block>:s<start>-s<end> (end exclusive)
//	discussion: <contentId>#discussion:<postIndex>:<blockIndex>:s<sent>:<start>-<end>
//	subtitle:   <contentId>#subtitle:<language>:<cueStart>-<cueEnd> (+cueIds)
//	pdf:        <contentId>#pdf:<documentSha256>:<page>:s<sent>:<start>-<end>
//
// Ranges are zero-based half-open rune offsets. The locator is the ID minus
// the contentId prefix and (for text units) the rune-range suffix.

func sentRange(start, end int) string {
	if end == start+1 {
		return "s" + strconv.Itoa(start)
	}
	return "s" + strconv.Itoa(start) + "-s" + strconv.Itoa(end)
}

// ArticleLocator builds article:<block>:s<sent>[-s<end>].
func ArticleLocator(blockIndex, sentStart, sentEnd int) string {
	return fmt.Sprintf("article:%d:%s", blockIndex, sentRange(sentStart, sentEnd))
}

// DiscussionLocator builds discussion:<post>:<block>:s<sent>[-s<end>].
func DiscussionLocator(postIndex, blockIndex, sentStart, sentEnd int) string {
	return fmt.Sprintf("discussion:%d:%d:%s", postIndex, blockIndex, sentRange(sentStart, sentEnd))
}

// SubtitleLocator builds subtitle:<language>:<cueStart>-<cueEnd> (inclusive).
func SubtitleLocator(language string, cueStart, cueEnd int) string {
	return fmt.Sprintf("subtitle:%s:%d-%d", language, cueStart, cueEnd)
}

// PDFLocator builds pdf:<docHash>:<page>:s<sent>[-s<end>].
func PDFLocator(docHash string, page, sentStart, sentEnd int) string {
	return fmt.Sprintf("pdf:%s:%d:%s", docHash, page, sentRange(sentStart, sentEnd))
}

// PassageID builds the full passage ID. Subtitle IDs carry the cue range in
// the locator and no rune suffix; text units append :<start>-<end>.
func PassageID(contentID string, kind SourceKind, locator string, startRune, endRune int) string {
	if kind == SourceSubtitle {
		return contentID + "#" + locator
	}
	return fmt.Sprintf("%s#%s:%d-%d", contentID, locator, startRune, endRune)
}

// locatorInfo is the parsed locator structure.
type locatorInfo struct {
	Kind       SourceKind
	PostIndex  int
	BlockIndex int
	SentStart  int
	SentEnd    int // exclusive
	Language   string
	CueStart   int
	CueEnd     int // inclusive
	DocHash    string
	Page       int
}

// parseSentRange parses s3 or s3-s5 (end exclusive).
func parseSentRange(s string) (int, int, error) {
	if !strings.HasPrefix(s, "s") {
		return 0, 0, fmt.Errorf("invalid sentence range %q", s)
	}
	body := s[1:]
	if i := strings.Index(body, "-s"); i >= 0 {
		start, err1 := strconv.Atoi(body[:i])
		end, err2 := strconv.Atoi(body[i+2:])
		if err1 != nil || err2 != nil || start < 0 || end <= start {
			return 0, 0, fmt.Errorf("invalid sentence range %q", s)
		}
		return start, end, nil
	}
	v, err := strconv.Atoi(body)
	if err != nil || v < 0 {
		return 0, 0, fmt.Errorf("invalid sentence range %q", s)
	}
	return v, v + 1, nil
}

// parseLocator parses a locator string; forged/unknown forms are an error.
func parseLocator(locator string) (locatorInfo, error) {
	parts := strings.Split(locator, ":")
	if len(parts) < 2 {
		return locatorInfo{}, fmt.Errorf("invalid locator %q", locator)
	}
	switch SourceKind(parts[0]) {
	case SourceArticle:
		if len(parts) != 3 {
			return locatorInfo{}, fmt.Errorf("invalid article locator %q", locator)
		}
		block, err := strconv.Atoi(parts[1])
		if err != nil || block < 0 {
			return locatorInfo{}, fmt.Errorf("invalid article locator %q", locator)
		}
		s, e, err := parseSentRange(parts[2])
		if err != nil {
			return locatorInfo{}, err
		}
		return locatorInfo{Kind: SourceArticle, BlockIndex: block, SentStart: s, SentEnd: e}, nil
	case SourceDiscussion:
		if len(parts) != 4 {
			return locatorInfo{}, fmt.Errorf("invalid discussion locator %q", locator)
		}
		post, err1 := strconv.Atoi(parts[1])
		block, err2 := strconv.Atoi(parts[2])
		if err1 != nil || err2 != nil || post < 0 || block < 0 {
			return locatorInfo{}, fmt.Errorf("invalid discussion locator %q", locator)
		}
		s, e, err := parseSentRange(parts[3])
		if err != nil {
			return locatorInfo{}, err
		}
		return locatorInfo{Kind: SourceDiscussion, PostIndex: post, BlockIndex: block, SentStart: s, SentEnd: e}, nil
	case SourceSubtitle:
		if len(parts) != 3 {
			return locatorInfo{}, fmt.Errorf("invalid subtitle locator %q", locator)
		}
		lang := parts[1]
		if lang == "" {
			return locatorInfo{}, fmt.Errorf("invalid subtitle locator %q", locator)
		}
		dash := strings.Index(parts[2], "-")
		if dash <= 0 {
			return locatorInfo{}, fmt.Errorf("invalid subtitle locator %q", locator)
		}
		cs, err1 := strconv.Atoi(parts[2][:dash])
		ce, err2 := strconv.Atoi(parts[2][dash+1:])
		if err1 != nil || err2 != nil || cs < 0 || ce < cs {
			return locatorInfo{}, fmt.Errorf("invalid subtitle locator %q", locator)
		}
		return locatorInfo{Kind: SourceSubtitle, Language: lang, CueStart: cs, CueEnd: ce}, nil
	case SourcePDF:
		if len(parts) != 4 {
			return locatorInfo{}, fmt.Errorf("invalid pdf locator %q", locator)
		}
		hash := parts[1]
		if len(hash) != 64 {
			return locatorInfo{}, fmt.Errorf("invalid pdf locator %q", locator)
		}
		page, err := strconv.Atoi(parts[2])
		if err != nil || page < 0 {
			return locatorInfo{}, fmt.Errorf("invalid pdf locator %q", locator)
		}
		s, e, err := parseSentRange(parts[3])
		if err != nil {
			return locatorInfo{}, err
		}
		return locatorInfo{Kind: SourcePDF, DocHash: hash, Page: page, SentStart: s, SentEnd: e}, nil
	}
	return locatorInfo{}, fmt.Errorf("invalid locator %q", locator)
}

// LocatorDocumentHash returns the document SHA-256 embedded in a PDF
// locator (ok=false for non-PDF or malformed locators). Adapters use it to
// detect a replaced document hash and report stale_source.
func LocatorDocumentHash(locator string) (string, bool) {
	info, err := parseLocator(locator)
	if err != nil || info.Kind != SourcePDF {
		return "", false
	}
	return info.DocHash, true
}

// passageOrder derives the deterministic tie-break position from the locator.
func passageOrder(p Passage) sourceOrder {
	info, err := parseLocator(p.Locator)
	if err != nil {
		return sourceOrder{kind: kindPriority(p.Source), unit: 1 << 30, segment: p.SentenceStart}
	}
	o := sourceOrder{kind: kindPriority(info.Kind), segment: info.SentStart}
	switch info.Kind {
	case SourceArticle:
		o.unit = info.BlockIndex
	case SourceDiscussion:
		o.unit = info.PostIndex
		o.sub = info.BlockIndex
	case SourceSubtitle:
		o.unit = info.CueStart
		o.lang = info.Language
	case SourcePDF:
		o.unit = info.Page
	}
	return o
}
