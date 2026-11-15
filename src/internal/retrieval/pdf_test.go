package retrieval

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// --- fakes -----------------------------------------------------------------

type fakeExtractor struct {
	hash       string
	doc        PDFDocument
	extractErr error
	hashErr    error
	calls      int
	block      chan struct{} // when set, Extract waits (concurrency tests)
}

func (f *fakeExtractor) Version() string { return "native-test-1.0" }
func (f *fakeExtractor) DocumentHash(ctx context.Context, path string) (string, error) {
	return f.hash, f.hashErr
}
func (f *fakeExtractor) Extract(ctx context.Context, path string) (PDFDocument, error) {
	f.calls++
	if f.block != nil {
		<-f.block
	}
	if f.extractErr != nil {
		return PDFDocument{}, f.extractErr
	}
	return f.doc, nil
}

type fakeOCR struct {
	name      string
	available bool
	result    OCRResult
	err       error
	calls     int
}

func (f *fakeOCR) Name() string                       { return f.name }
func (f *fakeOCR) Version() string                    { return "PaddleOCR-VL-1.6" }
func (f *fakeOCR) Available(ctx context.Context) bool { return f.available }
func (f *fakeOCR) Recognize(ctx context.Context, path string, expectedPages int) (OCRResult, error) {
	f.calls++
	return f.result, f.err
}

type fakePDFStore struct {
	mu     sync.Mutex
	pages  map[string][]Page
	saves  int
	lastAt int64
}

func newFakePDFStore() *fakePDFStore { return &fakePDFStore{pages: map[string][]Page{}} }
func (f *fakePDFStore) SavePDFPages(ctx context.Context, contentID string, doc PDFDocument, extractedAt int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pages[contentID] = doc.Pages
	f.saves++
	f.lastAt = extractedAt
	return nil
}
func (f *fakePDFStore) Pages(ctx context.Context, contentID string) ([]Page, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pages[contentID], nil
}

func pdfDoc(hash string, texts ...string) PDFDocument {
	doc := PDFDocument{SHA256: hash, PageCount: len(texts)}
	for i, t := range texts {
		doc.Pages = append(doc.Pages, Page{Number: i + 1, Text: t, DocumentSHA256: hash, Extractor: "native", ExtractorVersion: "native-test-1.0"})
	}
	return doc
}

// --- B-T04 (orchestration half) --------------------------------------------

// TestBT04_TextLayerStored: a PDF with a text layer stores page text; the
// answer page is available for retrieval; no OCR is called.
func TestBT04_TextLayerStored(t *testing.T) {
	hash := strings.Repeat("a1", 32)
	doc := pdfDoc(hash, "Page one text.", "The answer is BANANA-42 on page fifty.")
	ex := &fakeExtractor{hash: hash, doc: doc}
	ocr := &fakeOCR{name: "local-paddleocr", available: true}
	store := newFakePDFStore()
	svc := NewPDFExtractionService(ex, store, store, PDFExtractionConfig{OCR: ocr})
	got, err := svc.Extract(context.Background(), "pdf:"+hash, "/tmp/fake.pdf", 123)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != PDFStatusReady || got.OCRUsed || ocr.calls != 0 {
		t.Fatalf("status=%s ocrUsed=%v ocrCalls=%d", got.Status, got.OCRUsed, ocr.calls)
	}
	stored, _ := store.Pages(context.Background(), "pdf:"+hash)
	if len(stored) != 2 || stored[1].Text != "The answer is BANANA-42 on page fifty." {
		t.Fatalf("page text not stored: %+v", stored)
	}
	if store.lastAt != 123 {
		t.Fatal("extractedAt must be the caller-supplied value")
	}
	// Idempotent: same hash reuses stored rows, no second extraction.
	got2, err := svc.Extract(context.Background(), "pdf:"+hash, "/tmp/fake.pdf", 456)
	if err != nil || got2.Status != PDFStatusReady || ex.calls != 1 || store.saves != 1 {
		t.Fatalf("idempotency violated: %+v calls=%d saves=%d", got2, ex.calls, store.saves)
	}
}

