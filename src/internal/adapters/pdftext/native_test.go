package pdftext

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/retrieval"
)

// buildTestPDF writes a minimal, deterministic, uncompressed PDF with one
// Helvetica text line per page. ASCII text keeps the fixture font-independent
// (CJK PDFs are covered by the OCR path). Returns the file path.
func buildTestPDF(t *testing.T, pageTexts []string) string {
	t.Helper()
	var buf bytes.Buffer
	offsets := []int{0} // object 0 free entry
	writeObj := func(num int, body string) {
		offsets = append(offsets, buf.Len())
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", num, body)
	}
	buf.WriteString("%PDF-1.4\n")
	n := len(pageTexts)
	kids := make([]string, n)
	for i := 0; i < n; i++ {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	writeObj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	writeObj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i, text := range pageTexts {
		pageNum := 4 + 2*i
		contentNum := pageNum + 1
		writeObj(pageNum, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", contentNum))
		stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
		writeObj(contentNum, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
	}
	xrefOffset := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", len(offsets))
	buf.WriteString("0000000000 65535 f \n")
	for _, off := range offsets[1:] {
		fmt.Fprintf(&buf, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xrefOffset)
	path := filepath.Join(t.TempDir(), "fixture.pdf")
	if err := os.WriteFile(path, buf.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestBT04_NativeTextLayer: fixed PDF with a text layer and the answer on
// page 50; server extraction stores per-page text with the document hash and
// extractor version; the answer page is exact.
func TestBT04_NativeTextLayer(t *testing.T) {
	texts := make([]string, 60)
	for i := range texts {
		texts[i] = fmt.Sprintf("Background paragraph on page %d.", i+1)
	}
	texts[49] = "The secret answer is BANANA-42 on page fifty."
	path := buildTestPDF(t, texts)

	ex := NativeExtractor{}
	doc, err := ex.Extract(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if doc.PageCount != 60 || len(doc.Pages) != 60 {
		t.Fatalf("page count = %d/%d", doc.PageCount, len(doc.Pages))
	}
	if len(doc.SHA256) != 64 {
		t.Fatalf("document hash = %q", doc.SHA256)
	}
	hash, err := ex.DocumentHash(context.Background(), path)
	if err != nil || hash != doc.SHA256 {
		t.Fatalf("hash mismatch: %q vs %q (%v)", hash, doc.SHA256, err)
	}
	if !strings.Contains(doc.Pages[49].Text, "BANANA-42") {
		t.Fatalf("page 50 text = %q", doc.Pages[49].Text)
	}
	for i, p := range doc.Pages {
		if p.Number != i+1 || p.DocumentSHA256 != doc.SHA256 || p.Extractor != "native" || p.ExtractorVersion == "" {
			t.Fatalf("page %d provenance: %+v", i, p)
		}
	}
	// Deterministic: two extractions identical.
	doc2, err := ex.Extract(context.Background(), path)
	if err != nil || doc2.SHA256 != doc.SHA256 || doc2.Pages[49].Text != doc.Pages[49].Text {
		t.Fatal("non-deterministic extraction")
	}
}

// TestBT27_NativeFailures: corrupt and encrypted files fail explicitly; a
// cancelled context stops extraction; no pages are fabricated.
func TestBT27_NativeFailures(t *testing.T) {
	ex := NativeExtractor{}
	dir := t.TempDir()

	// Corrupt file.
	corrupt := filepath.Join(dir, "corrupt.pdf")
	if err := os.WriteFile(corrupt, []byte("this is not a pdf at all"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Extract(context.Background(), corrupt); err == nil {
		t.Fatal("corrupt file must fail")
	}

	// Encrypted file (trailer /Encrypt): the library refuses encrypted PDFs.
	texts := []string{"Encrypted page."}
	base := buildTestPDF(t, texts)
	raw, err := os.ReadFile(base)
	if err != nil {
		t.Fatal(err)
	}
	encrypted := bytes.Replace(raw, []byte("/Root 1 0 R >>"), []byte("/Root 1 0 R /Encrypt 99 0 R >>"), 1)
	encPath := filepath.Join(dir, "encrypted.pdf")
	if err := os.WriteFile(encPath, encrypted, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ex.Extract(context.Background(), encPath); err == nil {
		t.Fatal("encrypted file must fail")
	}

	// Missing file.
	if _, err := ex.Extract(context.Background(), filepath.Join(dir, "missing.pdf")); err == nil {
		t.Fatal("missing file must fail")
	}

	// Cancelled context.
	path := buildTestPDF(t, texts)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ex.Extract(ctx, path); err == nil {
		t.Fatal("cancelled context must fail")
	}
}

// TestNativeEmptyPage: a page without text yields empty text (the OCR
// fallback decision belongs to the service), never fabricated content.
func TestNativeEmptyPage(t *testing.T) {
	path := buildTestPDF(t, []string{"Has text.", ""})
	doc, err := NativeExtractor{}.Extract(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(doc.Pages[1].Text) != "" {
		t.Fatalf("empty page fabricated: %q", doc.Pages[1].Text)
	}
	var _ retrieval.PDFDocument = doc
}
