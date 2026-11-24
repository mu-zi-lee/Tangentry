// Package samples defines the bundled starter library: a few public documents
// shipped with the app so a user with an empty library can read and try
// question-relevant retrieval immediately.
//
// Seeding is opt-out, happens at most once automatically, and never re-adds
// material the user removed. The bundled page text carries its own extractor
// provenance (native text layer or local OCR); nothing here fabricates text.
package samples

import (
	"encoding/json"
	"fmt"
)

// Material is one bundled document. Bytes live in an adapter; this catalog only
// describes them so the domain stays free of I/O.
type Material struct {
	// ID is a stable slug used to recognise seeded items after a restart.
	ID       string
	Title    string
	Filename string
	// PageText is the bundled per-page text file (JSON) for this document.
	PageText string
	// Source records where the document came from, for attribution.
	Source string
	// Note explains anything a reader must know (e.g. OCR-derived text).
	Note string
}

// Catalog is the shipped starter set. Order is the display order.
var Catalog = []Material{
	{
		ID:       "hk-first-five-year-plan",
		Title:    "第一個五年規劃：香港特別行政區經濟和社會發展（2026-2030）公眾諮詢文件",
		Filename: "hk-first-five-year-plan.pdf",
		PageText: "hk-first-five-year-plan.pages.json",
		Source:   "香港特別行政區政府",
		Note:     "文本來自 PDF 原生文本層。",
	},
	{
		ID:       "hk-basic-law",
		Title:    "中華人民共和國憲法及香港特別行政區基本法（2021 年 5 月版本）",
		Filename: "hk-basic-law.pdf",
		PageText: "hk-basic-law.pages.json",
		Source:   "香港特別行政區政府政制及內地事務局",
		Note:     "原 PDF 使用無 ToUnicode 的子集字型，文本由本機 PaddleOCR 識別；請以原文為準。",
	},
	{
		ID:       "hk-policy-address-2025",
		Title:    "行政長官 2025 年施政報告",
		Filename: "hk-policy-address-2025.pdf",
		PageText: "hk-policy-address-2025.pages.json",
		Source:   "香港特別行政區政府",
		Note:     "原 PDF 使用無 ToUnicode 的子集字型，文本由本機 PaddleOCR 識別；請以原文為準。",
	},
}

// State is the persisted seeding preference. It fits the preference value limit.
type State struct {
	// Enabled controls automatic seeding on an empty library.
	Enabled bool `json:"enabled"`
	// Seeded records that automatic seeding already ran, so a user who removes
	// the samples is never given them again without asking.
	Seeded bool `json:"seeded"`
}

// DefaultState is opt-out: a fresh install offers the starter set.
func DefaultState() State { return State{Enabled: true} }

// ShouldSeed reports whether to load the starter set automatically. All three
// conditions are required: an empty library, an enabled preference, and no
// previous automatic seeding.
func ShouldSeed(libraryEmpty bool, state State) bool {
	return libraryEmpty && state.Enabled && !state.Seeded
}

// ParseState reads a stored preference. A corrupt or oversized value falls back
// to the default rather than silently disabling or re-seeding.
func ParseState(raw string) State {
	if raw == "" {
		return DefaultState()
	}
	var state State
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return DefaultState()
	}
	return state
}

// SerializeState writes the preference value.
func SerializeState(state State) (string, error) {
	encoded, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("encode samples state: %w", err)
	}
	return string(encoded), nil
}

// ByID looks up a catalog entry.
func ByID(id string) (Material, bool) {
	for _, material := range Catalog {
		if material.ID == id {
			return material, true
		}
	}
	return Material{}, false
}

// PageTextFile is the bundled per-page text for one document. It records the
// extractor that produced it, so seeded text never claims provenance it lacks.
type PageTextFile struct {
	DocumentSHA256   string `json:"documentSha256"`
	Extractor        string `json:"extractor"`
	ExtractorVersion string `json:"extractorVersion"`
	Pages            []struct {
		Page int    `json:"page"`
		Text string `json:"text"`
	} `json:"pages"`
}

// Item is one catalog entry with its presence in the library, as exposed to the
// settings UI.
type Item struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Source  string `json:"source"`
	Note    string `json:"note"`
	Present bool   `json:"present"`
}

// Status is the samples settings and state surface returned by the API.
type Status struct {
	Enabled bool   `json:"enabled"`
	Seeded  bool   `json:"seeded"`
	Items   []Item `json:"items"`
}

// Assets is the port the composition root wires to the embedded bundle.
type Assets interface {
	PDF(name string) ([]byte, error)
	PageText(name string) (PageTextFile, error)
}

// IsSeeded reports whether the item IDs of the catalog are present in a library.
// The IDs are derived from the bundled bytes, so a removed sample is simply
// absent rather than tracked by a second registry.
func IsSeeded(ids []string, libraryIDs map[string]bool) bool {
	if len(ids) == 0 {
		return false
	}
	for _, id := range ids {
		if !libraryIDs[id] {
			return false
		}
	}
	return true
}
