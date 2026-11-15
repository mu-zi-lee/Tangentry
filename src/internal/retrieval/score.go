package retrieval

import (
	"fmt"
	"math"
	"sort"
)

// Weights are the user-configurable hybrid weights (each in [0,1], at least
// one positive, normalized to sum 1). Defaults: 0.35/0.65/0 (rerank off) or
// 0.25/0.55/0.20 (rerank on).
type Weights struct {
	Lexical   float64
	Embedding float64
	Rerank    float64
}

// DefaultWeights returns the rerank-off default weights.
func DefaultWeights() Weights { return Weights{Lexical: 0.35, Embedding: 0.65, Rerank: 0} }

// DefaultRerankWeights returns the rerank-on default weights.
func DefaultRerankWeights() Weights { return Weights{Lexical: 0.25, Embedding: 0.55, Rerank: 0.20} }

// ValidateWeights checks finiteness and range, then normalizes to sum 1.
// All-zero/negative/NaN/Inf is rejected (B-T32).
func ValidateWeights(w Weights) (Weights, error) {
	for _, v := range []float64{w.Lexical, w.Embedding, w.Rerank} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
			return Weights{}, fmt.Errorf("%w: weights must be finite and in [0,1]", ErrInvalidInput)
		}
	}
	sum := w.Lexical + w.Embedding + w.Rerank
	if sum <= 0 {
		return Weights{}, fmt.Errorf("%w: at least one weight must be positive", ErrInvalidInput)
	}
	return Weights{Lexical: w.Lexical / sum, Embedding: w.Embedding / sum, Rerank: w.Rerank / sum}, nil
}

// HybridScore combines normalized components:
// hybrid = lexicalWeight*lexicalNorm + embeddingWeight*cosine + rerankWeight*rerankNorm.
// lexicalNorm is max-normalized across candidates by the caller; cosine is
// clamped to [0,1]; rerank relevance_score is request-relative [0,1] and is
// never compared across requests.
func HybridScore(w Weights, lexicalNorm, cosine, rerank float64) float64 {
	if cosine < 0 {
		cosine = 0
	}
	if cosine > 1 {
		cosine = 1
	}
	if rerank < 0 {
		rerank = 0
	}
	if rerank > 1 {
		rerank = 1
	}
	return w.Lexical*lexicalNorm + w.Embedding*cosine + w.Rerank*rerank
}

// Cosine computes cosine similarity for equal-length vectors. Zero vectors
// yield 0 (never NaN). Mismatched lengths are a caller error (the adapter
// validates dimensions); defensively returns 0.
func Cosine(a, b []float32) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		x, y := float64(a[i]), float64(b[i])
		dot += x * y
		na += x * x
		nb += y * y
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

// sourceOrder is the deterministic tie-break position: source kind priority
// (article, saved subtitle, PDF, discussion — ADR-002 assembly step 6), then
// unit index (block/post/page/cue start), then sub-unit (discussion block),
// then language, then sentence/segment index.
type sourceOrder struct {
	kind    int
	unit    int
	sub     int
	lang    string
	segment int
}

func kindPriority(k SourceKind) int {
	switch k {
	case SourceArticle:
		return 0
	case SourceSubtitle:
		return 1
	case SourcePDF:
		return 2
	case SourceDiscussion:
		return 3
	}
	return 4
}

// SortPassages sorts in place: hybrid score descending, lexical score
// descending, rerank score descending (when present), then source order,
// then segment index. rerank may be nil (rerank off / phase 1).
func SortPassages(ps []Passage, rerank map[string]float64) {
	orders := make(map[string]sourceOrder, len(ps))
	for _, p := range ps {
		orders[p.ID] = passageOrder(p)
	}
	rerankOf := func(id string) float64 {
		if rerank == nil {
			return 0
		}
		return rerank[id]
	}
	sort.SliceStable(ps, func(i, j int) bool {
		a, b := ps[i], ps[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.LexicalScore != b.LexicalScore {
			return a.LexicalScore > b.LexicalScore
		}
		ra, rb := rerankOf(a.ID), rerankOf(b.ID)
		if ra != rb {
			return ra > rb
		}
		oa, ob := orders[a.ID], orders[b.ID]
		if oa.kind != ob.kind {
			return oa.kind < ob.kind
		}
		if oa.unit != ob.unit {
			return oa.unit < ob.unit
		}
		if oa.sub != ob.sub {
			return oa.sub < ob.sub
		}
		if oa.lang != ob.lang {
			return oa.lang < ob.lang
		}
		return oa.segment < ob.segment
	})
}
