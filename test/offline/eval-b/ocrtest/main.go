// Command ocrtest exercises the REAL local PaddleOCR path end-to-end:
// native text-layer extraction (empty on scanned pages) -> LocalOCR adapter
// (user-installed runtime, no token/upload) -> PDFExtractionService ->
// page-text comparison against the expected OCR-subset fixture -> real
// selector retrieval of the BQ-025/026 gold answers from the OCR'd text.
//
// Run: cd test/offline/eval-b && go run ./ocrtest -pdf ~/ocr-runtime/scanned-ocr-subset.pdf
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"tangentry/internal/adapters/pdftext"
	"tangentry/internal/retrieval"
	"tangentry/eval-b-gen/evalutil"

	"go.yaml.in/yaml/v3"
)

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FATAL: "+format+"\n", args...)
	os.Exit(1)
}

type memStore struct{ pages []retrieval.Page }

func (s *memStore) SavePDFPages(ctx context.Context, contentID string, doc retrieval.PDFDocument, at int64) error {
	s.pages = doc.Pages
	return nil
}

type memText struct{ pages []retrieval.Page }

func (t memText) Pages(ctx context.Context, contentID string) ([]retrieval.Page, error) {
	return t.pages, nil
}

func norm(s string) string { return retrieval.NormalizeMatch(s) }

