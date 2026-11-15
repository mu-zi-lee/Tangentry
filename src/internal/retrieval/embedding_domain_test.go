package retrieval

import (
	"encoding/json"
	"math"
	"strings"
	"sync"
	"testing"
)

// TestBudgetTrackerReserve: every POST reserves a slot before start; the
// request limit stops further requests; usage-unknown stops further calls;
// 0 means off. A's ledger is never involved (this is B's own tracker).
func TestBudgetTrackerReserve(t *testing.T) {
	bt := NewBudgetTracker(3, 1000)
	for i := 0; i < 3; i++ {
		if !bt.Reserve() {
			t.Fatalf("reserve %d should succeed", i)
		}
	}
	if bt.Reserve() {
		t.Fatal("4th reserve must fail (limit 3)")
	}
	if bt.Requests() != 3 {
		t.Fatalf("requests = %d", bt.Requests())
	}
	if bt.Status() != BudgetEmbeddingExhausted {
		t.Fatalf("status = %s", bt.Status())
	}

	// Off.
	off := NewBudgetTracker(0, 1000)
	if off.Reserve() || off.Status() != BudgetDisabled {
		t.Fatal("zero budget must be off")
	}

	// Usage unknown stops further requests.
	unk := NewBudgetTracker(10, 1000)
	unk.Reserve()
	unk.MarkUsageUnknown()
	if unk.Reserve() {
		t.Fatal("usage-unknown must stop further requests")
	}
	if unk.Status() != BudgetEmbeddingUsageUnknown {
		t.Fatalf("status = %s", unk.Status())
	}

	// Char ceiling reports limited.
	lim := NewBudgetTracker(10, 100)
	lim.Reserve()
	lim.AddChars(100)
	if !lim.CharLimited() || lim.Status() != BudgetEmbeddingLimited {
		t.Fatalf("char-limited status = %s", lim.Status())
	}
}

