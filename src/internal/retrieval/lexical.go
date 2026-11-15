package retrieval

import (
	"sort"
	"strings"
	"unicode"
)

// LexicalResult is the deterministic lexical score breakdown for one passage.
// Score is in [0,1]; Coverage counts distinct query terms matched.
type LexicalResult struct {
	Score       float64
	Coverage    int
	ExactPhrase bool
	TF          float64 // saturating term-frequency component
	Proximity   float64
}

// Internal lexical component weights (fixed, not user-configurable; the
// user-configurable weights combine lexical/embedding/rerank at the hybrid
// level). Exact normalized phrase match saturates the score.
const (
	lexicalCoverageWeight  = 0.5
	lexicalTFWeight        = 0.3
	lexicalProximityWeight = 0.2
)

// QueryTerms extracts distinct normalized query terms in deterministic
// (sorted) order: Latin/digit word tokens plus CJK character bigrams (single
// CJK characters when the query has only one). Punctuation is dropped.
func QueryTerms(question string) []string {
	norm := NormalizeMatch(question)
	seen := map[string]bool{}
	var terms []string
	add := func(t string) {
		if t != "" && !seen[t] {
			seen[t] = true
			terms = append(terms, t)
		}
	}
	var word strings.Builder
	var cjk []rune
	flushWord := func() {
		if word.Len() > 0 {
			add(word.String())
			word.Reset()
		}
	}
	flushCJK := func() {
		if len(cjk) == 1 {
			add(string(cjk))
		}
		for i := 0; i+1 < len(cjk); i++ {
			add(string(cjk[i : i+2]))
		}
		cjk = cjk[:0]
	}
	for _, r := range norm {
		switch {
		case isCJK(r):
			flushWord()
			cjk = append(cjk, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushCJK()
			word.WriteRune(r)
		default:
			flushWord()
			flushCJK()
		}
	}
	flushWord()
	flushCJK()
	sort.Strings(terms)
	return terms
}

// termPositions tokenizes normalized text into the same term space as
// QueryTerms and records each term's occurrence positions (token indices).
func termPositions(norm string) map[string][]int {
	positions := map[string][]int{}
	pos := 0
	var word strings.Builder
	var cjk []rune
	emit := func(t string) {
		if t != "" {
			positions[t] = append(positions[t], pos)
		}
	}
	flushWord := func() {
		if word.Len() > 0 {
			emit(word.String())
			pos++
			word.Reset()
		}
	}
	flushCJK := func() {
		if len(cjk) == 1 {
			emit(string(cjk))
			pos++
		}
		for i := 0; i+1 < len(cjk); i++ {
			emit(string(cjk[i : i+2]))
			pos++
		}
		cjk = cjk[:0]
	}
	for _, r := range norm {
		switch {
		case isCJK(r):
			flushWord()
			cjk = append(cjk, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushCJK()
			word.WriteRune(r)
		default:
			flushWord()
			flushCJK()
		}
	}
	flushWord()
	flushCJK()
	return positions
}

// ScoreLexical scores one passage text against the question deterministically:
// exact normalized phrase, distinct-term coverage, saturating TF and
// proximity. Pure function; no provider call.
func ScoreLexical(question string, terms []string, text string) LexicalResult {
	if len(terms) == 0 {
		return LexicalResult{}
	}
	normText := NormalizeMatch(text)
	normQuestion := NormalizeMatch(question)
	if normQuestion != "" && strings.Contains(normText, normQuestion) {
		return LexicalResult{Score: 1, Coverage: len(terms), ExactPhrase: true, TF: 1, Proximity: 1}
	}
	positions := termPositions(normText)
	matched := 0
	var tfSum float64
	var matchedTerms []string
	for _, t := range terms {
		occ := positions[t]
		if len(occ) == 0 {
			continue
		}
		matched++
		matchedTerms = append(matchedTerms, t)
		tf := float64(len(occ))
		tfSum += tf / (tf + 1) // saturating TF
	}
	if matched == 0 {
		return LexicalResult{}
	}
	coverage := float64(matched) / float64(len(terms))
	tf := tfSum / float64(len(terms))
	proximity := proximityScore(positions, matchedTerms)
	score := lexicalCoverageWeight*coverage + lexicalTFWeight*tf + lexicalProximityWeight*proximity
	return LexicalResult{Score: score, Coverage: matched, TF: tf, Proximity: proximity}
}

// proximityScore measures how close the matched terms sit: the smallest
// token window containing every matched term, mapped to 1/(1+span).
// A single matched term has proximity 1.
func proximityScore(positions map[string][]int, matchedTerms []string) float64 {
	if len(matchedTerms) <= 1 {
		return 1
	}
	// Merge all occurrence positions tagged by term; slide a window.
	type occurrence struct {
		pos  int
		term string
	}
	var all []occurrence
	for _, t := range matchedTerms {
		for _, p := range positions[t] {
			all = append(all, occurrence{p, t})
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].pos != all[j].pos {
			return all[i].pos < all[j].pos
		}
		return all[i].term < all[j].term
	})
	need := len(matchedTerms)
	counts := map[string]int{}
	have := 0
	best := -1
	left := 0
	for right := 0; right < len(all); right++ {
		if counts[all[right].term] == 0 {
			have++
		}
		counts[all[right].term]++
		for have == need {
			span := all[right].pos - all[left].pos
			if best < 0 || span < best {
				best = span
			}
			counts[all[left].term]--
			if counts[all[left].term] == 0 {
				have--
			}
			left++
		}
	}
	if best < 0 {
		return 0
	}
	return 1.0 / float64(1+best)
}
