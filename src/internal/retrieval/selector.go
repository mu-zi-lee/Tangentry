package retrieval

import (
	"context"
	"errors"
	"sort"
	"strings"
)

// Selector modes (wire retrieval.mode).
const (
	ModeHybrid    = "hybrid"
	ModeEmbedding = "embedding"
	ModeLexical   = "lexical"
)

// ModeLexicalOnly is the Selection.Mode value when no embedding ran
// (Selection.Mode is "hybrid or lexical_only" per plan).
const ModeLexicalOnly = "lexical_only"

// SelectorConfig configures the domain selector. Budget carries the
// embedding budget inputs; AssemblyBudgetRunes/MaxBytes feed the INV-04
// preflight so an impossible assembly starts zero requests.
type SelectorConfig struct {
	TopK                int
	Sweep               SweepConfig
	Budget              BudgetConfig
	Weights             Weights
	MaxPassageRunes     int // per-passage cap; segments above it drop as oversize_dropped
	AssemblyBudgetRunes int
	MaxBytes            int
	Mode                string // hybrid (default), embedding, lexical
}

func (c SelectorConfig) withDefaults() SelectorConfig {
	if c.TopK <= 0 {
		c.TopK = 100
	}
	if c.MaxPassageRunes <= 0 {
		c.MaxPassageRunes = DefaultMaxSegmentRunes
	}
	// AssemblyBudgetRunes is NOT defaulted here: an explicit 0/negative is
	// invalid_budget (B-T10). Omission is a labelled default applied by the
	// wire layer (phase 5), which distinguishes absent from explicit zero.
	if c.MaxBytes <= 0 {
		c.MaxBytes = DefaultMaxBytes
	}
	if c.Mode == "" {
		c.Mode = ModeHybrid
	}
	if c.Budget.Mode == "" {
		c.Budget.Mode = BatchingShared
	}
	if c.Budget.BatchSize <= 0 {
		c.Budget.BatchSize = 8
	}
	if c.Budget.MaxEmbeddingChars <= 0 {
		c.Budget.MaxEmbeddingChars = 100000
	}
	return c
}

type selector struct {
	src PassageSource
	emb Embedder
	cfg SelectorConfig
}

// NewSelector builds the domain PassageSelector. emb may be nil (lexical-only
// path; no paraphrase claim). src is the re-read port for INV-05.
func NewSelector(src PassageSource, emb Embedder, cfg SelectorConfig) PassageSelector {
	return &selector{src: src, emb: emb, cfg: cfg.withDefaults()}
}

// candidate is one segment under consideration, with its provenance.
type candidate struct {
	kind      SourceKind
	unitIndex int // block index / page number
	postIndex int // discussion only
	language  string
	docHash   string
	version   string
	seg       Segment
	cue       *CueSegment
	lexical   LexicalResult
	vector    []float32
	cosine    float64
	fromSweep bool
}

func (c *candidate) text() string {
	if c.cue != nil {
		return c.cue.Text
	}
	return c.seg.Text
}

func (c *candidate) runes() int { return RuneLen(c.text()) }

