package citation

type Status string

const (
	StatusVerified   Status = "verified"
	StatusInvalid    Status = "invalid"
	StatusUnverified Status = "unverified"
	StatusStale      Status = "stale"
	StatusAmbiguous  Status = "ambiguous"
)

type Citation struct {
	ID            string `json:"id"`
	PassageID     string `json:"passageId"`
	ContentID     string `json:"contentId"`
	Source        string `json:"source"`
	SourceVersion string `json:"sourceVersion"`
	Locator       string `json:"locator"`

	Quote     string `json:"quote"`
	StartRune int    `json:"startRune"`
	EndRune   int    `json:"endRune"`

	Status Status `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type RawCitation struct {
	PassageID string
	Quote     string
}
