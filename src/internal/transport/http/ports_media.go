package httptransport

import (
	"context"
	"net/http"
	"os"

	"tangentry/internal/downloads"
	"tangentry/internal/playback"
	"tangentry/internal/subtitles"
)

type DownloadService interface {
	List(context.Context) ([]downloads.Job, error)
	Start(context.Context, downloads.Request) (downloads.Job, error)
	Inspect(context.Context, string) (downloads.MediaInfo, error)
	Cancel(context.Context, string) error
	Delete(context.Context, string, bool) error
	Clear(context.Context, bool) error
	File(context.Context, string) (*os.File, error)
	Artifact(context.Context, string, string) (*os.File, error)
	NoteFrameFile(context.Context, string, string) (*os.File, error)
}

type PlaybackService interface {
	Open(context.Context, string) (playback.Session, error)
	Release(string)
	Fetch(context.Context, string, string, string) (*http.Response, func(), error)
}

type CompatibilityService interface {
	Open(string) (playback.CompatibilityJob, error)
	Get(string) (playback.CompatibilityJob, error)
	File(string) (*os.File, error)
	Release(string)
}

type SubtitleService interface {
	Read(context.Context, string) (subtitles.Document, error)
	ReadLanguage(context.Context, string, string) (subtitles.Document, error)
	ReadYouTube(context.Context, string, string) (subtitles.Document, error)
}

type SavedSubtitleService interface {
	List(context.Context, string) ([]subtitles.SavedTrack, error)
	Save(context.Context, string, subtitles.Track, int64) (subtitles.SavedTrack, error)
	SaveSelected(context.Context, string, subtitles.Track, int64) (subtitles.SavedTrack, error)
	Capture(context.Context, string, subtitles.Document) error
	Delete(context.Context, string, string, int64) error
}