// TestBudgetTrackerConcurrent: concurrent reservations never overshoot the
// limit (B's own budget, mirroring A's overshoot guarantee independently).
func TestBudgetTrackerConcurrent(t *testing.T) {
	const limit = 50
	bt := NewBudgetTracker(limit, 0)
	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if bt.Reserve() {
				mu.Lock()
				granted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if granted != limit || bt.Requests() != limit {
		t.Fatalf("overshoot: granted=%d requests=%d limit=%d", granted, bt.Requests(), limit)
	}
}

// TestBT30_VectorCache: same key hits; model/source/dimension change misses;
// no vector from a different dimension/model is used; stored vectors are
// isolated from caller mutation.
func TestBT30_VectorCache(t *testing.T) {
	c := NewProcessVectorCache()
	key := VectorCacheKey{ContentID: "c1", SourceVersion: "content-revision:1", PassageID: "p1", ModelID: "bge-m3", Dimensions: 3}
	vec := []float32{1, 2, 3}
	c.Put(key, vec)
	got, ok := c.Get(key)
	if !ok || len(got) != 3 || got[0] != 1 {
		t.Fatalf("hit failed: %v %v", got, ok)
	}
	// Caller mutation does not corrupt the cache.
	got[0] = 99
	again, _ := c.Get(key)
	if again[0] != 1 {
		t.Fatal("cache corrupted by caller mutation")
	}
	// Each identity component change is a miss.
	for _, mut := range []VectorCacheKey{
		{ContentID: "c2", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: "content-revision:2", PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: "p2", ModelID: key.ModelID, Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: "other-model", Dimensions: 3},
		{ContentID: "c1", SourceVersion: key.SourceVersion, PassageID: key.PassageID, ModelID: key.ModelID, Dimensions: 4},
	} {
		if _, ok := c.Get(mut); ok {
			t.Fatalf("identity change must miss: %+v", mut)
		}
	}
	// Dimension mismatch on Put is rejected (never mix dimensions).
	c.Put(VectorCacheKey{ContentID: "c1", PassageID: "bad", ModelID: "bge-m3", Dimensions: 3}, []float32{1, 2})
	if _, ok := c.Get(VectorCacheKey{ContentID: "c1", PassageID: "bad", ModelID: "bge-m3", Dimensions: 3}); ok {
		t.Fatal("wrong-dimension vector must not be cached")
	}
}

// TestBT31_SettingsValidation: provider/surface/model/dimensions/batch/
// encoding checks; per-model Bailian dimension choices and row limits; a
// wrong dimension/model is rejected with an actionable error.
func TestBT31_SettingsValidation(t *testing.T) {
	base := DefaultEmbeddingSettings()
	if err := ValidateEmbeddingSettings(base); err != nil {
		t.Fatalf("default must validate: %v", err)
	}
	if base.BatchingMode() != BatchingShared {
		t.Fatal("local default must be shared")
	}
	// Bailian preset with per-model dimensions.
	bailian := base
	bailian.ProviderKind = ProviderBailian
	bailian.Surface = SurfaceDashScope
	bailian.Model = "text-embedding-v4"
	bailian.Dimensions = 1024
	bailian.BatchSize = 10
	if err := ValidateEmbeddingSettings(bailian); err != nil {
		t.Fatalf("bailian v4/1024/10: %v", err)
	}
	if bailian.BatchingMode() != BatchingSplit {
		t.Fatal("DashScope must be split")
	}
	// Wrong dimension for v4.
	bad := bailian
	bad.Dimensions = 999
	if err := ValidateEmbeddingSettings(bad); err == nil {
		t.Fatal("invalid dimension must be rejected")
	}
	// Batch over the v4 row limit (10).
	badBatch := bailian
	badBatch.BatchSize = 11
	if err := ValidateEmbeddingSettings(badBatch); err == nil {
		t.Fatal("batch over row limit must be rejected")
	}
	// v2 fixed 1536.
	v2 := bailian
	v2.Model = "text-embedding-v2"
	v2.Dimensions = 1536
	v2.BatchSize = 25
	if err := ValidateEmbeddingSettings(v2); err != nil {
		t.Fatalf("v2/1536/25: %v", err)
	}
	v2bad := v2
	v2bad.Dimensions = 1024
	if err := ValidateEmbeddingSettings(v2bad); err == nil {
		t.Fatal("v2 non-1536 must be rejected")
	}
	// Generic invalid fields.
	for _, mut := range []func(*EmbeddingSettings){
		func(s *EmbeddingSettings) { s.ProviderKind = "bogus" },
		func(s *EmbeddingSettings) { s.BaseURL = "" },
		func(s *EmbeddingSettings) { s.Model = "" },
		func(s *EmbeddingSettings) { s.Dimensions = 0 },
		func(s *EmbeddingSettings) { s.BatchSize = 0 },
		func(s *EmbeddingSettings) { s.EncodingFormat = "xml" },
		func(s *EmbeddingSettings) { s.TopK = 19 },
		func(s *EmbeddingSettings) { s.TopK = 1001 },
	} {
		s := base
		mut(&s)
		if err := ValidateEmbeddingSettings(s); err == nil {
			t.Fatalf("expected rejection for %+v", s)
		}
	}
}

// TestBT32_SettingsWeights: weights in [0,1], at least one positive;
// all-zero/negative/NaN/Inf rejected; rerank-with-zero-budget rejected.
func TestBT32_SettingsWeights(t *testing.T) {
	base := DefaultEmbeddingSettings()
	for _, mut := range []func(*EmbeddingSettings){
		func(s *EmbeddingSettings) { s.LexicalWeight, s.EmbeddingWeight, s.RerankWeight = 0, 0, 0 },
		func(s *EmbeddingSettings) { s.LexicalWeight = -0.1 },
		func(s *EmbeddingSettings) { s.EmbeddingWeight = math.NaN() },
		func(s *EmbeddingSettings) { s.RerankWeight = math.Inf(1) },
		func(s *EmbeddingSettings) { s.LexicalWeight = 1.5 },
	} {
		s := base
		mut(&s)
		if err := ValidateEmbeddingSettings(s); err == nil {
			t.Fatalf("expected weight rejection for %+v", s)
		}
	}
	// Rerank enabled with zero budget is rejected.
	r := base
	r.RerankProvider = "bailian"
	r.MaxRerankRequests = 0
	if err := ValidateEmbeddingSettings(r); err == nil {
		t.Fatal("rerank with zero budget must be rejected")
	}
	r.MaxRerankRequests = 2
	if err := ValidateEmbeddingSettings(r); err != nil {
		t.Fatalf("rerank with positive budget: %v", err)
	}
	// Negative request budget → invalid_budget.
	neg := base
	neg.MaxEmbeddingRequests = -1
	if err := ValidateEmbeddingSettings(neg); err == nil {
		t.Fatal("negative request budget must be rejected")
	}
}

// TestBT35_MaskedSettings: the masked shape carries hasKey/hasRerankKey, never
// the key itself; non-secret fields survive.
func TestBT35_MaskedSettings(t *testing.T) {
	s := DefaultEmbeddingSettings()
	s.APIKey = "super-secret-key"
	s.RerankAPIKey = "rerank-secret"
	m := s.Mask()
	if !m.HasKey || !m.HasRerankKey {
		t.Fatal("hasKey/hasRerankKey must be true")
	}
	// Marshal and ensure no secret leaks.
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	raw := string(b)
	if strings.Contains(raw, "super-secret-key") || strings.Contains(raw, "rerank-secret") {
		t.Fatalf("secret leaked in masked settings: %s", raw)
	}
	if m.Model != "bge-m3" || m.Dimensions != 1024 || m.MaxEmbeddingRequests != 24 {
		t.Fatalf("non-secret fields lost: %+v", m)
	}
	if !s.HasKey() {
		t.Fatal("HasKey")
	}
	empty := DefaultEmbeddingSettings()
	if empty.Mask().HasKey {
		t.Fatal("empty key must report hasKey=false")
	}
}