// Select runs the INV-04 ordered pipeline: validate budget → preflight →
// load/split → lexical → sweep → embedding → dedupe/verify → Selection.
// The chat POST is the caller's last step (phase 5); the domain never chats.
func (s *selector) Select(ctx context.Context, contentID, question string, maxCandidates int) (Selection, error) {
	cfg := s.cfg
	if maxCandidates > 0 {
		cfg.TopK = maxCandidates
	}
	sel := Selection{Mode: ModeLexicalOnly}

	// 1. Input validation (zero provider work).
	if ContainsNUL(question) || ContainsNUL(contentID) {
		sel.Status = SelectionInvalidInput
		return sel, nil
	}
	if strings.TrimSpace(question) == "" {
		sel.Status = SelectionEmpty
		return sel, nil
	}

	// 2. Budget validation BEFORE any request (invalid_budget).
	weights, err := ValidateWeights(cfg.Weights)
	if err != nil {
		sel.Status = SelectionInvalidBudget
		return sel, nil
	}
	cfg.Weights = weights
	cfg.Budget.QuestionChars = RuneLen(question)
	cfg.Budget.TopK = cfg.TopK
	cfg.Budget.SweepCandidates = cfg.Sweep.SweepCandidates
	shares, err := ComputeShares(cfg.Budget)
	if err != nil {
		sel.Status = SelectionInvalidBudget
		return sel, nil
	}
	sel.SlotBudget = shares.SlotBudget
	sel.CharBudget = shares.CharBudget
	sel.LexicalSlots = shares.LexicalSlots
	sel.Sweep.Slots = shares.SweepSlots
	sel.Sweep.Chars = shares.SweepChars

	// 3. Preflight feasibility (zero chat/embedding/rerank on failure).
	if err := Preflight(cfg.AssemblyBudgetRunes, cfg.MaxBytes); err != nil {
		if errors.Is(err, ErrInvalidBudget) {
			sel.Status = SelectionInvalidBudget
		} else {
			sel.Status = SelectionContextBudgetExceeded
		}
		return sel, nil
	}

	// 4. Load and split the source.
	snap, err := s.src.Snapshot(ctx, contentID)
	if err != nil {
		return Selection{}, err
	}
	cands, oversize := s.segments(snap, cfg.MaxPassageRunes)
	if len(cands) == 0 {
		if oversize > 0 {
			sel.Status = SelectionOversizeDropped
			sel.Dropped = oversize
			return sel, nil
		}
		sel.Status = SelectionNoMatch
		return sel, nil
	}

	// 5. Lexical candidates (deterministic, zero provider calls).
	// The embedding allocation constrains the lexical side only when
	// embedding is actually possible; a zero-capacity/no-embedder run falls
	// back to lexical_only with the full top-K shortlist (B-T33: R=0 →
	// lexical_only + embedding_budget_exhausted, not an empty result).
	embeddingPossible := s.emb != nil && cfg.Mode != ModeLexical && shares.SlotBudget >= 1
	lexSlots, lexChars := shares.LexicalSlots, shares.LexicalChars
	if !embeddingPossible {
		lexSlots, lexChars = cfg.TopK, shares.CharBudget
	}
	terms := QueryTerms(question)
	var lexical []*candidate
	if cfg.Mode != ModeEmbedding {
		for i := range cands {
			cands[i].lexical = ScoreLexical(question, terms, cands[i].text())
		}
		for i := range cands {
			if cands[i].lexical.Score > 0 {
				lexical = append(lexical, &cands[i])
			}
		}
		sort.SliceStable(lexical, func(i, j int) bool {
			if lexical[i].lexical.Score != lexical[j].lexical.Score {
				return lexical[i].lexical.Score > lexical[j].lexical.Score
			}
			return candidateOrderLess(lexical[i], lexical[j])
		})
		lexical = takeWithinBudget(lexical, lexSlots, lexChars)
		if len(lexical) > 0 {
			sel.LexicalCoverage = lexical[0].lexical.Coverage
		}
	}
	sel.LexicalSelected = len(lexical)

	// 6. Unconditional bounded semantic sweep (whenever an embedder is
	// configured and the mode allows embedding). No "shortlist too small /
	// zero overlap" trigger exists.
	union := append([]*candidate(nil), lexical...)
	inUnion := map[*candidate]bool{}
	for _, c := range union {
		inUnion[c] = true
	}
	if s.emb != nil && cfg.Mode != ModeLexical {
		s.sweep(&sel, cands, inUnion, &union, shares, cfg)
	}

	if len(union) == 0 {
		sel.Status = SelectionNoMatch
		return sel, nil
	}

	// 7. Embedding (B budget; zero capacity → lexical_only, no query call).
	var passages []Passage
	if embeddingPossible {
		qvec, ok := s.embedUnion(ctx, question, union, cfg.Budget.BatchSize)
		if ok {
			sel.EmbeddingModel = s.emb.ModelID()
			for _, c := range union {
				c.cosine = Cosine(qvec, c.vector)
			}
			maxLex := 0.0
			for _, c := range union {
				if c.lexical.Score > maxLex {
					maxLex = c.lexical.Score
				}
			}
			for _, c := range union {
				lexNorm := 0.0
				if maxLex > 0 {
					lexNorm = c.lexical.Score / maxLex
				}
				passages = append(passages, c.passage(contentID, weights, lexNorm))
			}
			sel.Mode = ModeHybrid
		}
	}
	if passages == nil {
		// lexical-only path (no embedder, zero capacity, or embedder failure):
		// score is the normalized lexical component; no hybrid claim.
		maxLex := 0.0
		for _, c := range union {
			if c.lexical.Score > maxLex {
				maxLex = c.lexical.Score
			}
		}
		for _, c := range union {
			lexNorm := 0.0
			if maxLex > 0 {
				lexNorm = c.lexical.Score / maxLex
			}
			passages = append(passages, c.passage(contentID, weights, lexNorm))
		}
		sel.Mode = ModeLexicalOnly
		if s.emb != nil {
			sel.EmbeddingModel = s.emb.ModelID()
		}
	}

	// 8. Dedupe → stable sort → INV-05 re-read verification.
	kept, dupDropped := Dedupe(passages)
	SortPassages(kept, nil)
	// No evidence at all (zero lexical and zero semantic similarity) is an
	// explicit no_match, never a head/tail fallback presented as evidence.
	if len(kept) > 0 && kept[0].Score <= 0 {
		sel.Status = SelectionNoMatch
		sel.Dropped = dupDropped + oversize
		return sel, nil
	}
	verified, vDropped, err := VerifyPassages(ctx, s.src, kept)
	if err != nil {
		return Selection{}, err
	}
	sel.Passages = verified
	sel.Dropped = dupDropped + len(vDropped) + oversize

	// 9. Explicit status (never a generic provider error).
	switch {
	case len(verified) == 0 && len(kept) > 0:
		if allStale(vDropped) {
			sel.Status = SelectionStaleSource
		} else {
			sel.Status = SelectionNoVerifiedPassages
		}
	case sel.Mode == ModeLexicalOnly:
		sel.Status = SelectionLexicalOnly
	case sel.Sweep.Limited || sel.Sweep.ZeroReason != "":
		sel.Status = SelectionSweepLimited
	default:
		sel.Status = SelectionOK
	}
	return sel, nil
}