// stripWS removes ALL whitespace (diagnostic only, never a protocol hit
// criterion): shows whether OCR recognized the answer content apart from
// line-wrap spacing artifacts.
func stripWS(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if !unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// charSimilarity is a simple normalized containment/dice metric on character
// bigrams, for OCR quality reporting (not a protocol hit criterion).
func charSimilarity(a, b string) float64 {
	na, nb := norm(a), norm(b)
	if na == nb {
		return 1.0
	}
	bigrams := func(s string) map[string]int {
		m := map[string]int{}
		r := []rune(s)
		for i := 0; i+1 < len(r); i++ {
			m[string(r[i:i+2])]++
		}
		return m
	}
	ma, mb := bigrams(na), bigrams(nb)
	inter, total := 0, 0
	for k, v := range ma {
		total += v
		if w, ok := mb[k]; ok {
			if w < v {
				inter += w
			} else {
				inter += v
			}
		}
	}
	for _, v := range mb {
		total += v
	}
	if total == 0 {
		return 0
	}
	return 2 * float64(inter) / float64(total)
}

func main() {
	pdfPath := flag.String("pdf", "", "scanned PDF path")
	evalDir := flag.String("eval", ".", "eval-b root")
	runtime := flag.String("runtime", filepath.Join(os.Getenv("HOME"), "ocr-runtime/ocr-runtime"), "OCR runtime executable")
	modelDir := flag.String("model", filepath.Join(os.Getenv("HOME"), "ocr-runtime/models"), "OCR model directory")
	reuse := flag.Bool("reuse-snapshot", false, "reuse fixtures/ocr-actual-snapshot.json instead of re-running OCR (retrieval checks only)")
	flag.Parse()
	if *pdfPath == "" && !*reuse {
		die("-pdf required (or -reuse-snapshot)")
	}

	// Expected fixture text (the provisional OCR subset).
	expected, err := evalutil.LoadSnapshot(filepath.Join(*evalDir, "fixtures", "pdf-ocr-subset.json"))
	if err != nil {
		die("load fixture: %v", err)
	}
	var set evalutil.EvalSet
	ydata, err := os.ReadFile(filepath.Join(*evalDir, "questions.yaml"))
	if err != nil {
		die("questions.yaml: %v", err)
	}
	if err := yaml.Unmarshal(ydata, &set); err != nil {
		die("parse questions.yaml: %v", err)
	}

	ctx := context.Background()
	var result retrieval.PDFExtractionResult
	var elapsed time.Duration
	extractionMode := "live"
	if *reuse {
		snap, err := evalutil.LoadSnapshot(filepath.Join(*evalDir, "fixtures", "ocr-actual-snapshot.json"))
		if err != nil {
			die("load frozen OCR snapshot: %v", err)
		}
		result = retrieval.PDFExtractionResult{
			Status: retrieval.PDFStatusReady, Pages: snap.Pages, OCRUsed: true,
			PageCount: len(snap.Pages), DocumentSHA256: snap.Pages[0].DocumentSHA256,
		}
		extractionMode = "reused-frozen-snapshot"
		fmt.Printf("reusing frozen OCR snapshot: %d pages (extraction evidence from the live run)\n", len(snap.Pages))
	} else {
		ocr := &pdftext.LocalOCR{
			Cfg: pdftext.LocalOCRConfig{
				RuntimePath: *runtime,
				ModelPath:   *modelDir,
				ModelID:     "PP-OCRv5_mobile",
				TimeoutMs:   600000,
			},
			Runner: pdftext.ExecRunner{},
		}
		if !ocr.Available(ctx) {
			die("OCR runtime/model unavailable: %s / %s", *runtime, *modelDir)
		}
		store := &memStore{}
		svc := retrieval.NewPDFExtractionService(
			pdftext.NativeExtractor{}, memText{}, store,
			retrieval.PDFExtractionConfig{OCRMode: retrieval.OCRModeLocal, OCR: ocr},
		)
		start := time.Now()
		var err error
		result, err = svc.Extract(ctx, "fixture:pdf-ocr-subset-scanned", *pdfPath, 0)
		if err != nil {
			die("extract: %v", err)
		}
		elapsed = time.Since(start)
		fmt.Printf("extraction: status=%s pages=%d ocrUsed=%v elapsed=%s\n", result.Status, result.PageCount, result.OCRUsed, elapsed.Round(time.Second))
		if result.Status != retrieval.PDFStatusReady || !result.OCRUsed {
			die("expected ready+OCRUsed, got %s ocrUsed=%v", result.Status, result.OCRUsed)
		}
	}

	// Per-page comparison against expected text.
	type pageCmp struct {
		Page        int     `json:"page"`
		ExactNorm   bool    `json:"exact_normalized_match"`
		Similarity  float64 `json:"char_bigram_similarity"`
		OCRChars    int     `json:"ocr_chars"`
		ExpectedChars int   `json:"expected_chars"`
	}
	var cmps []pageCmp
	exact := 0
	for i, p := range result.Pages {
		exp := expected.Pages[i].Text
		sim := charSimilarity(p.Text, exp)
		eq := norm(p.Text) == norm(exp)
		if eq {
			exact++
		}
		cmps = append(cmps, pageCmp{Page: p.Number, ExactNorm: eq, Similarity: sim, OCRChars: retrieval.RuneLen(p.Text), ExpectedChars: retrieval.RuneLen(exp)})
	}
	fmt.Printf("pages exact-normalized-match: %d/%d\n", exact, len(result.Pages))

	// Retrieval from the OCR'd pages: real selector, lexical mode (no live
	// embeddings; hybrid on OCR text would need new authorized vectors).
	ocrSnap := retrieval.Snapshot{
		ContentID: "fixture:pdf-ocr-subset-scanned",
		Kind:      retrieval.SourcePDF,
		Pages:     result.Pages,
	}
	cfg := retrieval.SelectorConfig{
		TopK: 100, AssemblyBudgetRunes: 120000, MaxBytes: retrieval.DefaultMaxBytes,
		Weights: retrieval.DefaultWeights(), Mode: retrieval.ModeLexical,
		Budget: retrieval.BudgetConfig{Mode: retrieval.BatchingShared, BatchSize: 8, TopK: 100, SweepCandidates: 90, MaxEmbeddingChars: 100000},
		Sweep:  retrieval.SweepConfig{Enabled: true, SweepCandidates: 90},
	}
	type qResult struct {
		QuestionID          string `json:"question_id"`
		Question            string `json:"question"`
		AnswerSentence      string `json:"answer_sentence"`
		AnswerInOCRText     bool   `json:"answer_in_ocr_exact_normalized"`
		AnswerInOCRStripped bool   `json:"answer_in_ocr_whitespace_stripped_diagnostic"`
		LexicalHit          bool   `json:"lexical_selection_contains_answer_exact_normalized"`
		LexicalHitStripped  bool   `json:"lexical_selection_contains_answer_stripped_diagnostic"`
		ExactGoldHit        bool   `json:"exact_gold_segment_hit"`
		SelectedCount       int    `json:"selected_count"`
		Status              string `json:"status"`
	}
	var qrs []qResult
	for _, q := range set.Questions {
		if q.Subset != "ocr-provisional" {
			continue
		}
		// The PDF gold segment begins with the page-header sentence; the
		// answer is the SECOND sentence. (The first version of this test
		// wrongly measured the header — corrected 2026-11-15.)
		sents := strings.SplitAfter(q.GoldPassageText, "。")
		answer := q.GoldPassageText
		if len(sents) >= 2 {
			answer = sents[1]
		}
		inOCR, inOCRStrip := false, false
		for _, p := range result.Pages {
			if strings.Contains(norm(p.Text), norm(answer)) {
				inOCR = true
			}
			if strings.Contains(stripWS(p.Text), stripWS(answer)) {
				inOCRStrip = true
			}
		}
		sel, err := retrieval.NewSelector(evalutil.MemSource{Snap: ocrSnap}, nil, cfg).
			Select(ctx, ocrSnap.ContentID, q.Question, 0)
		if err != nil {
			die("select %s: %v", q.QuestionID, err)
		}
		lexHit, lexHitStrip, exactHit := false, false, false
		for _, p := range sel.Passages {
			if strings.Contains(norm(p.Text), norm(answer)) {
				lexHit = true
			}
			if strings.Contains(stripWS(p.Text), stripWS(answer)) {
				lexHitStrip = true
			}
			if norm(p.Text) == norm(q.GoldPassageText) {
				exactHit = true
			}
		}
		qrs = append(qrs, qResult{QuestionID: q.QuestionID, Question: q.Question, AnswerSentence: answer,
			AnswerInOCRText: inOCR, AnswerInOCRStripped: inOCRStrip, LexicalHit: lexHit, LexicalHitStripped: lexHitStrip,
			ExactGoldHit: exactHit, SelectedCount: len(sel.Passages), Status: string(sel.Status)})
		fmt.Printf("%s: answerExact=%v answerStripped=%v lexExact=%v lexStripped=%v exactGold=%v (status=%s, selected=%d)\n",
			q.QuestionID, inOCR, inOCRStrip, lexHit, lexHitStrip, exactHit, sel.Status, len(sel.Passages))
	}

	out := map[string]any{
		"pdf":                  *pdfPath,
		"extraction_mode":      extractionMode,
		"document_sha256":      result.DocumentSHA256,
		"status":               result.Status,
		"ocr_used":             result.OCRUsed,
		"ocr_extractor":        result.Pages[0].Extractor,
		"ocr_model_id":         result.Pages[0].ExtractorVersion,
		"runtime_path":         *runtime,
		"elapsed_seconds":      elapsed.Seconds(),
		"page_count":           result.PageCount,
		"exact_match_pages":    exact,
		"pages":                cmps,
		"questions":            qrs,
		"note":                 "lexical-only retrieval on OCR text; hybrid would require new authorized embeddings for OCR'd text; OCR-subset labels remain subject to human confirmation",
	}
	data, _ := json.MarshalIndent(out, "", "  ")
	outPath := filepath.Join(*evalDir, "runs", "ocr-subset-results.json")
	if err := os.WriteFile(outPath, append(data, '\n'), 0o644); err != nil {
		die("write results: %v", err)
	}
	fmt.Println("results written:", outPath)

	// Freeze the ACTUAL OCR'd page snapshot (provenance: scanned PDF hash +
	// local OCR model). Provisional gold labels must be re-annotated against
	// this frozen actual text, never against the expected text, before any
	// OCR-subset recall claim.
	if !*reuse {
		ocrSnapOut := retrieval.Snapshot{
			ContentID: "fixture:pdf-ocr-subset-scanned",
			Kind:      retrieval.SourcePDF,
			Pages:     result.Pages,
		}
		snapData, _ := json.MarshalIndent(ocrSnapOut, "", "  ")
		snapPath := filepath.Join(*evalDir, "fixtures", "ocr-actual-snapshot.json")
		if err := os.WriteFile(snapPath, append(snapData, '\n'), 0o644); err != nil {
			die("write ocr snapshot: %v", err)
		}
		fmt.Println("actual OCR snapshot frozen:", snapPath)
	}
}
