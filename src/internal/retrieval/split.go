package retrieval

import (
	"strings"
	"unicode"
)

// Sentence is one sentence inside a source unit (block or page), with
// zero-based half-open rune offsets into the unit text.
type Sentence struct {
	Index     int
	StartRune int
	EndRune   int
	Text      string
}

// Segment is a canonical 1–3 sentence group (or oversized single sentence).
// v1 uses no overlap: one canonical segment per gold sentence.
type Segment struct {
	UnitIndex     int // block index (article/discussion) or page number (PDF)
	SentenceStart int
	SentenceEnd   int // exclusive
	StartRune     int // within the unit text
	EndRune       int
	Text          string // exact source slice [StartRune, EndRune)
}

// CueSegment is a canonical subtitle cue group preserving IDs/language/times.
type CueSegment struct {
	Language  string
	CueStart  int // inclusive cue index
	CueEnd    int // inclusive cue index
	CueIDs    []string
	StartMs   int64
	EndMs     int64
	Text      string // exact cue texts joined with "\n"
	StartRune int    // 0 within the joined text
	EndRune   int    // RuneLen(Text)
}

// Default segment grouping parameters (plan §"Passage type").
const (
	DefaultMaxSentencesPerSegment = 3
	DefaultMinSegmentRunes        = 200
	DefaultMaxSegmentRunes        = 800
	DefaultMinCuesPerSegment      = 3
	DefaultMaxCuesPerSegment      = 8
	DefaultMinCueSpanMs           = 15000
	DefaultMaxCueSpanMs           = 60000
)

// abbreviations are common Latin abbreviations whose period does not end a
// sentence. Matching is deterministic and case-insensitive.
var abbreviations = map[string]bool{
	"dr": true, "mr": true, "mrs": true, "ms": true, "prof": true,
	"st": true, "vs": true, "etc": true, "eg": true, "ie": true,
	"vol": true, "fig": true, "no": true, "jr": true, "sr": true,
}

// SplitSentences splits unit text on CJK and Latin sentence terminators.
// Quotes and abbreviations are kept together where possible; fenced code
// spans are never split. Offsets are rune offsets into the input; every
// sentence Text is the exact input slice. Empty/whitespace input yields no
// sentences. Astral characters are handled as whole runes (no split
// surrogates in Go strings).
func SplitSentences(text string) []Sentence {
	runes := []rune(text)
	n := len(runes)
	var out []Sentence
	start := -1 // rune index of current sentence start (-1 = none)
	inQuote := false
	inFence := false
	fenceRun := 0

	flush := func(end int) {
		if start < 0 {
			return
		}
		// Trim trailing whitespace from the sentence range.
		for end > start && unicode.IsSpace(runes[end-1]) {
			end--
		}
		if end > start {
			out = append(out, Sentence{
				Index:     len(out),
				StartRune: start,
				EndRune:   end,
				Text:      string(runes[start:end]),
			})
		}
		start = -1
	}

	for i := 0; i < n; i++ {
		r := runes[i]
		if start < 0 {
			if unicode.IsSpace(r) {
				continue
			}
			start = i
		}
		// Track fenced code blocks (```): never split inside.
		if r == '`' {
			fenceRun++
			if fenceRun == 3 {
				inFence = !inFence
				fenceRun = 0
			}
			continue
		}
		fenceRun = 0
		if inFence {
			continue
		}
		switch r {
		case '"':
			inQuote = !inQuote // ASCII double quote toggles
			continue
		case '“', '「', '『':
			inQuote = true
			continue
		case '”', '」', '』':
			inQuote = false
			continue
		}
		if inQuote {
			continue
		}
		if !isSentenceTerminator(r) {
			continue
		}
		end := i + 1
		// Consume repeated ellipsis runes (……) as one terminator.
		if r == '…' {
			for end < n && runes[end] == '…' {
				end++
			}
		}
		// Latin period heuristics: abbreviations, decimals, lowercase follow.
		if r == '.' && !latinPeriodEndsSentence(runes, i, end) {
			continue
		}
		// Attach closing quotes/brackets immediately after the terminator.
		for end < n && isClosingQuote(runes[end]) {
			end++
		}
		flush(end)
		i = end - 1 // skip consumed terminator/quote runes
	}
	flush(n)
	return out
}

