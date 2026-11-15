package retrieval

// Wire schema version for the namespaced retrieval object (ADR-002 "Wire
// envelope"). B owns this object; C may add a top-level citations object.
const WireSchemaVersion = 1

// Request is the optional namespaced retrieval request object. Omitted or
// Enabled=false means the legacy path (byte-identical context + response).
type Request struct {
	SchemaVersion   int                 `json:"schemaVersion"`
	Enabled         bool                `json:"enabled"`
	Mode            string              `json:"mode"` // hybrid|embedding|lexical
	MaxChars        int                 `json:"maxChars"`
	EmbeddingBudget EmbeddingBudgetWire `json:"embeddingBudget"`
	RerankBudget    RerankBudgetWire    `json:"rerankBudget"`
}

// EmbeddingBudgetWire carries the embedding budget knobs. MaxRequests is a
// pointer so an omitted field (nil → mode default) is distinct from an
// explicit 0, which turns embedding off per the budget contract.
type EmbeddingBudgetWire struct {
	BatchingMode    string `json:"batchingMode"`
	MaxRequests     *int   `json:"maxRequests"`
	MaxChars        int    `json:"maxChars"`
	SweepCandidates int    `json:"sweepCandidates"`
}

// RerankBudgetWire carries the rerank request budget.
type RerankBudgetWire struct {
	MaxRequests int `json:"maxRequests"`
}

// Response is the optional namespaced retrieval response object.
type Response struct {
	SchemaVersion int              `json:"schemaVersion"`
	Status        string           `json:"status"`
	Mode          string           `json:"mode"`
	Passages      []PassageRef     `json:"passages"`
	Embedding     EmbeddingSummary `json:"embedding"`
	Rerank        RerankSummary    `json:"rerank"`
}

// PassageRef is the verifiable passage reference C consumes (ADR-002
// "Passage contract for C"). The ID is a locator, not proof.
type PassageRef struct {
	PassageID     string   `json:"passageId"`
	ContentID     string   `json:"contentId"`
	Source        string   `json:"source"`
	Locator       string   `json:"locator"`
	SentenceStart int      `json:"sentenceStart"`
	SentenceEnd   int      `json:"sentenceEnd"`
	StartRune     int      `json:"startRune"`
	EndRune       int      `json:"endRune"`
	TextSHA256    string   `json:"textSha256"`
	SourceVersion string   `json:"sourceVersion"`
	CueIDs        []string `json:"cueIds"`
}

// EmbeddingSummary reports the embedding model identity and B budget usage.
type EmbeddingSummary struct {
	Model        string `json:"model"`
	Dimensions   int    `json:"dimensions"`
	BudgetStatus string `json:"budgetStatus"`
	Requests     int    `json:"requests"`
}

// RerankSummary reports the optional rerank stage (off by default).
type RerankSummary struct {
	Enabled      bool   `json:"enabled"`
	Model        string `json:"model"`
	BudgetStatus string `json:"budgetStatus"`
	Requests     int    `json:"requests"`
}

// StatusError carries a distinct retrieval status for HTTP/SSE mapping. It is
// never a generic provider error; each status maps to its own copy (B-T25).
type StatusError struct{ Status string }

func (e StatusError) Error() string { return e.Status }

// RefFromPassage converts a domain Passage to its wire reference.
func RefFromPassage(p Passage) PassageRef {
	cueIDs := p.CueIDs
	if cueIDs == nil {
		cueIDs = []string{}
	}
	return PassageRef{
		PassageID: p.ID, ContentID: p.ContentID, Source: string(p.Source),
		Locator: p.Locator, SentenceStart: p.SentenceStart, SentenceEnd: p.SentenceEnd,
		StartRune: p.StartRune, EndRune: p.EndRune, TextSHA256: p.TextSHA256,
		SourceVersion: p.SourceVersion, CueIDs: cueIDs,
	}
}

// validateRequest validates the wire budgets before any work. Assembly budget
// 0/negative/out-of-range and embedding request budgets negative are
// invalid_budget; maxChars omission uses the labelled default.
func validateRequest(req Request) (maxChars int, err error) {
	maxChars = req.MaxChars
	if maxChars == 0 {
		maxChars = DefaultBudgetRunes // labelled default on omission
	}
	if _, verr := ValidateAssemblyBudget(float64(maxChars)); verr != nil {
		return 0, StatusError{Status: string(SelectionInvalidBudget)}
	}
	if (req.EmbeddingBudget.MaxRequests != nil && *req.EmbeddingBudget.MaxRequests < 0) || req.RerankBudget.MaxRequests < 0 {
		return 0, StatusError{Status: string(SelectionInvalidBudget)}
	}
	if req.EmbeddingBudget.MaxChars < 0 {
		return 0, StatusError{Status: string(SelectionInvalidBudget)}
	}
	return maxChars, nil
}
