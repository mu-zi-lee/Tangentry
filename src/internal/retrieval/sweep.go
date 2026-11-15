package retrieval

// SweepSample is the deterministic position-stratified sweep sample.
// Indices are segment indices in source order. The sample places exactly S
// segments at positions floor(k*N/S) for k in [0,S), so Coverage is exactly
// S/N; the reported Stride is ceil(N/S) (the nominal "every ⌈N/S⌉-th segment"
// spacing). No randomness: frozen-vector replay stays byte-identical.
type SweepSample struct {
	Indices  []int
	Stride   int
	Coverage float64
	Limited  bool
}

// SampleSweep samples s of n segments (s <= 0 yields an empty sample;
// s >= n yields full coverage).
func SampleSweep(n, s int) SweepSample {
	if n <= 0 || s <= 0 {
		return SweepSample{}
	}
	if s >= n {
		idx := make([]int, n)
		for i := range idx {
			idx[i] = i
		}
		return SweepSample{Indices: idx, Stride: 1, Coverage: 1, Limited: false}
	}
	idx := make([]int, s)
	for k := 0; k < s; k++ {
		idx[k] = k * n / s
	}
	stride := (n + s - 1) / s
	return SweepSample{
		Indices:  idx,
		Stride:   stride,
		Coverage: float64(s) / float64(n),
		Limited:  true,
	}
}
