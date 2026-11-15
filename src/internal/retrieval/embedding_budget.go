package retrieval

import "sync"

// B retrieval budget statuses (distinct from A's completion budget). These
// describe the embedding/rerank request budget only; A's ledger is never
// read or mutated by B.
const (
	BudgetCompleted             = "completed"
	BudgetEmbeddingLimited      = "embedding_budget_limited"
	BudgetEmbeddingExhausted    = "embedding_budget_exhausted"
	BudgetEmbeddingUsageUnknown = "embedding_usage_unknown"
	BudgetRerankExhausted       = "rerank_budget_exhausted"
	BudgetRerankUnavailable     = "rerank_unavailable"
	BudgetDisabled              = "disabled"
)

// BudgetTracker is B's own per-operation retrieval budget. Every remote
// embedding/rerank POST reserves a slot BEFORE it starts; once the request
// limit is reached, or usage becomes unknown, no further request starts.
// It is independent of A's completion ledger.
type BudgetTracker struct {
	mu           sync.Mutex
	maxRequests  int
	maxChars     int
	requests     int
	chars        int
	usageUnknown bool
}

// NewBudgetTracker builds a tracker. maxRequests=0 means "off" (no request
// may start); maxChars<=0 disables the character ceiling.
func NewBudgetTracker(maxRequests, maxChars int) *BudgetTracker {
	return &BudgetTracker{maxRequests: maxRequests, maxChars: maxChars}
}

// Reserve reserves one request slot before a remote POST. It returns false
// when the budget is off, exhausted, or usage is unknown (no request starts).
func (t *BudgetTracker) Reserve() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.usageUnknown || t.maxRequests <= 0 || t.requests >= t.maxRequests {
		return false
	}
	t.requests++
	return true
}

// AddChars records characters sent to embeddings (best-effort ceiling).
func (t *BudgetTracker) AddChars(n int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if n > 0 {
		t.chars += n
	}
}

// MarkUsageUnknown stops further requests in this operation (a response
// lacked valid usage; never treated as known zero).
func (t *BudgetTracker) MarkUsageUnknown() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.usageUnknown = true
}

// Requests returns the number of reserved (started) requests.
func (t *BudgetTracker) Requests() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.requests
}

// Chars returns the recorded characters sent.
func (t *BudgetTracker) Chars() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.chars
}

// CharLimited reports whether the character ceiling has been reached.
func (t *BudgetTracker) CharLimited() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.maxChars > 0 && t.chars >= t.maxChars
}

// Status reports the terminal budget state for the wire envelope.
func (t *BudgetTracker) Status() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case t.maxRequests <= 0:
		return BudgetDisabled
	case t.usageUnknown:
		return BudgetEmbeddingUsageUnknown
	case t.requests >= t.maxRequests:
		return BudgetEmbeddingExhausted
	case t.maxChars > 0 && t.chars >= t.maxChars:
		return BudgetEmbeddingLimited
	default:
		return BudgetCompleted
	}
}
