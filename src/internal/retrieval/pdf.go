package retrieval

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// PDF extraction statuses (distinct, never generic provider errors).
const (
	PDFStatusReady          = "ready"
	PDFStatusExtracting     = "pdf_extracting"
	PDFStatusOCRUnavailable = "pdf_ocr_unavailable"
	PDFStatusNoText         = "pdf_no_text"
	PDFStatusExtractFailed  = "pdf_extract_failed"
)

// OCR provider modes (settings ocrProvider).
const (
	OCRModeLocal = "local"
	OCRModeCloud = "paddleocr_cloud"
	OCRModeOff   = "off"
)

// PDFDocument is the extracted per-page text with document provenance.
type PDFDocument struct {
	SHA256    string
	PageCount int
	Pages     []Page
	OCRJobID  string
	OCRState  string
}

// PDFTextExtractor extracts per-page text from a stored PDF file. The native
// implementation is a vetted pure-Go text-layer extractor (adapters/pdftext);
// pages without a usable text layer are handled by the OCR provider.
type PDFTextExtractor interface {
	Version() string
	DocumentHash(ctx context.Context, path string) (string, error)
	Extract(ctx context.Context, path string) (PDFDocument, error)
}

// OCRPage is one recognized page (1-based number within the requested set).
type OCRPage struct {
	Number int
	Text   string
}

// OCRResult carries recognized pages plus job provenance (cloud jobs).
type OCRResult struct {
	Pages []OCRPage
	JobID string
	State string
}

// OCRProvider recognizes pages without a usable text layer. Local is the
// default (user-installed runtime, no token, no upload); cloud is an explicit
// opt-in behind a feature flag and consent, never a silent fallback.
type OCRProvider interface {
	Name() string // "local-paddleocr" or "paddleocr-cloud"
	Version() string
	Available(ctx context.Context) bool
	Recognize(ctx context.Context, path string, expectedPages int) (OCRResult, error)
}

// PDFTextStore persists extracted page text (write side). Saving a new
// document hash replaces the content's old rows, invalidating old passage
// references. The read side is the PDFText port.
type PDFTextStore interface {
	SavePDFPages(ctx context.Context, contentID string, doc PDFDocument, extractedAt int64) error
}

// PDFExtractionConfig configures the extraction service. OCRMode defaults to
// local; cloud additionally requires the feature flag and recorded consent
// (ocrCloudConsentVersion/timestamp) before any upload.
type PDFExtractionConfig struct {
	OCRMode             string
	OCR                 OCRProvider
	CloudFeatureEnabled bool
	CloudConsentVersion string
	CloudConsentAt      int64
}

// PDFExtractionResult is the explicit extraction outcome.
type PDFExtractionResult struct {
	Status         string
	Reason         string
	DocumentSHA256 string
	PageCount      int
	Pages          []Page
	OCRUsed        bool
}

// PDFExtractionService orchestrates: hash → idempotency check → native
// extraction → OCR fallback for text-less pages → page-count validation →
// store. At most one active extraction per content+hash; a concurrent call
// reports pdf_extracting. No passage is ever fabricated. When OCR cannot run
// (runtime unavailable, or cloud without enablement/consent), usable native
// page text is preserved and the skipped pages are reported in Reason; only
// a document with no usable text at all reports pdf_ocr_unavailable.
type PDFExtractionService struct {
	extractor PDFTextExtractor
	reader    PDFText
	store     PDFTextStore
	cfg       PDFExtractionConfig
	mu        sync.Mutex
	active    map[string]bool
}

// NewPDFExtractionService wires the extraction ports.
func NewPDFExtractionService(extractor PDFTextExtractor, reader PDFText, store PDFTextStore, cfg PDFExtractionConfig) *PDFExtractionService {
	if cfg.OCRMode == "" {
		cfg.OCRMode = OCRModeLocal
	}
	return &PDFExtractionService{extractor: extractor, reader: reader, store: store, cfg: cfg, active: map[string]bool{}}
}

