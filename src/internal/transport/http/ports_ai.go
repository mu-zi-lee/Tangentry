package httptransport

import (
	"context"

	"tangentry/internal/ai"
	"tangentry/internal/automaticsubtitles"
	"tangentry/internal/retrieval"
	"tangentry/internal/subtitles"
	"tangentry/internal/transcription"
)

// RetrievalSettingsService persists B's embedding/rerank configuration and
// applies it at runtime. Responses are masked (hasKey only); keys are
// write-only inputs.
type RetrievalSettingsService interface {
	Get(ctx context.Context) (retrieval.MaskedSettings, error)
	Save(ctx context.Context, input retrieval.EmbeddingSettings) (retrieval.MaskedSettings, error)
}

type AIService interface {
	Status() ai.Status
	Configure(ai.ConfigureInput) (ai.Status, error)
	ListModels(context.Context, ai.ConfigureInput) (ai.ModelsResult, error)
	Check(context.Context, ai.CheckInput) (ai.CheckResult, error)
	Inspect(context.Context, ai.Input) (ai.Inspection, error)
	Translate(context.Context, ai.Input) (ai.Result, error)
	Cached(context.Context, string) (ai.Result, error)
	SummaryInspect(context.Context, ai.SummaryInput) (ai.SummaryInspection, error)
	SummaryGenerate(context.Context, ai.SummaryInput) (ai.SummaryResult, error)
	SummaryCached(context.Context, string) (ai.SummaryResult, error)
	SummaryTitleOverrides(context.Context, string) (ai.SummaryTitleOverrides, error)
	PutSummaryTitleOverride(context.Context, string, ai.SummaryTitleOverride) (ai.SummaryTitleOverrides, error)
	DeleteSummaryTitleOverride(context.Context, string, string) (ai.SummaryTitleOverrides, error)
	Chat(context.Context, ai.ChatRequest) (ai.ChatResult, error)
	ChatStream(context.Context, ai.ChatRequest, func(string) error) (ai.ChatResult, error)
	ChatHistory(context.Context, string) (ai.ChatResult, error)
}

type TranscriptionService interface {
	Status() transcription.Status
	ConfigureSettings(transcription.SettingsInput) (transcription.Status, error)
	StartWithUploadConsent(context.Context, string, bool, bool, string) (transcription.Job, error)
	Current(string) *transcription.Job
	Get(string) (transcription.Job, error)
	Cancel(string) error
}

type AutomaticSubtitleService interface {
	Start(context.Context, string, string, string, float64, float64) (automaticsubtitles.Session, error)
	Current(string) *automaticsubtitles.Session
	Get(string) (automaticsubtitles.Session, error)
	Draft(string) (automaticsubtitles.Draft, error)
	Playback(string, automaticsubtitles.Playback) (automaticsubtitles.Session, error)
	AppendAudio(string, automaticsubtitles.AudioChunk) (automaticsubtitles.Session, error)
	Finalize(context.Context, string) (subtitles.SavedTrack, error)
	Pause(string) (automaticsubtitles.Session, error)
	Cancel(string) error
}

type ModelDownloadService interface {
	Status() ([]transcription.ModelOption, *transcription.ModelDownload, bool)
	Start(string) (transcription.ModelDownload, error)
	Cancel(string) error
}
