package sqlite

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tangentry/internal/adapters/pdftext"
	"tangentry/internal/content"
	"tangentry/internal/retrieval"
)

// buildPDF fixture helper lives in the pdftext package tests; here we build a
// small deterministic PDF inline (same minimal structure) to keep the sqlite
// test independent of test-only helpers.
func writePDF(t *testing.T, pageTexts []string) string {
	t.Helper()
	var b strings.Builder
	offsets := []int{0}
	obj := func(num int, body string) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", num, body)
	}
	b.WriteString("%PDF-1.4\n")
	n := len(pageTexts)
	kids := make([]string, n)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	obj(2, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	for i, text := range pageTexts {
		pn := 4 + 2*i
		obj(pn, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", pn+1))
		stream := fmt.Sprintf("BT /F1 12 Tf 72 720 Td (%s) Tj ET", text)
		obj(pn+1, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, off := range offsets[1:] {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	path := filepath.Join(t.TempDir(), "doc.pdf")
	if err := os.WriteFile(path, []byte(b.String()), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestBT04_PDFEndToEnd: fixed PDF with a text layer and the answer on page
// 50; server extraction stores page text; retrieval selects the page/sentence
// passage from the store (browser text is never used).
func TestBT04_PDFEndToEnd(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	texts := make([]string, 60)
	for i := range texts {
		texts[i] = fmt.Sprintf("Background paragraph on page %d.", i+1)
	}
	texts[49] = "The secret answer is BANANA-42 on page fifty."
	path := writePDF(t, texts)
	hash, err := pdftext.NativeExtractor{}.DocumentHash(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	contentID := "pdf:" + hash
	item := content.Item{
		ID: contentID, Platform: "pdf", PlatformID: hash,
		Kind: "pdf", Title: "PDF 中段测试", SavedAt: 100,
	}
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}

	// Server-side extraction through the domain service + native adapter.
	svc := retrieval.NewPDFExtractionService(pdftext.NativeExtractor{}, store, store, retrieval.PDFExtractionConfig{})
	res, err := svc.Extract(ctx, contentID, path, 123)
	if err != nil || res.Status != retrieval.PDFStatusReady {
		t.Fatalf("extraction: %+v %v", res, err)
	}
	stored, err := store.ListPDFPages(ctx, contentID)
	if err != nil || len(stored) != 60 {
		t.Fatalf("stored pages: %d %v", len(stored), err)
	}
	if !strings.Contains(stored[49].Text, "BANANA-42") {
		t.Fatalf("page 50 not stored: %q", stored[49].Text)
	}

	// Retrieval selects the page-50 passage from the stored text.
	src := NewRetrievalSource(store)
	snap, err := src.Snapshot(ctx, contentID)
	if err != nil || snap.Kind != retrieval.SourcePDF || len(snap.Pages) != 60 {
		t.Fatalf("snapshot: kind=%s pages=%d %v", snap.Kind, len(snap.Pages), err)
	}
	sel := retrieval.NewSelector(src, nil, retrieval.SelectorConfig{
		TopK: 100, Weights: retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes,
	})
	got, err := sel.Select(ctx, contentID, "secret answer BANANA-42", 0)
	if err != nil {
		t.Fatal(err)
	}
	var gold *retrieval.Passage
	for i := range got.Passages {
		if strings.Contains(got.Passages[i].Text, "BANANA-42") {
			gold = &got.Passages[i]
			break
		}
	}
	if gold == nil {
		t.Fatalf("page-50 answer not selected (status=%s passages=%d)", got.Status, len(got.Passages))
	}
	if gold.Source != retrieval.SourcePDF || !strings.HasPrefix(gold.Locator, "pdf:"+hash+":50:") {
		t.Fatalf("locator = %s", gold.Locator)
	}
	if gold.SourceVersion != retrieval.PDFPageVersion(stored[49]) {
		t.Fatalf("version = %s", gold.SourceVersion)
	}
	// INV-05 re-read verifies the stored passage.
	kept, dropped, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{*gold})
	if err != nil || len(kept) != 1 || len(dropped) != 0 {
		t.Fatalf("verify: kept=%d dropped=%+v %v", len(kept), dropped, err)
	}
}

// TestBT28_PDFHashChange: a changed document hash invalidates old page rows
// and old passage IDs; new extraction uses the new hash; old citations are
// stale_source through the adapter.
func TestBT28_PDFHashChange(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	pathA := writePDF(t, []string{"Old answer text on page one."})
	pathB := writePDF(t, []string{"Replacement answer text on page one."})
	hashA, _ := pdftext.NativeExtractor{}.DocumentHash(ctx, pathA)
	hashB, _ := pdftext.NativeExtractor{}.DocumentHash(ctx, pathB)
	if hashA == hashB {
		t.Fatal("fixtures must have different hashes")
	}
	contentID := "pdf:" + hashA
	item := content.Item{ID: contentID, Platform: "pdf", PlatformID: hashA, Kind: "pdf", Title: "PDF", SavedAt: 100}
	if _, err := store.Save(ctx, item); err != nil {
		t.Fatal(err)
	}
	svc := retrieval.NewPDFExtractionService(pdftext.NativeExtractor{}, store, store, retrieval.PDFExtractionConfig{})
	if _, err := svc.Extract(ctx, contentID, pathA, 1); err != nil {
		t.Fatal(err)
	}
	src := NewRetrievalSource(store)
	sel := retrieval.NewSelector(src, nil, retrieval.SelectorConfig{
		TopK: 100, Weights: retrieval.DefaultWeights(),
		AssemblyBudgetRunes: retrieval.DefaultBudgetRunes, MaxBytes: retrieval.DefaultMaxBytes,
	})
	gotA, err := sel.Select(ctx, contentID, "Old answer text", 0)
	if err != nil || len(gotA.Passages) == 0 {
		t.Fatalf("selection A: %+v %v", gotA, err)
	}
	oldRef := gotA.Passages[0]

	// New document hash: extraction replaces the rows.
	resB, err := svc.Extract(ctx, contentID, pathB, 2)
	if err != nil || resB.DocumentSHA256 != hashB {
		t.Fatalf("extraction B: %+v %v", resB, err)
	}
	stored, _ := store.ListPDFPages(ctx, contentID)
	if len(stored) != 1 || stored[0].DocumentSHA256 != hashB {
		t.Fatalf("old rows not invalidated: %+v", stored)
	}
	// Old citation is stale_source through the adapter.
	kept, dropped, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{oldRef})
	if err != nil || len(kept) != 0 || len(dropped) != 1 || dropped[0].Reason != retrieval.DropStaleSource {
		t.Fatalf("old citation must be stale_source: kept=%d dropped=%+v %v", len(kept), dropped, err)
	}
	// New selection uses the new hash and verifies.
	gotB, err := sel.Select(ctx, contentID, "Replacement answer text", 0)
	if err != nil || len(gotB.Passages) == 0 {
		t.Fatalf("selection B: %+v %v", gotB, err)
	}
	newRef := gotB.Passages[0]
	if !strings.Contains(newRef.Locator, hashB) {
		t.Fatalf("new locator must use the new hash: %s", newRef.Locator)
	}
	keptB, droppedB, err := retrieval.VerifyPassages(ctx, src, []retrieval.Passage{newRef})
	if err != nil || len(keptB) != 1 || len(droppedB) != 0 {
		t.Fatalf("new citation must verify: kept=%d dropped=%+v %v", len(keptB), droppedB, err)
	}
}

// TestPDFPageTextSchema: migration 082 creates the table and indexes; the
// store round-trips provenance and replaces rows per content.
func TestPDFPageTextSchema(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	var tableCount, indexCount int
	if err := store.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='pdf_page_text'`).Scan(&tableCount); err != nil || tableCount != 1 {
		t.Fatalf("pdf_page_text table missing: %d %v", tableCount, err)
	}
	if err := store.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('pdf_page_text_by_content','pdf_page_text_by_hash')`).Scan(&indexCount); err != nil || indexCount != 2 {
		t.Fatalf("indexes missing: %d %v", indexCount, err)
	}
	hash := strings.Repeat("9a", 32)
	doc := retrieval.PDFDocument{SHA256: hash, PageCount: 2, OCRJobID: "job-1", OCRState: "done", Pages: []retrieval.Page{
		{Number: 1, Text: "第一页", DocumentSHA256: hash, Extractor: "local-paddleocr", ExtractorVersion: "PaddleOCR-VL-1.6"},
		{Number: 2, Text: "第二页", DocumentSHA256: hash, Extractor: "native", ExtractorVersion: "v1"},
	}}
	if err := store.SavePDFPages(ctx, "pdf:"+hash, doc, 777); err != nil {
		t.Fatal(err)
	}
	var jobID, state, textHash string
	var pageCount int
	var extractedAt int64
	if err := store.db.QueryRow(`SELECT ocr_job_id, ocr_state, page_count, text_sha256, extracted_at FROM pdf_page_text WHERE content_id=? AND page=1`, "pdf:"+hash).Scan(&jobID, &state, &pageCount, &textHash, &extractedAt); err != nil {
		t.Fatal(err)
	}
	if jobID != "job-1" || state != "done" || pageCount != 2 || textHash != retrieval.TextSHA256("第一页") || extractedAt != 777 {
		t.Fatalf("provenance round-trip: %s %s %d %s %d", jobID, state, pageCount, textHash, extractedAt)
	}
	// Replace: new hash removes old rows.
	doc2 := retrieval.PDFDocument{SHA256: strings.Repeat("8b", 32), PageCount: 1, Pages: []retrieval.Page{{Number: 1, Text: "new", DocumentSHA256: strings.Repeat("8b", 32), Extractor: "native", ExtractorVersion: "v1"}}}
	if err := store.SavePDFPages(ctx, "pdf:"+hash, doc2, 778); err != nil {
		t.Fatal(err)
	}
	pages, _ := store.ListPDFPages(ctx, "pdf:"+hash)
	if len(pages) != 1 || pages[0].Text != "new" {
		t.Fatalf("replace failed: %+v", pages)
	}
}