// TestBT04_OCRFallback: a no-text page with local OCR available returns OCR
// text; without local OCR the result is pdf_ocr_unavailable; with OCR finding
// nothing the result is pdf_no_text. Never a fabricated passage.
func TestBT04_OCRFallback(t *testing.T) {
	hash := strings.Repeat("b2", 32)
	doc := pdfDoc(hash, "", "")
	ctx := context.Background()

	// Local OCR available → OCR text stored with provenance.
	ocr := &fakeOCR{name: "local-paddleocr", available: true, result: OCRResult{
		Pages: []OCRPage{{Number: 1, Text: "OCR page one."}, {Number: 2, Text: "OCR page two."}},
		JobID: "", State: "done",
	}}
	store := newFakePDFStore()
	svc := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: doc}, store, store, PDFExtractionConfig{OCR: ocr})
	got, err := svc.Extract(ctx, "pdf:"+hash, "/tmp/fake.pdf", 1)
	if err != nil || got.Status != PDFStatusReady || !got.OCRUsed {
		t.Fatalf("OCR fallback: %+v %v", got, err)
	}
	stored, _ := store.Pages(ctx, "pdf:"+hash)
	if stored[0].Text != "OCR page one." || stored[0].Extractor != "local-paddleocr" {
		t.Fatalf("OCR provenance lost: %+v", stored[0])
	}

	// Local OCR missing → pdf_ocr_unavailable, no cloud fallback, no upload.
	missing := &fakeOCR{name: "local-paddleocr", available: false}
	store2 := newFakePDFStore()
	svc2 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "", "")}, store2, store2, PDFExtractionConfig{OCR: missing})
	got2, err := svc2.Extract(ctx, "pdf:"+hash, "/tmp/fake.pdf", 1)
	if err != nil || got2.Status != PDFStatusOCRUnavailable || missing.calls != 0 {
		t.Fatalf("missing runtime: %+v %v", got2, err)
	}

	// OCR finds nothing → pdf_no_text, nothing fabricated.
	empty := &fakeOCR{name: "local-paddleocr", available: true, result: OCRResult{Pages: []OCRPage{{Number: 1, Text: ""}, {Number: 2, Text: "  "}}}}
	store3 := newFakePDFStore()
	svc3 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "", "")}, store3, store3, PDFExtractionConfig{OCR: empty})
	got3, err := svc3.Extract(ctx, "pdf:"+hash, "/tmp/fake.pdf", 1)
	if err != nil || got3.Status != PDFStatusNoText {
		t.Fatalf("no text: %+v %v", got3, err)
	}
	for _, p := range got3.Pages {
		if strings.TrimSpace(p.Text) != "" {
			t.Fatal("fabricated text")
		}
	}
}

// --- B-T27 ------------------------------------------------------------------

// TestBT27_PDFVariants: corrupt/encrypted extractor failure, timeout,
// page-count mismatch and OCR failure are explicit pdf_extract_failed;
// missing runtime is pdf_ocr_unavailable; no fabricated pages.
func TestBT27_PDFVariants(t *testing.T) {
	hash := strings.Repeat("c3", 32)
	ctx := context.Background()

	// Extractor error (corrupt/encrypted file).
	store := newFakePDFStore()
	svc := NewPDFExtractionService(&fakeExtractor{hash: hash, extractErr: fmt.Errorf("encrypted or corrupt")}, store, store, PDFExtractionConfig{})
	got, _ := svc.Extract(ctx, "pdf:"+hash, "/tmp/bad.pdf", 1)
	if got.Status != PDFStatusExtractFailed || store.saves != 0 {
		t.Fatalf("corrupt: %+v saves=%d", got, store.saves)
	}

	// Page-count mismatch from the extractor.
	badDoc := pdfDoc(hash, "one.")
	badDoc.PageCount = 5
	svc2 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: badDoc}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{})
	got2, _ := svc2.Extract(ctx, "pdf:"+hash, "/tmp/bad.pdf", 1)
	if got2.Status != PDFStatusExtractFailed {
		t.Fatalf("extractor page mismatch: %+v", got2)
	}

	// OCR page-count mismatch.
	doc := pdfDoc(hash, "", "")
	ocr := &fakeOCR{name: "local-paddleocr", available: true, result: OCRResult{Pages: []OCRPage{{Number: 1, Text: "only one"}}}}
	svc3 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: doc}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCR: ocr})
	got3, _ := svc3.Extract(ctx, "pdf:"+hash, "/tmp/bad.pdf", 1)
	if got3.Status != PDFStatusExtractFailed || !strings.Contains(got3.Reason, "mismatch") {
		t.Fatalf("OCR page mismatch: %+v", got3)
	}

	// OCR failure (crash/timeout).
	ocrFail := &fakeOCR{name: "local-paddleocr", available: true, err: fmt.Errorf("runtime timeout")}
	svc4 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: doc}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCR: ocrFail})
	got4, _ := svc4.Extract(ctx, "pdf:"+hash, "/tmp/bad.pdf", 1)
	if got4.Status != PDFStatusExtractFailed {
		t.Fatalf("OCR failure: %+v", got4)
	}

	// Context cancellation is honored (extractor timeout path).
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	ex := &fakeExtractor{hash: hash, doc: doc}
	svc5 := NewPDFExtractionService(ex, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{})
	_, err := svc5.Extract(cctx, "pdf:"+hash, "/tmp/bad.pdf", 1)
	_ = err // the fake extractor does not check ctx; the adapter does (native_test)
}