func allStale(dropped []DroppedPassage) bool {
	if len(dropped) == 0 {
		return false
	}
	for _, d := range dropped {
		if d.Reason != DropStaleSource {
			return false
		}
	}
	return true
}

// embedUnion embeds the question and candidate texts with mode-aware
// batching and sets each candidate's vector. Split mode reserves one query
// request (text_type=query) and never mixes roles; shared mode batches the
// question with the documents (identical request-level config, no text_type)
// so the cold-cache request count is ceil((1+C)/B). Returns the question
// vector and ok=false on any embedder failure (caller falls back to lexical).
func (s *selector) embedUnion(ctx context.Context, question string, union []*candidate, batch int) ([]float32, bool) {
	if batch <= 0 {
		batch = 8
	}
	if s.emb.BatchingMode() == BatchingSplit {
		qvecs, err := s.emb.Embed(ctx, []string{question}, EmbedQuery)
		if err != nil || len(qvecs) != 1 {
			return nil, false
		}
		for start := 0; start < len(union); start += batch {
			end := minInt(start+batch, len(union))
			texts := make([]string, 0, end-start)
			for _, c := range union[start:end] {
				texts = append(texts, c.text())
			}
			vecs, err := s.emb.Embed(ctx, texts, EmbedDocument)
			if err != nil || len(vecs) != len(texts) {
				return nil, false
			}
			for i, c := range union[start:end] {
				c.vector = vecs[i]
			}
		}
		return qvecs[0], true
	}
	// Shared: question is texts[0]; question + documents share each batch.
	all := make([]string, 0, len(union)+1)
	all = append(all, question)
	for _, c := range union {
		all = append(all, c.text())
	}
	var qvec []float32
	for start := 0; start < len(all); start += batch {
		end := minInt(start+batch, len(all))
		vecs, err := s.emb.Embed(ctx, all[start:end], EmbedDocument)
		if err != nil || len(vecs) != end-start {
			return nil, false
		}
		for i := start; i < end; i++ {
			if i == 0 {
				qvec = vecs[0]
				continue
			}
			union[i-1].vector = vecs[i-start]
		}
	}
	return qvec, true
}