// Extract runs the idempotent extraction for one stored PDF file.
// extractedAt is supplied by the caller (deterministic tests, no clock here).
func (s *PDFExtractionService) Extract(ctx context.Context, contentID, path string, extractedAt int64) (PDFExtractionResult, error) {
	hash, err := s.extractor.DocumentHash(ctx, path)
	if err != nil {
		return PDFExtractionResult{Status: PDFStatusExtractFailed, Reason: "document hash unavailable"}, nil
	}
	// Idempotent per document hash: stored rows for the same hash are reused.
	stored, err := s.reader.Pages(ctx, contentID)
	if err != nil {
		return PDFExtractionResult{}, err
	}
	if len(stored) > 0 && stored[0].DocumentSHA256 == hash {
		return resultFromPages(hash, stored, false), nil
	}
	// At most one active extraction/job per content+hash.
	key := contentID + ":" + hash
	s.mu.Lock()
	if s.active[key] {
		s.mu.Unlock()
		return PDFExtractionResult{Status: PDFStatusExtracting, DocumentSHA256: hash}, nil
	}
	s.active[key] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.active, key)
		s.mu.Unlock()
	}()

	doc, err := s.extractor.Extract(ctx, path)
	if err != nil {
		return PDFExtractionResult{Status: PDFStatusExtractFailed, Reason: "native extraction failed", DocumentSHA256: hash}, nil
	}
	if doc.SHA256 != hash || doc.PageCount != len(doc.Pages) || doc.PageCount <= 0 {
		return PDFExtractionResult{Status: PDFStatusExtractFailed, Reason: "page-count validation failed", DocumentSHA256: hash}, nil
	}
	// Defensive copy: OCR merge must never mutate the extractor's buffers.
	doc.Pages = append([]Page(nil), doc.Pages...)

	var missing []int
	for i, p := range doc.Pages {
		if strings.TrimSpace(p.Text) == "" {
			missing = append(missing, i)
		}
	}
	ocrUsed := false
	ocrReason := ""
	if len(missing) > 0 && s.cfg.OCRMode != OCRModeOff {
		switch {
		case s.cfg.OCRMode == OCRModeCloud && !s.cloudAllowed():
			ocrReason = "cloud OCR requires explicit enablement and consent; no upload performed"
		case s.cfg.OCR == nil || !s.cfg.OCR.Available(ctx):
			ocrReason = "local OCR runtime/model unavailable"
		default:
			res, err := s.cfg.OCR.Recognize(ctx, path, len(missing))
			if err != nil {
				return PDFExtractionResult{Status: PDFStatusExtractFailed, Reason: "OCR failed", DocumentSHA256: hash}, nil
			}
			if len(res.Pages) != len(missing) {
				return PDFExtractionResult{Status: PDFStatusExtractFailed, Reason: "OCR page-count mismatch", DocumentSHA256: hash}, nil
			}
			for k, idx := range missing {
				doc.Pages[idx].Text = res.Pages[k].Text
				doc.Pages[idx].Extractor = s.cfg.OCR.Name()
				doc.Pages[idx].ExtractorVersion = s.cfg.OCR.Version()
			}
			doc.OCRJobID, doc.OCRState = res.JobID, res.State
			ocrUsed = true
		}
	}

	allEmpty := true
	for _, p := range doc.Pages {
		if strings.TrimSpace(p.Text) != "" {
			allEmpty = false
			break
		}
	}
	if allEmpty && ocrReason != "" {
		// No usable native text and OCR could not run: keep the explicit
		// unavailable status without storing, so installing the OCR runtime
		// later still allows extraction on the next save.
		return PDFExtractionResult{Status: PDFStatusOCRUnavailable, Reason: ocrReason, DocumentSHA256: hash}, nil
	}
	if err := s.store.SavePDFPages(ctx, contentID, doc, extractedAt); err != nil {
		return PDFExtractionResult{}, err
	}
	if allEmpty {
		return PDFExtractionResult{Status: PDFStatusNoText, DocumentSHA256: hash, PageCount: doc.PageCount, Pages: doc.Pages, OCRUsed: ocrUsed}, nil
	}
	result := resultFromPages(hash, doc.Pages, ocrUsed)
	if ocrReason != "" {
		// Usable native text is preserved and searchable; the skipped pages
		// are reported honestly instead of discarding the whole document.
		result.Reason = fmt.Sprintf("%s; %d page(s) without a text layer were left empty", ocrReason, len(missing))
	}
	return result, nil
}

// cloudAllowed requires the feature flag AND recorded consent; cloud is off
// by default pending legal/terms review and never a silent fallback.
func (s *PDFExtractionService) cloudAllowed() bool {
	return s.cfg.CloudFeatureEnabled && s.cfg.CloudConsentVersion != "" && s.cfg.CloudConsentAt > 0
}

func resultFromPages(hash string, pages []Page, ocrUsed bool) PDFExtractionResult {
	allEmpty := true
	for _, p := range pages {
		if strings.TrimSpace(p.Text) != "" {
			allEmpty = false
			break
		}
	}
	status := PDFStatusReady
	if allEmpty {
		status = PDFStatusNoText
	}
	return PDFExtractionResult{Status: status, DocumentSHA256: hash, PageCount: len(pages), Pages: pages, OCRUsed: ocrUsed}
}
