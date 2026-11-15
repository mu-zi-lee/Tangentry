// Package pdftext implements the retrieval PDF extraction ports: a vetted
// pure-Go native text-layer extractor (github.com/ledongthuc/pdf,
// BSD-3-Clause; license recorded in docs/licenses), a local user-installed
// PaddleOCR adapter (no token, no upload) and a feature-flagged cloud
// PaddleOCR job adapter (explicit opt-in + consent, token redacted).
package pdftext

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"github.com/ledongthuc/pdf"
	"tangentry/internal/retrieval"
)

// NativeExtractorVersion identifies the pinned extractor library revision.
const NativeExtractorVersion = "ledongthuc-pdf-v0.0.0-20261020125853-5e46805f718e"

// NativeExtractor extracts the PDF text layer with the vetted pure-Go
// library. Pages without text yield empty Text (the OCR fallback decision
// belongs to the domain service); nothing is fabricated.
type NativeExtractor struct{}

// Version implements retrieval.PDFTextExtractor.
func (NativeExtractor) Version() string { return NativeExtractorVersion }

// DocumentHash streams the file SHA-256 (the document identity).
func (NativeExtractor) DocumentHash(ctx context.Context, path string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Extract reads per-page text. Encrypted/corrupt files are explicit errors;
// a cancelled context stops between pages.
func (n NativeExtractor) Extract(ctx context.Context, path string) (retrieval.PDFDocument, error) {
	hash, err := n.DocumentHash(ctx, path)
	if err != nil {
		return retrieval.PDFDocument{}, err
	}
	f, r, err := pdf.Open(path)
	if err != nil {
		return retrieval.PDFDocument{}, fmt.Errorf("open pdf: %w", err)
	}
	defer f.Close()
	count := r.NumPage()
	if count <= 0 {
		return retrieval.PDFDocument{}, fmt.Errorf("pdf has no pages")
	}
	doc := retrieval.PDFDocument{SHA256: hash, PageCount: count, Pages: make([]retrieval.Page, 0, count)}
	for i := 1; i <= count; i++ {
		if err := ctx.Err(); err != nil {
			return retrieval.PDFDocument{}, err
		}
		text, err := r.Page(i).GetPlainText(nil)
		if err != nil {
			return retrieval.PDFDocument{}, fmt.Errorf("page %d: %w", i, err)
		}
		doc.Pages = append(doc.Pages, retrieval.Page{
			Number:           i,
			Text:             text,
			DocumentSHA256:   hash,
			Extractor:        "native",
			ExtractorVersion: NativeExtractorVersion,
		})
	}
	return doc, nil
}

var _ retrieval.PDFTextExtractor = NativeExtractor{}