// sweep adds the deterministic position-stratified sample to the union.
func (s *selector) sweep(sel *Selection, cands []candidate, inUnion map[*candidate]bool, union *[]*candidate, shares Shares, cfg SelectorConfig) {
	n := len(cands)
	if cfg.Sweep.SweepCandidates == 0 {
		sel.Sweep.ZeroReason = SweepReasonDisabledByConfig
		sel.Sweep.Limited = true
		return
	}
	quota := shares.SweepSlots
	if quota == 0 || shares.SweepChars < 1 {
		sel.Sweep.ZeroReason = SweepReasonZeroSlots
		sel.Sweep.Limited = true
		return
	}
	sample := SampleSweep(n, quota)
	sel.Sweep.Stride = sample.Stride
	added := 0
	chars := 0
	for _, idx := range sample.Indices {
		c := &cands[idx]
		if inUnion[c] {
			continue
		}
		r := c.runes()
		if added >= quota || chars+r > shares.SweepChars {
			break
		}
		inUnion[c] = true
		c.fromSweep = true
		*union = append(*union, c)
		added++
		chars += r
	}
	sel.Sweep.Used = added > 0
	sel.Sweep.Sampled = added
	sel.Sweep.Coverage = float64(added) / float64(n)
	sel.Sweep.Limited = added < n
	if added == 0 {
		sel.Sweep.ZeroReason = SweepReasonZeroSlots
	}
}

func (c *candidate) passage(contentID string, w Weights, lexNorm float64) Passage {
	var loc string
	var start, end, ss, se int
	var cueIDs []string
	if c.cue != nil {
		loc = SubtitleLocator(c.language, c.cue.CueStart, c.cue.CueEnd)
		start, end = c.cue.StartRune, c.cue.EndRune
		ss, se = c.cue.CueStart, c.cue.CueEnd+1
		cueIDs = c.cue.CueIDs
	} else {
		switch c.kind {
		case SourceArticle:
			loc = ArticleLocator(c.unitIndex, c.seg.SentenceStart, c.seg.SentenceEnd)
		case SourceDiscussion:
			loc = DiscussionLocator(c.postIndex, c.unitIndex, c.seg.SentenceStart, c.seg.SentenceEnd)
		case SourcePDF:
			loc = PDFLocator(c.docHash, c.unitIndex, c.seg.SentenceStart, c.seg.SentenceEnd)
		}
		start, end = c.seg.StartRune, c.seg.EndRune
		ss, se = c.seg.SentenceStart, c.seg.SentenceEnd
	}
	text := c.text()
	score := HybridScore(w, lexNorm, c.cosine, 0)
	if c.vector == nil {
		score = lexNorm // lexical-only: score is the lexical component
	}
	return Passage{
		ID:            PassageID(contentID, c.kind, loc, start, end),
		ContentID:     contentID,
		Source:        c.kind,
		Locator:       loc,
		SentenceStart: ss,
		SentenceEnd:   se,
		StartRune:     start,
		EndRune:       end,
		Text:          text,
		Score:         score,
		LexicalScore:  c.lexical.Score,
		CosineScore:   c.cosine,
		SourceVersion: c.version,
		TextSHA256:    TextSHA256(text),
		CueIDs:        cueIDs,
	}
}

