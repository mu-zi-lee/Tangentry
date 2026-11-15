package retrieval

import "sync"

// VectorCacheKey identifies a cached vector. A change to any component
// (content, source version, passage, model, dimensions) is a cache miss;
// vectors from a different model or dimension are never mixed.
type VectorCacheKey struct {
	ContentID     string
	SourceVersion string
	PassageID     string
	ModelID       string
	Dimensions    int
}

// VectorCache stores passage vectors. v1 ships a process-local cache; an
// optional persistent SQLite cache (migration 083) implements the same port.
type VectorCache interface {
	Get(key VectorCacheKey) ([]float32, bool)
	Put(key VectorCacheKey, vec []float32)
}

// ProcessVectorCache is the default in-memory cache (concurrency-safe).
type ProcessVectorCache struct {
	mu sync.RWMutex
	m  map[VectorCacheKey][]float32
}

// NewProcessVectorCache builds an empty process-local cache.
func NewProcessVectorCache() *ProcessVectorCache {
	return &ProcessVectorCache{m: map[VectorCacheKey][]float32{}}
}

// Get returns a copy of the cached vector (callers cannot mutate the cache).
func (c *ProcessVectorCache) Get(key VectorCacheKey) ([]float32, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	vec, ok := c.m[key]
	if !ok {
		return nil, false
	}
	out := make([]float32, len(vec))
	copy(out, vec)
	return out, true
}

// Put stores a copy of the vector. A dimension mismatch with the key is
// rejected (never mix dimensions).
func (c *ProcessVectorCache) Put(key VectorCacheKey, vec []float32) {
	if key.Dimensions > 0 && len(vec) != key.Dimensions {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := make([]float32, len(vec))
	copy(cp, vec)
	c.m[key] = cp
}

// Len reports the number of cached vectors (testing/observability).
func (c *ProcessVectorCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.m)
}

var _ VectorCache = (*ProcessVectorCache)(nil)