// --- B-T28 (PDF part, domain level) -----------------------------------------

// TestBT28_HashChangeInvalidates: a new document hash replaces old rows; old
// passage references (old hash) no longer verify; new references do.
func TestBT28_HashChangeInvalidates(t *testing.T) {
	hashA := strings.Repeat("d4", 32)
	hashB := strings.Repeat("e5", 32)
	ctx := context.Background()
	store := newFakePDFStore()
	ex := &fakeExtractor{hash: hashA, doc: pdfDoc(hashA, "Old answer text.")}
	svc := NewPDFExtractionService(ex, store, store, PDFExtractionConfig{})
	if _, err := svc.Extract(ctx, "pdf:"+hashA, "/tmp/a.pdf", 1); err != nil {
		t.Fatal(err)
	}
	oldPage := Page{Number: 1, Text: "Old answer text.", DocumentSHA256: hashA, Extractor: "native", ExtractorVersion: "native-test-1.0"}
	oldRef := Passage{
		ID:        PassageID("pdf:"+hashA, SourcePDF, PDFLocator(hashA, 1, 0, 1), 0, RuneLen(oldPage.Text)),
		ContentID: "pdf:" + hashA, Source: SourcePDF, Locator: PDFLocator(hashA, 1, 0, 1),
		StartRune: 0, EndRune: RuneLen(oldPage.Text), Text: oldPage.Text,
		SourceVersion: pdfVersion(oldPage), TextSHA256: TextSHA256(oldPage.Text),
	}
	// New document hash: extraction replaces the rows.
	ex.hash, ex.doc = hashB, pdfDoc(hashB, "New answer text.")
	got, err := svc.Extract(ctx, "pdf:"+hashA, "/tmp/b.pdf", 2)
	if err != nil || got.DocumentSHA256 != hashB {
		t.Fatalf("new hash extraction: %+v %v", got, err)
	}
	stored, _ := store.Pages(ctx, "pdf:"+hashA)
	if len(stored) != 1 || stored[0].DocumentSHA256 != hashB || stored[0].Text != "New answer text." {
		t.Fatalf("old rows not invalidated: %+v", stored)
	}
	// The old reference's locator hash no longer matches the stored document.
	if h, ok := LocatorDocumentHash(oldRef.Locator); !ok || h != hashA {
		t.Fatal("locator hash parsing failed")
	}
	if stored[0].DocumentSHA256 == hashA {
		t.Fatal("old hash must be replaced")
	}
	// Adapter-level stale detection is proven in the sqlite test; here the
	// domain sentinel maps to stale_source in the verifier.
	src := &stalePDFSource{stored: stored}
	kept, dropped, err := VerifyPassages(ctx, src, []Passage{oldRef})
	if err != nil || len(kept) != 0 || len(dropped) != 1 || dropped[0].Reason != DropStaleSource {
		t.Fatalf("old reference must be stale_source: kept=%d dropped=%+v err=%v", len(kept), dropped, err)
	}
}

type stalePDFSource struct{ stored []Page }