func candidateOrderLess(a, b *candidate) bool {
	ka, kb := kindPriority(a.kind), kindPriority(b.kind)
	if ka != kb {
		return ka < kb
	}
	if a.postIndex != b.postIndex {
		return a.postIndex < b.postIndex
	}
	if a.unitIndex != b.unitIndex {
		return a.unitIndex < b.unitIndex
	}
	if a.language != b.language {
		return a.language < b.language
	}
	if a.cue != nil && b.cue != nil {
		return a.cue.CueStart < b.cue.CueStart
	}
	return a.seg.SentenceStart < b.seg.SentenceStart
}

// takeWithinBudget takes up to slots candidates within the char allowance.
func takeWithinBudget(cs []*candidate, slots, chars int) []*candidate {
	var out []*candidate
	used := 0
	for _, c := range cs {
		if len(out) >= slots {
			break
		}
		r := c.runes()
		if used+r > chars {
			break
		}
		out = append(out, c)
		used += r
	}
	return out
}

// segments splits the snapshot into canonical candidates, dropping empty
// segments and counting oversize drops. Headings and code blocks are single
// segments (never crossed); PDF pages never cross.
func (s *selector) segments(snap Snapshot, maxPassageRunes int) ([]candidate, int) {
	var out []candidate
	oversize := 0
	addText := func(kind SourceKind, unitIndex, postIndex int, version, docHash, text string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		for _, seg := range segmentsFromUnit(unitIndex, text, DefaultMaxSentencesPerSegment, DefaultMinSegmentRunes, DefaultMaxSegmentRunes) {
			if RuneLen(seg.Text) > maxPassageRunes {
				oversize++
				continue
			}
			out = append(out, candidate{kind: kind, unitIndex: unitIndex, postIndex: postIndex, version: version, docHash: docHash, seg: seg})
		}
	}
	switch snap.Kind {
	case SourceArticle:
		for _, b := range snap.Blocks {
			if b.Kind == "heading" || b.Kind == "code" {
				if strings.TrimSpace(b.Text) == "" {
					continue
				}
				if RuneLen(b.Text) > maxPassageRunes {
					oversize++
					continue
				}
				out = append(out, candidate{kind: SourceArticle, unitIndex: b.Index, version: snap.Version,
					seg: Segment{UnitIndex: b.Index, SentenceStart: 0, SentenceEnd: 1, StartRune: 0, EndRune: RuneLen(b.Text), Text: b.Text}})
				continue
			}
			addText(SourceArticle, b.Index, 0, snap.Version, "", b.Text)
		}
	case SourceDiscussion:
		for _, post := range snap.Posts {
			for _, b := range post.Blocks {
				addText(SourceDiscussion, b.Index, post.Index, snap.Version, "", b.Text)
			}
		}
	case SourceSubtitle:
		for _, track := range snap.Tracks {
			version := subtitleVersion(track.Revision)
			for _, cs := range GroupCueSegments(track.Cues, track.Language, DefaultMinCuesPerSegment, DefaultMaxCuesPerSegment, DefaultMinCueSpanMs, DefaultMaxCueSpanMs) {
				if strings.TrimSpace(cs.Text) == "" {
					continue
				}
				if RuneLen(cs.Text) > maxPassageRunes {
					oversize++
					continue
				}
				cue := cs
				out = append(out, candidate{kind: SourceSubtitle, language: track.Language, version: version, cue: &cue})
			}
		}
	case SourcePDF:
		for _, page := range snap.Pages {
			version := pdfVersion(page)
			addText(SourcePDF, page.Number, 0, version, page.DocumentSHA256, page.Text)
		}
	}
	return out, oversize
}