// latinPeriodEndsSentence decides whether a Latin '.' at index i ends a
// sentence. It does not when it is a decimal point, a known abbreviation,
// or followed by a lowercase letter (e.g. "e.g. this").
func latinPeriodEndsSentence(runes []rune, i, end int) bool {
	n := len(runes)
	if i > 0 && i+1 < n && unicode.IsDigit(runes[i-1]) && unicode.IsDigit(runes[i+1]) {
		return false // decimal number
	}
	// Gather the word before the period.
	j := i - 1
	for j >= 0 && (unicode.IsLetter(runes[j]) || runes[j] == '.') {
		j--
	}
	word := strings.ToLower(string(runes[j+1 : i]))
	word = strings.Trim(word, ".")
	if abbreviations[word] {
		return false
	}
	// Single-letter initials (U.S. style): keep together.
	if len([]rune(word)) == 1 && unicode.IsLetter([]rune(word)[0]) {
		return false
	}
	// Look at the next non-space rune: lowercase means continuation.
	k := end
	for k < n && unicode.IsSpace(runes[k]) {
		k++
	}
	if k < n && unicode.IsLower(runes[k]) {
		return false
	}
	return true
}

// GroupSegments groups adjacent sentences into canonical segments: up to
// maxSentences sentences, growing while under minRunes and never exceeding
// maxRunes. A single sentence longer than maxRunes is emitted whole and
// marked oversized by the caller (dropped as oversize_dropped, never split
// mid-sentence into a partial locator). text is the exact unit text; every
// segment Text is re-sliced from it so ranges always map back verbatim.
func GroupSegments(text string, sents []Sentence, maxSentences, minRunes, maxRunes int) []Segment {
	runes := []rune(text)
	var out []Segment
	for i := 0; i < len(sents); {
		first := sents[i]
		last := first
		count := 1
		for count < maxSentences && i+count < len(sents) {
			if last.EndRune-first.StartRune >= minRunes {
				break // reached the target size; stop before adding more
			}
			next := sents[i+count]
			span := next.EndRune - first.StartRune
			if span > maxRunes {
				break
			}
			last = next
			count++
		}
		out = append(out, Segment{
			SentenceStart: first.Index,
			SentenceEnd:   last.Index + 1,
			StartRune:     first.StartRune,
			EndRune:       last.EndRune,
			Text:          string(runes[first.StartRune:last.EndRune]),
		})
		i += count
	}
	return out
}

// segmentsFromUnit splits and groups one unit's text into canonical segments.
func segmentsFromUnit(unitIndex int, text string, maxSentences, minRunes, maxRunes int) []Segment {
	sents := SplitSentences(text)
	groups := GroupSegments(text, sents, maxSentences, minRunes, maxRunes)
	for i := range groups {
		groups[i].UnitIndex = unitIndex
	}
	return groups
}

// GroupCueSegments groups consecutive cues into canonical subtitle segments:
// 3–8 cues or 15–60 seconds, preserving CueIDs, language and times. The
// segment text is the exact cue texts joined with "\n".
func GroupCueSegments(cues []Cue, language string, minCues, maxCues int, minSpanMs, maxSpanMs int64) []CueSegment {
	var out []CueSegment
	for i := 0; i < len(cues); {
		first := cues[i]
		count := 1
		last := first
		for count < maxCues && i+count < len(cues) {
			next := cues[i+count]
			if next.EndMs-first.StartMs > maxSpanMs {
				break
			}
			last = next
			count++
			if count >= minCues && last.EndMs-first.StartMs >= minSpanMs {
				break
			}
		}
		texts := make([]string, 0, count)
		ids := make([]string, 0, count)
		for k := i; k < i+count; k++ {
			texts = append(texts, cues[k].Text)
			ids = append(ids, cues[k].ID)
		}
		joined := strings.Join(texts, "\n")
		out = append(out, CueSegment{
			Language:  language,
			CueStart:  i,
			CueEnd:    i + count - 1,
			CueIDs:    ids,
			StartMs:   first.StartMs,
			EndMs:     last.EndMs,
			Text:      joined,
			StartRune: 0,
			EndRune:   RuneLen(joined),
		})
		i += count
	}
	return out
}
