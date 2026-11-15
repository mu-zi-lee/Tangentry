package retrieval

// Dedupe removes duplicate passages: the key is the SHA-256 of the
// whitespace-normalized text (exact-text hash after normalization). The
// highest score wins; ties keep the first stable locator (source order).
// Duplicate IDs merge deterministically. The result is re-sorted with the
// standard tie-break. Returns kept passages and the dropped count.
func Dedupe(ps []Passage) ([]Passage, int) {
	type group struct {
		best  Passage
		order sourceOrder
	}
	groups := map[string]*group{}
	var keys []string
	for _, p := range ps {
		key := TextSHA256(NormalizeWhitespace(p.Text))
		o := passageOrder(p)
		g, ok := groups[key]
		if !ok {
			groups[key] = &group{best: p, order: o}
			keys = append(keys, key)
			continue
		}
		if p.Score > g.best.Score || (p.Score == g.best.Score && orderLess(o, g.order)) {
			g.best = p
			g.order = o
		}
	}
	kept := make([]Passage, 0, len(keys))
	for _, k := range keys {
		kept = append(kept, groups[k].best)
	}
	SortPassages(kept, nil)
	return kept, len(ps) - len(kept)
}

func orderLess(a, b sourceOrder) bool {
	if a.kind != b.kind {
		return a.kind < b.kind
	}
	if a.unit != b.unit {
		return a.unit < b.unit
	}
	if a.sub != b.sub {
		return a.sub < b.sub
	}
	if a.lang != b.lang {
		return a.lang < b.lang
	}
	return a.segment < b.segment
}
