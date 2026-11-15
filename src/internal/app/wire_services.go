package app

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"tangentry/internal/adapters/aichat"
	"tangentry/internal/adapters/filesystem"
	"tangentry/internal/adapters/pdftext"
	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/adapters/tools"
	"tangentry/internal/ai"
	"tangentry/internal/config"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/playback"
	"tangentry/internal/retrieval"
	"tangentry/internal/subtitles"
	"tangentry/internal/transcription"
)

// newTranscription configures speech recognition. Environment overrides keep
// developer-installed binaries and models usable without settings changes.
func newTranscription(dataDir string, configuration config.Config, p *platforms, option Options, resolve func(context.Context, string) (transcription.Audio, error), saved *subtitles.SavedService) (*transcription.Service, *transcription.ModelDownloads, string, error) {
	binary := envOr("TANGENTRY_WHISPER_PATH", "whisper-cli")
	streamingBinary := envOr("TANGENTRY_WHISPER_SERVER_PATH", "whisper-server")
	modelDir := envOr("TANGENTRY_WHISPER_MODELS_DIR", filepath.Join(dataDir, "models"))
	model := envOr("TANGENTRY_WHISPER_MODEL", filepath.Join(modelDir, "ggml-base.bin"))
	installer := &tools.ModelInstaller{Root: modelDir, BundledModel: os.Getenv("TANGENTRY_WHISPER_MODEL")}
	var engine transcription.Engine = &tools.Transcriber{ModelDir: modelDir, FFmpeg: configuration.FFmpegPath, YTDLP: configuration.YTDLPPath, StreamingBinary: streamingBinary, HTTP: p.network.public, CacheDir: filepath.Join(dataDir, "transcription-cache"), Models: installer, ResolveYTDLP: p.network.toolkit.YTDLP}
	if option.TranscriptionEngine != nil {
		engine = option.TranscriptionEngine
	}
	settings := filesystem.NewTranscriptionSettings(filepath.Join(dataDir, "transcription.json"))
	speech, err := transcription.NewWithStore(settings, transcription.Config{Backend: "whisper.cpp", Python: os.Getenv("TANGENTRY_FASTER_WHISPER_PYTHON"), Binary: binary, Model: model, Language: "zh"}, engine, resolve, saved)
	if err != nil {
		return nil, nil, "", err
	}
	if err := migrateBundledModel(speech, modelDir); err != nil {
		return nil, nil, "", err
	}
	modelDownloads := transcription.NewModelDownloads(installer, func() string { return speech.Configuration().Python })
	return speech, modelDownloads, modelDir, nil
}

// migrateBundledModel moves settings that named the model formerly packaged in
// <data>/runtime/models to the managed model directory.
func migrateBundledModel(speech *transcription.Service, modelDir string) error {
	c := speech.Configuration()
	if c.Backend != "whisper.cpp" || filepath.Base(filepath.Dir(c.Model)) != "models" || filepath.Base(filepath.Dir(filepath.Dir(c.Model))) != "runtime" {
		return nil
	}
	if info, err := os.Stat(c.Model); err == nil && info.Mode().IsRegular() {
		return nil
	}
	return speech.WithIdleModels(func(c transcription.Config) (transcription.Config, error) {
		c.Model = filepath.Join(modelDir, filepath.Base(c.Model))
		return c, nil
	})
}

// newLanguageAI returns nil when its storage is unavailable; optional AI must
// not prevent playback or library access.
func newLanguageAI(dataDir string, results ai.ResultStore, option Options) *ai.Service {
	var translator ai.Translator = aichat.New()
	if option.AITranslator != nil {
		translator = option.AITranslator
	}
	summarizer := option.AISummarizer
	if summarizer == nil {
		summarizer, _ = translator.(ai.Summarizer)
	}
	languageAI, err := ai.New(filepath.Join(dataDir, "ai"), results, translator, summarizer)
	if err != nil {
		slog.Warn("AI settings unavailable; language assistance is disabled")
		return nil
	}
	return languageAI
}