func (s *stalePDFSource) Snapshot(ctx context.Context, contentID string) (Snapshot, error) {
	return Snapshot{ContentID: contentID, Kind: SourcePDF, Pages: s.stored}, nil
}
func (s *stalePDFSource) ReadRange(ctx context.Context, contentID, locator string, start, end int) (string, string, error) {
	if h, ok := LocatorDocumentHash(locator); ok && len(s.stored) > 0 && s.stored[0].DocumentSHA256 != h {
		return "", "", ErrStaleSource
	}
	snap, _ := s.Snapshot(ctx, contentID)
	return SnapshotRange(snap, locator, start, end)
}

// --- B-T37 (OCR part) --------------------------------------------------------

// TestBT37_LocalFirstOCR: default mode is local; cloud requires the feature
// flag AND consent; without them no cloud call happens (no upload).
func TestBT37_LocalFirstOCR(t *testing.T) {
	hash := strings.Repeat("f6", 32)
	doc := pdfDoc(hash, "")
	ctx := context.Background()
	cloud := &fakeOCR{name: "paddleocr-cloud", available: true, result: OCRResult{Pages: []OCRPage{{Number: 1, Text: "cloud text"}}}}

	// Default config (no OCRMode) → local: the local runtime is used.
	local := &fakeOCR{name: "local-paddleocr", available: true, result: OCRResult{Pages: []OCRPage{{Number: 1, Text: "local text"}}}}
	store := newFakePDFStore()
	svc := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: doc}, store, store, PDFExtractionConfig{OCR: local})
	got, _ := svc.Extract(ctx, "pdf:"+hash, "/tmp/x.pdf", 1)
	if got.Status != PDFStatusReady || local.calls != 1 || cloud.calls != 0 {
		t.Fatalf("local default: %+v localCalls=%d cloudCalls=%d", got, local.calls, cloud.calls)
	}

	// Explicit cloud mode WITHOUT feature flag/consent → unavailable, zero calls.
	cloud2 := &fakeOCR{name: "paddleocr-cloud", available: true, result: OCRResult{Pages: []OCRPage{{Number: 1, Text: "cloud text"}}, JobID: "job-1", State: "done"}}
	svc2 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "")}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCRMode: OCRModeCloud, OCR: cloud2})
	got2, _ := svc2.Extract(ctx, "pdf:"+hash, "/tmp/x.pdf", 1)
	if got2.Status != PDFStatusOCRUnavailable || cloud2.calls != 0 {
		t.Fatalf("cloud without consent must not upload: %+v calls=%d", got2, cloud2.calls)
	}

	// Cloud mode with flag but no consent → still unavailable.
	svc3 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "")}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCRMode: OCRModeCloud, OCR: cloud2, CloudFeatureEnabled: true})
	got3, _ := svc3.Extract(ctx, "pdf:"+hash, "/tmp/x.pdf", 1)
	if got3.Status != PDFStatusOCRUnavailable || cloud2.calls != 0 {
		t.Fatalf("cloud without consent version: %+v calls=%d", got3, cloud2.calls)
	}

	// Cloud mode with flag AND consent → allowed.
	svc4 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "")}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCRMode: OCRModeCloud, OCR: cloud2, CloudFeatureEnabled: true, CloudConsentVersion: "v1", CloudConsentAt: 123})
	got4, _ := svc4.Extract(ctx, "pdf:"+hash, "/tmp/x.pdf", 1)
	if got4.Status != PDFStatusReady || cloud2.calls != 1 {
		t.Fatalf("cloud with consent: %+v calls=%d", got4, cloud2.calls)
	}

	// OCR off → no OCR call; text-less pages yield pdf_no_text.
	cloud3 := &fakeOCR{name: "paddleocr-cloud", available: true}
	svc5 := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "")}, newFakePDFStore(), newFakePDFStore(), PDFExtractionConfig{OCRMode: OCRModeOff, OCR: cloud3})
	got5, _ := svc5.Extract(ctx, "pdf:"+hash, "/tmp/x.pdf", 1)
	if got5.Status != PDFStatusNoText || cloud3.calls != 0 {
		t.Fatalf("ocr off: %+v calls=%d", got5, cloud3.calls)
	}
}

