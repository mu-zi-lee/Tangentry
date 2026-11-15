package retrieval

import "errors"

// Sentinel errors. Statuses stay distinct (prompt §5.6); these are never
// rendered as generic provider errors.
var (
	// ErrInvalidBudget marks an invalid assembly or embedding budget value.
	ErrInvalidBudget = errors.New("invalid_budget")
	// ErrContextBudgetExceeded marks an assembly that cannot fit even after
	// the full drop sequence (post-embedding; zero chat requests).
	ErrContextBudgetExceeded = errors.New("context_budget_exceeded")
	// ErrNoVerifiedPassages marks a candidate set where INV-05 verification
	// dropped every passage.
	ErrNoVerifiedPassages = errors.New("no_verified_passages")
	// ErrSourceNotFound marks an unknown contentID or locator at the port.
	ErrSourceNotFound = errors.New("source_not_found")
	// ErrStaleSource marks a reference whose document version changed
	// (e.g. a PDF document hash replaced by a new extraction).
	ErrStaleSource = errors.New("stale_source")
	// ErrInvalidInput marks NUL-containing or otherwise illegal input.
	ErrInvalidInput = errors.New("invalid_input")
)
