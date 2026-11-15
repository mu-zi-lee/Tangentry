package evalutil

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"math"
	"os"
	"sort"

	"tangentry/internal/retrieval"
)

type hasher struct{ h hash.Hash }

func newHasher() *hasher         { return &hasher{h: sha256.New()} }
func (h *hasher) Write(b []byte) { h.h.Write(b) }
func (h *hasher) SumHex() string { return hex.EncodeToString(h.h.Sum(nil)) }

// VectorStore is the frozen vector file (protocol §5: precomputed frozen
// vectors for the fixed evaluation set, with a vector-file hash). Vectors are
// keyed by SHA-256 of the exact text and split by role: Document vectors were
// generated with text_type=document; Query vectors with text_type=query.
// Shared-mode replay (a text_type-less server simulation) uses Document
// vectors for every text and is labeled as a deviation in the report.
type VectorStore struct {
	Schema       int               `json:"schema"`
	Model        string            `json:"model"`
	ProviderKind string            `json:"provider_kind"`
	Surface      string            `json:"surface"`
	Dimensions   int               `json:"dimensions"`
	BatchSize    int               `json:"batch_size"`
	GeneratedAt  string            `json:"generated_at"`
	VectorSHA256 string            `json:"vector_sha256"` // hash of the canonical vector payload
	Document     map[string]string `json:"document"`      // text sha256 -> base64 float32 LE
	Query        map[string]string `json:"query"`
}

// EncodeVector serializes float32 vectors deterministically (base64 LE).
func EncodeVector(v []float32) string {
	b := make([]byte, 4*len(v))
	for i, f := range v {
		binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(f))
	}
	return base64.StdEncoding.EncodeToString(b)
}

// DecodeVector parses a base64 float32 LE vector.
func DecodeVector(s string, dims int) ([]float32, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != 4*dims {
		return nil, fmt.Errorf("frozen vector: bad encoding or dimension")
	}
	v := make([]float32, dims)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v, nil
}

// CanonicalPayloadHash hashes the sorted vector entries (role, key, vector)
// so the vector-file identity is independent of JSON map ordering.
func (s *VectorStore) CanonicalPayloadHash() string {
	keys := make([]string, 0, len(s.Document)+len(s.Query))
	for k := range s.Document {
		keys = append(keys, "document:"+k)
	}
	for k := range s.Query {
		keys = append(keys, "query:"+k)
	}
	sort.Strings(keys)
	h := newHasher()
	for _, k := range keys {
		var v string
		if k[:8] == "document" {
			v = s.Document[k[9:]]
		} else {
			v = s.Query[k[6:]]
		}
		h.Write([]byte(k))
		h.Write([]byte{0})
		h.Write([]byte(v))
		h.Write([]byte{0})
	}
	return h.SumHex()
}

// Save writes the store with a canonical payload hash.
func (s *VectorStore) Save(path string) error {
	s.VectorSHA256 = s.CanonicalPayloadHash()
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// LoadVectorStore reads and integrity-checks a frozen vector file.
func LoadVectorStore(path string) (*VectorStore, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s VectorStore
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	if s.Schema != 1 || s.Dimensions <= 0 {
		return nil, fmt.Errorf("frozen vector file: unsupported schema")
	}
	if s.CanonicalPayloadHash() != s.VectorSHA256 {
		return nil, fmt.Errorf("frozen vector file: payload hash mismatch (file tampered or model changed)")
	}
	return &s, nil
}

// FrozenEmbedder serves vectors from the frozen store. Zero network. A
// missing vector is a hard error (fail closed; never fabricated).
type FrozenEmbedder struct {
	Store   *VectorStore
	Mode    retrieval.BatchingMode
	Lookups int
}

func (e *FrozenEmbedder) ModelID() string                      { return e.Store.Model }
func (e *FrozenEmbedder) Dimensions() int                      { return e.Store.Dimensions }
func (e *FrozenEmbedder) BatchingMode() retrieval.BatchingMode { return e.Mode }

func (e *FrozenEmbedder) Embed(ctx context.Context, texts []string, role retrieval.EmbedRole) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		key := SHA256Hex(t)
		enc, ok := "", false
		if role == retrieval.EmbedQuery && e.Mode == retrieval.BatchingSplit {
			enc, ok = e.Store.Query[key]
		} else {
			enc, ok = e.Store.Document[key]
		}
		if !ok {
			return nil, fmt.Errorf("frozen vector missing for text %s (role %s, mode %s)", key, role, e.Mode)
		}
		v, err := DecodeVector(enc, e.Store.Dimensions)
		if err != nil {
			return nil, err
		}
		out[i] = v
		e.Lookups++
	}
	return out, nil
}