// TestPDFMixedBlankTextPreservedWithoutOCR: a PDF with one blank page and one
// searchable text page keeps the usable native text when OCR cannot run (no
// provider — the application wiring — an unavailable runtime, or cloud
// without enablement/consent). The skipped pages are reported honestly in
// Reason and no OCR/cloud call happens. An all-blank document still reports
// pdf_ocr_unavailable without storing, so installing the runtime later can
// still extract on the next save.
func TestPDFMixedBlankTextPreservedWithoutOCR(t *testing.T) {
	hash := strings.Repeat("e7", 32)
	ctx := context.Background()
	for _, tc := range []struct {
		name       string
		cfg        PDFExtractionConfig
		wantReason string
	}{
		{"no provider (app wiring)", PDFExtractionConfig{OCRMode: OCRModeLocal}, "local OCR runtime/model unavailable"},
		{"unavailable runtime", PDFExtractionConfig{OCRMode: OCRModeLocal, OCR: &fakeOCR{name: "local-paddleocr", available: false}}, "local OCR runtime/model unavailable"},
		{"cloud without consent", PDFExtractionConfig{OCRMode: OCRModeCloud, OCR: &fakeOCR{name: "paddleocr-cloud", available: true}}, "no upload performed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakePDFStore()
			doc := pdfDoc(hash, "", "The answer is BANANA-42 on page two.")
			svc := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: doc}, store, store, tc.cfg)
			got, err := svc.Extract(ctx, "pdf:"+hash, "/tmp/mixed.pdf", 1)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != PDFStatusReady || got.OCRUsed {
				t.Fatalf("mixed PDF must stay ready with native text: %+v", got)
			}
			if !strings.Contains(got.Reason, tc.wantReason) || !strings.Contains(got.Reason, "1 page(s) without a text layer were left empty") {
				t.Fatalf("limitation must be reported honestly: %q", got.Reason)
			}
			stored, _ := store.Pages(ctx, "pdf:"+hash)
			if len(stored) != 2 || strings.TrimSpace(stored[0].Text) != "" || stored[1].Text != "The answer is BANANA-42 on page two." {
				t.Fatalf("native page text must be preserved: %+v", stored)
			}
			if store.saves != 1 {
				t.Fatalf("pages must be stored exactly once: %d", store.saves)
			}
			if ocr, ok := tc.cfg.OCR.(*fakeOCR); ok && ocr.calls != 0 {
				t.Fatalf("no OCR call allowed: %d", ocr.calls)
			}
		})
	}

	// All-blank + unavailable OCR: explicit unavailable, nothing stored.
	store := newFakePDFStore()
	svc := NewPDFExtractionService(&fakeExtractor{hash: hash, doc: pdfDoc(hash, "", "")}, store, store, PDFExtractionConfig{OCRMode: OCRModeLocal})
	got, err := svc.Extract(ctx, "pdf:"+hash, "/tmp/blank.pdf", 1)
	if err != nil || got.Status != PDFStatusOCRUnavailable || store.saves != 0 {
		t.Fatalf("all-blank without OCR: %+v saves=%d err=%v", got, store.saves, err)
	}
}

// TestPDFExtractionConcurrency: at most one active extraction per
// content+hash; a concurrent call reports pdf_extracting.
func TestPDFExtractionConcurrency(t *testing.T) {
	hash := strings.Repeat("a7", 32)
	block := make(chan struct{})
	ex := &fakeExtractor{hash: hash, doc: pdfDoc(hash, "text."), block: block}
	store := newFakePDFStore()
	svc := NewPDFExtractionService(ex, store, store, PDFExtractionConfig{})
	done := make(chan PDFExtractionResult, 1)
	go func() {
		r, _ := svc.Extract(context.Background(), "pdf:"+hash, "/tmp/x.pdf", 1)
		done <- r
	}()
	// Wait until the first extraction is active.
	for {
		svc.mu.Lock()
		active := svc.active["pdf:"+hash+":"+hash]
		svc.mu.Unlock()
		if active {
			break
		}
	}
	second, _ := svc.Extract(context.Background(), "pdf:"+hash, "/tmp/x.pdf", 1)
	if second.Status != PDFStatusExtracting {
		t.Fatalf("concurrent call = %s, want pdf_extracting", second.Status)
	}
	close(block)
	first := <-done
	if first.Status != PDFStatusReady || ex.calls != 1 {
		t.Fatalf("first extraction: %+v calls=%d", first, ex.calls)
	}
}
