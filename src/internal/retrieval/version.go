package retrieval

import "fmt"

// subtitleVersion is the saved-row revision version for a subtitle track.
func subtitleVersion(revision int64) string {
	return fmt.Sprintf("content-revision:%d", revision)
}

// pdfVersion is the document hash plus extractor provenance for a PDF page.
func pdfVersion(p Page) string {
	return fmt.Sprintf("pdf-sha256:%s;extractor=%s;version=%s", p.DocumentSHA256, p.Extractor, p.ExtractorVersion)
}

// PDFPageVersion is the exported PDF page source-version form used by
// adapters and tests (document hash + extractor provenance).
func PDFPageVersion(p Page) string { return pdfVersion(p) }
