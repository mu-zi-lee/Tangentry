package sqlite

import (
	"database/sql"
	"encoding/binary"
	"errors"
	"math"

	"tangentry/internal/retrieval"
)

// PersistentVectorCache is the opt-in SQLite vector cache (migration 083).
// It implements the same retrieval.VectorCache port as the process-local
// default. The key includes model and dimensions, so an identity change is a
// miss and vectors from different models/dimensions are never mixed.
type PersistentVectorCache struct{ store *Store }

// NewPersistentVectorCache wires the persistent cache to the store.
func NewPersistentVectorCache(store *Store) *PersistentVectorCache {
	return &PersistentVectorCache{store: store}
}

// Get returns the cached vector for the exact key (miss on any change).
func (c *PersistentVectorCache) Get(key retrieval.VectorCacheKey) ([]float32, bool) {
	var blob []byte
	err := c.store.db.QueryRow(`SELECT vector FROM passage_embeddings WHERE content_id=? AND source_version=? AND passage_id=? AND model_id=? AND dimensions=?`,
		key.ContentID, key.SourceVersion, key.PassageID, key.ModelID, key.Dimensions).Scan(&blob)
	if errors.Is(err, sql.ErrNoRows) || err != nil {
		return nil, false
	}
	if len(blob)%4 != 0 {
		return nil, false
	}
	vec := make([]float32, len(blob)/4)
	for i := range vec {
		vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(blob[i*4:]))
	}
	if key.Dimensions > 0 && len(vec) != key.Dimensions {
		return nil, false
	}
	return vec, true
}

// Put stores the vector under the exact key (dimension mismatch rejected).
func (c *PersistentVectorCache) Put(key retrieval.VectorCacheKey, vec []float32) {
	if key.Dimensions > 0 && len(vec) != key.Dimensions {
		return
	}
	blob := make([]byte, len(vec)*4)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(blob[i*4:], math.Float32bits(v))
	}
	_, _ = c.store.db.Exec(`INSERT INTO passage_embeddings(content_id,source_version,passage_id,model_id,dimensions,vector) VALUES(?,?,?,?,?,?)
		ON CONFLICT(content_id,source_version,passage_id,model_id,dimensions) DO UPDATE SET vector=excluded.vector`,
		key.ContentID, key.SourceVersion, key.PassageID, key.ModelID, key.Dimensions, blob)
}

var _ retrieval.VectorCache = (*PersistentVectorCache)(nil)
