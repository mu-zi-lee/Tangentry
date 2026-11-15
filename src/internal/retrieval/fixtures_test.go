package retrieval

import (
	"context"
	"fmt"
	"hash/fnv"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Fixed fixtures. Gold labels for THESE unit fixtures are defined by the test
// specs (B-T02/B-T39/B-T40); the Phase-7 evaluation set is separate and
// human-owned (WANG Jiaqi). No real user data.
// ---------------------------------------------------------------------------

// goldB01 is the B-BASE-01 gold answer (32 runes), identical to the baseline
// evidence fixture in docs/evidence/b-baseline.md.
const goldB01 = "【B-BASE-01 黄金答案】中段检索目标：答案位于文档中部。"

// fixture156k builds the fixed 156,032-rune article with the gold sentence at
// rune offset ~78,000. Filler sentences are segmentable (。 terminators), so
// the splitter produces canonical segments; the baseline head/tail shape is
// preserved (6500+6500 filler sentences around the gold).
func fixture156k(t *testing.T) (source, gold string, goldOffset int) {
	t.Helper()
	unit := func(i int) string { return fmt.Sprintf("文章段落内容%05d。", i) }
	if RuneLen(unit(0)) != 12 {
		t.Fatalf("filler unit length changed: %d", RuneLen(unit(0)))
	}
	if RuneLen(goldB01) != 32 {
		t.Fatalf("gold length changed: %d", RuneLen(goldB01))
	}
	var b strings.Builder
	for i := 0; i < 6500; i++ {
		b.WriteString(unit(i))
	}
	offset := RuneLen(b.String())
	b.WriteString(goldB01)
	for i := 6500; i < 13000; i++ {
		b.WriteString(unit(i))
	}
	source = b.String()
	if RuneLen(source) != 156032 {
		t.Fatalf("fixture total = %d, want 156032", RuneLen(source))
	}
	if offset < 77000 || offset > 79000 {
		t.Fatalf("gold offset %d not near 78000", offset)
	}
	return source, goldB01, offset
}

// baselineBuildContext reproduces the original buildChatContext head/tail
// truncation (src/web/src/features/ai/chatContext.ts) for the no-summary case,
// counting runes (BMP fixture: UTF-16 and code points agree).
func baselineBuildContext(source string, limit int) string {
	if RuneLen(source) <= limit {
		return source
	}
	remaining := limit - 40
	head := (remaining + 1) / 2
	tail := remaining - head
	runes := []rune(source)
	return "相关内容片段：\n" + string(runes[:head]) + "\n……\n" + string(runes[len(runes)-tail:])
}

// zeroOverlapGold is a paraphrase answer sharing NO query term with
// questionZeroOverlap (verified by the test). >= 200 runes so it forms a
// standalone canonical segment.
const questionZeroOverlap = "量子退相干的主要机制是什么"

func zeroOverlapGoldText() string {
	core := "环境诱导的相位随机化过程解释了该现象，"
	var b strings.Builder
	for RuneLen(b.String()) < 210 {
		b.WriteString(core)
	}
	b.WriteString("这是中段给出的唯一答案。")
	return b.String()
}

// distractorText contains the query terms (lexical distractor).
func distractorText(i int) string {
	return fmt.Sprintf("第%03d号记录：量子退相干的主要机制在此被反复讨论，量子退相干与主要机制是本文档的常见主题。", i)
}

// buildZeroOverlapArticle builds a ~156,000-rune article whose filler shares
// no query term with questionZeroOverlap, with the gold middle passage placed
// ON a sampled sweep index (variant A) or OFF it (variant B). Filler avoids
// every query bigram by construction (asserted in the test).
func buildZeroOverlapArticle(t *testing.T, goldOnSample bool, distractors int) (Snapshot, string, int) {
	t.Helper()
	gold := zeroOverlapGoldText()
	fillerUnit := func(i int) string {
		return fmt.Sprintf("背景叙述第%05d号，记录日常观测数据与说明。", i)
	}
	// Exact 156,000-rune total: prefix + gold + suffix.
	goldLen := RuneLen(gold)
	prefixTarget := (156000 - goldLen) / 2
	suffixTarget := 156000 - goldLen - prefixTarget
	// Build filler-only prefix/suffix of the exact target sizes.
	buildFiller := func(target int, start int) string {
		var b strings.Builder
		i := start
		for RuneLen(b.String()) < target-RuneLen(fillerUnit(i)) {
			b.WriteString(fillerUnit(i))
			i++
		}
		// Pad the remainder with one exact-length filler sentence.
		rem := target - RuneLen(b.String())
		if rem > 1 {
			b.WriteString(strings.Repeat("补", rem-1) + "。")
		}
		return b.String()
	}
	prefix := buildFiller(prefixTarget, 0)
	suffix := buildFiller(suffixTarget, 90000)

	// Insert distractors evenly inside the prefix (they contain query terms).
	if distractors > 0 {
		parts := strings.SplitAfter(prefix, "。")
		var b strings.Builder
		step := len(parts) / (distractors + 1)
		d := 0
		for i, p := range parts {
			b.WriteString(p)
			if step > 0 && (i+1)%step == 0 && d < distractors {
				b.WriteString(distractorText(d))
				d++
			}
		}
		prefix = b.String()
	}

	tryBuild := func(goldRuneOffset int) (Snapshot, []candidate, int) {
		// Snap the offset to a sentence boundary in the prefix.
		runes := []rune(prefix)
		off := goldRuneOffset
		for off > 0 && runes[off-1] != '。' {
			off--
		}
		source := string(runes[:off]) + gold + string(runes[off:]) + suffix
		snap := Snapshot{
			ContentID: "fixture:zero-overlap",
			Kind:      SourceArticle,
			Version:   "content-revision:1",
			Blocks:    []Block{{Index: 0, Kind: "paragraph", Text: source}},
		}
		s := &selector{cfg: SelectorConfig{}.withDefaults()}
		cands, _ := s.segments(snap, DefaultMaxSegmentRunes)
		goldIdx := -1
		for i, c := range cands {
			if strings.Contains(c.text(), "环境诱导的相位随机化") {
				goldIdx = i
				break
			}
		}
		return snap, cands, goldIdx
	}

	target := RuneLen(prefix) / 2
	var snap Snapshot
	var cands []candidate
	goldIdx := -1
	for attempt := 0; attempt < 400; attempt++ {
		snap, cands, goldIdx = tryBuild(target + attempt*69)
		if goldIdx < 0 {
			t.Fatal("gold segment not found")
		}
		sample := SampleSweep(len(cands), 90)
		onSample := false
		for _, idx := range sample.Indices {
			if idx == goldIdx {
				onSample = true
				break
			}
		}
		if onSample == goldOnSample {
			return snap, gold, goldIdx
		}
	}
	t.Fatalf("could not place gold onSample=%v", goldOnSample)
	return Snapshot{}, "", 0
}

// ---------------------------------------------------------------------------
// Fake PassageSource: in-memory snapshot + exact re-read through the port.
// ---------------------------------------------------------------------------

type fakeSource struct {
	snap          Snapshot
	snapshotCalls int
	readCalls     int
	// mutateText, when set, corrupts re-read text (INV-05 mismatch tests).
	mutateText func(string) string
	// versionOverride, when set, changes the reported version (stale tests).
	versionOverride string
}

func (f *fakeSource) Snapshot(ctx context.Context, contentID string) (Snapshot, error) {
	f.snapshotCalls++
	if contentID != f.snap.ContentID {
		return Snapshot{}, ErrSourceNotFound
	}
	return f.snap, nil
}

func (f *fakeSource) ReadRange(ctx context.Context, contentID, locator string, startRune, endRune int) (string, string, error) {
	f.readCalls++
	if contentID != f.snap.ContentID {
		return "", "", ErrSourceNotFound
	}
	info, err := parseLocator(locator)
	if err != nil {
		return "", "", ErrSourceNotFound
	}
	var unitText, version string
	switch info.Kind {
	case SourceArticle:
		if info.BlockIndex >= len(f.snap.Blocks) {
			return "", "", ErrSourceNotFound
		}
		unitText = f.snap.Blocks[info.BlockIndex].Text
		version = f.snap.Version
	case SourceDiscussion:
		if info.PostIndex >= len(f.snap.Posts) || info.BlockIndex >= len(f.snap.Posts[info.PostIndex].Blocks) {
			return "", "", ErrSourceNotFound
		}
		unitText = f.snap.Posts[info.PostIndex].Blocks[info.BlockIndex].Text
		version = f.snap.Version
	case SourceSubtitle:
		var track *SubtitleTrack
		for i := range f.snap.Tracks {
			if f.snap.Tracks[i].Language == info.Language {
				track = &f.snap.Tracks[i]
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
		unitText = strings.Join(texts, "\n")
		version = subtitleVersion(track.Revision)
	case SourcePDF:
		var page *Page
		for i := range f.snap.Pages {
			if f.snap.Pages[i].Number == info.Page && f.snap.Pages[i].DocumentSHA256 == info.DocHash {
				page = &f.snap.Pages[i]
				break
			}
		}
		if page == nil {
			return "", "", ErrSourceNotFound
		}
		unitText = page.Text
		version = pdfVersion(*page)
	default:
		return "", "", ErrSourceNotFound
	}
	runes := []rune(unitText)
	if startRune < 0 || endRune > len(runes) || startRune >= endRune {
		return "", "", ErrSourceNotFound
	}
	text := string(runes[startRune:endRune])
	if f.mutateText != nil {
		text = f.mutateText(text)
	}
	if f.versionOverride != "" {
		version = f.versionOverride
	}
	return text, version, nil
}

// ---------------------------------------------------------------------------
// Fake embedder: deterministic fixed vectors (unit tests only; hash vectors
// are never used for the NFR-02 claim). Texts containing a registered gold
// marker share the question's vector (cosine 1); all other texts get
// deterministic orthogonal-ish vectors (cosine 0 with the question).
// ---------------------------------------------------------------------------

type embedCall struct {
	Role  EmbedRole
	Texts []string
}

type fakeEmbedder struct {
	dim          int
	mode         BatchingMode
	model        string
	calls        []embedCall
	goldMarkers  []string
	questionText string
	failQuery    bool
	failDocs     bool
}

func newFakeEmbedder(mode BatchingMode) *fakeEmbedder {
	return &fakeEmbedder{dim: 16, mode: mode, model: "fake-embedder"}
}

func (f *fakeEmbedder) ModelID() string            { return f.model }
func (f *fakeEmbedder) Dimensions() int            { return f.dim }
func (f *fakeEmbedder) BatchingMode() BatchingMode { return f.mode }

func (f *fakeEmbedder) Embed(ctx context.Context, texts []string, role EmbedRole) ([][]float32, error) {
	f.calls = append(f.calls, embedCall{Role: role, Texts: append([]string(nil), texts...)})
	// The selector always embeds the question first (sole query in split
	// mode; texts[0] of the first combined batch in shared mode).
	if f.questionText == "" && len(texts) > 0 {
		f.questionText = texts[0]
	}
	if role == EmbedQuery && f.failQuery {
		return nil, fmt.Errorf("fake embedder unavailable")
	}
	if role == EmbedDocument && f.failDocs {
		return nil, fmt.Errorf("fake embedder unavailable")
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		out[i] = f.vectorFor(t, role)
	}
	return out, nil
}

func (f *fakeEmbedder) vectorFor(text string, role EmbedRole) []float32 {
	v := make([]float32, f.dim)
	// The question vector is assigned by role (split) or by text identity
	// (shared, where the question rides in a combined document batch).
	if role == EmbedQuery || (f.questionText != "" && text == f.questionText) {
		v[0] = 1
		return v
	}
	for _, m := range f.goldMarkers {
		if strings.Contains(text, m) {
			v[0] = 1
			return v
		}
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(text))
	v[1+int(h.Sum32()%uint32(f.dim-1))] = 1
	return v
}

// embeddedQuestion reports whether the question text was sent to the embedder.
func (f *fakeEmbedder) embeddedQuestion() bool {
	for _, c := range f.calls {
		for _, t := range c.Texts {
			if t == f.questionText {
				return true
			}
		}
	}
	return false
}

func (f *fakeEmbedder) requestCount() int { return len(f.calls) }

func (f *fakeEmbedder) countRole(role EmbedRole) int {
	n := 0
	for _, c := range f.calls {
		if c.Role == role {
			n++
		}
	}
	return n
}

// defaultBudget is the default B budget (shared mode, 24 requests, batch 8).
func defaultBudget() BudgetConfig {
	return BudgetConfig{
		Mode:              BatchingShared,
		MaxRequests:       24,
		BatchSize:         8,
		TopK:              100,
		SweepCandidates:   90,
		MaxEmbeddingChars: 100000,
	}
}

func defaultSelectorConfig() SelectorConfig {
	return SelectorConfig{
		TopK:                100,
		Sweep:               SweepConfig{Enabled: true, SweepCandidates: 90},
		Budget:              defaultBudget(),
		Weights:             DefaultWeights(),
		AssemblyBudgetRunes: DefaultBudgetRunes,
		MaxBytes:            DefaultMaxBytes,
		Mode:                ModeHybrid,
	}
}