// newRetrievalEngine wires B's retrieval engine: the SQLite passage source,
// the configured embedding adapter (local-first; nil if settings invalid →
// lexical-only), the saved operational settings (limits, batch size, topK,
// weights), a process-local vector cache (default) and the assembler.
// The persistent SQLite cache (migration 083) is available as an opt-in.
func newRetrievalEngine(store *sqlite.Store) *retrieval.Engine {
	source := sqlite.NewRetrievalSource(store)
	settings, err := store.LoadRetrievalSettings(context.Background())
	if err != nil {
		settings = retrieval.DefaultEmbeddingSettings()
	}
	engine := &retrieval.Engine{Source: source, Embedder: newEmbeddingAdapter(settings), Assembler: retrieval.NewContextAssembler()}
	// Invalid stored settings stay lexical-only (nil adapter), never a
	// half-configured budget.
	if retrieval.ValidateEmbeddingSettings(settings) == nil {
		engine.Settings = &settings
	}
	return engine
}

// newEmbeddingAdapter builds the embedding adapter for validated settings.
// The per-invocation budget lives in the engine wrapper, so the adapter is
// constructed with a nil budget; usage validity flows back through the
// engine's tracker (retrieval.UsageReportingEmbedder). Invalid settings yield
// a nil adapter (lexical-only), never a half-configured client.
func newEmbeddingAdapter(settings retrieval.EmbeddingSettings) retrieval.Embedder {
	if retrieval.ValidateEmbeddingSettings(settings) != nil {
		return nil
	}
	return aichat.NewEmbeddingClient(settings, nil, retrieval.NewProcessVectorCache())
}

// newPDFExtraction wires the extraction service for the saved-PDF flow: the
// vetted native text-layer extractor with the SQLite page-text store. OCR is
// local-first: the user-installed PaddleOCR runtime (environment overrides,
// never silently downloaded, no upload). Without the runtime the service
// preserves the native text of searchable pages and reports the limitation;
// cloud OCR stays disabled here — it requires explicit enablement plus
// recorded consent, and is never a silent fallback.
func newPDFExtraction(store *sqlite.Store) *retrieval.PDFExtractionService {
	ocr := &pdftext.LocalOCR{
		Cfg: pdftext.LocalOCRConfig{
			RuntimePath: os.Getenv("TANGENTRY_PADDLEOCR_PATH"),
			ModelPath:   os.Getenv("TANGENTRY_PADDLEOCR_MODEL"),
		},
		Runner: pdftext.ExecRunner{},
	}
	return retrieval.NewPDFExtractionService(pdftext.NativeExtractor{}, store, store, retrieval.PDFExtractionConfig{OCRMode: retrieval.OCRModeLocal, OCR: ocr})
}

// extractSavedPDF populates the server-side page text for a saved PDF so
// retrieval can read it. Failures are logged, never fatal to the save: the
// retrieval pipeline reports the explicit PDF status on the next request.
// A partial extraction (OCR unavailable for text-less pages) keeps the
// usable native text and logs the limitation.
func extractSavedPDF(ctx context.Context, extraction *retrieval.PDFExtractionService, documents *filesystem.Documents, item content.Item) {
	if item.Kind != "pdf" {
		return
	}
	file, err := documents.File(item.PlatformID)
	if err != nil {
		slog.Warn("Saved PDF file unavailable for text extraction", "contentId", item.ID)
		return
	}
	path := file.Name()
	_ = file.Close()
	result, err := extraction.Extract(ctx, item.ID, path, time.Now().Unix())
	if err != nil {
		slog.Warn("PDF text extraction failed", "contentId", item.ID)
		return
	}
	if result.Status != retrieval.PDFStatusReady {
		slog.Info("PDF text extraction incomplete", "contentId", item.ID, "status", result.Status, "reason", result.Reason)
	} else if result.Reason != "" {
		slog.Info("PDF text extraction limited", "contentId", item.ID, "reason", result.Reason)
	}
}

// newCompatibility converts online videos the web view cannot play; it is optional.
func newCompatibility(p *platforms) *playback.Compatibility {
	compatibility, err := playback.NewCompatibilityWithProbe(p.network.public, func(ctx context.Context, locator string) (playback.Source, error) {
		if ref, parseErr := discovery.ParseDouyin(locator); parseErr == nil && ref.ID != "" {
			return p.network.toolkit.DouyinPlayback(ctx, ref.URL)
		}
		item, err := p.media.notes.Note(ctx, locator)
		if err != nil {
			return playback.Source{}, err
		}
		if item.Kind != "video" || item.MediaURL == "" {
			return playback.Source{}, playback.ErrInvalid
		}
		return playback.Source{URL: item.MediaURL, Duration: item.DurationSeconds}, nil
	}, p.network.toolkit.ConvertPlayback, p.network.toolkit.ProbePlayback)
	if err != nil {
		slog.Warn("Temporary video playback unavailable")
		return nil
	}
	return compatibility
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
