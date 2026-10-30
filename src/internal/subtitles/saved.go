package subtitles

import (
	"context"
	"errors"
	"math"
	"regexp"
	"strings"
	"tangentry/internal/content"
	"time"
	"unicode/utf8"
)

var ErrSavedInvalid = errors.New("invalid saved subtitle")
var ErrSavedConflict = errors.New("saved subtitle changed")
var ErrSavedLimit = errors.New("saved subtitle language limit")
var savedLanguage = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

const MaxSavedLanguages = 32
const MaxSavedRevision int64 = 9007199254740990

type SavedTrack struct {
	ContentID string `json:"contentId"`
	Track     Track  `json:"track"`
	Revision  int64  `json:"revision"`
	SavedAt   int64  `json:"savedAt"`
	Selected  bool   `json:"selected,omitempty"`
}
type SavedRepository interface {
	ListSavedSubtitles(context.Context, string) ([]SavedTrack, error)
	SaveSubtitles(context.Context, SavedTrack, int64) (SavedTrack, error)
	DeleteSavedSubtitles(context.Context, string, string, int64) error
}
type SavedService struct{ repository SavedRepository }

func NewSavedService(repository SavedRepository) *SavedService {
	return &SavedService{repository: repository}
}
func (s *SavedService) List(ctx context.Context, id string) ([]SavedTrack, error) {
	if !content.SpeechID(id) {
		return nil, ErrSavedInvalid
	}
	return s.repository.ListSavedSubtitles(ctx, id)
}
func (s *SavedService) Save(ctx context.Context, id string, track Track, revision int64) (SavedTrack, error) {
	return s.save(ctx, id, track, revision, false)
}

func (s *SavedService) SaveSelected(ctx context.Context, id string, track Track, revision int64) (SavedTrack, error) {
	return s.save(ctx, id, track, revision, true)
}

func (s *SavedService) save(ctx context.Context, id string, track Track, revision int64, selected bool) (SavedTrack, error) {
	if !content.SpeechID(id) || !savedLanguage.MatchString(track.Language) || revision < 0 || revision >= MaxSavedRevision || (track.Source != "" && track.Source != "cc" && track.Source != "ai" && track.Source != "yt-dlp" && track.Source != "youtube" && track.Source != "automatic") || (track.Mismatch && track.Source != "ai") || !utf8.ValidString(track.Label) || strings.TrimSpace(track.Label) == "" || len(track.Cues) == 0 || len(track.Cues) > 10000 {
		return SavedTrack{}, ErrSavedInvalid
	}
	if track.SourceLanguage != "" && !savedLanguage.MatchString(track.SourceLanguage) || track.Translated && (track.Source != "youtube" || track.SourceLanguage == "") {
		return SavedTrack{}, ErrSavedInvalid
	}
	total, previous := 0, -1.0
	for _, cue := range track.Cues {
		if math.IsNaN(cue.Start) || math.IsNaN(cue.End) || math.IsInf(cue.Start, 0) || math.IsInf(cue.End, 0) || cue.Start < 0 || cue.Start < previous || cue.End <= cue.Start || cue.End > 7*24*3600 || !utf8.ValidString(cue.Text) || strings.TrimSpace(cue.Text) == "" || len(cue.Text) > 8000 {
			return SavedTrack{}, ErrSavedInvalid
		}
		total += len(cue.Text)
		if total > 2<<20 {
			return SavedTrack{}, ErrSavedInvalid
		}
		previous = cue.Start
	}
	value := SavedTrack{ContentID: id, Track: track, SavedAt: time.Now().Unix(), Selected: selected}
	if archive, ok := s.repository.(interface {
		ArchiveSubtitle(context.Context, SavedTrack) error
	}); ok {
		previous, err := s.repository.ListSavedSubtitles(ctx, id)
		if err != nil {
			return SavedTrack{}, err
		}
		for _, old := range previous {
			if old.Track.Language == track.Language {
				if err := archive.ArchiveSubtitle(ctx, old); err != nil {
					return SavedTrack{}, err
				}
			}
		}
		if err := archive.ArchiveSubtitle(ctx, value); err != nil {
			return SavedTrack{}, err
		}
	}
	return s.repository.SaveSubtitles(ctx, value, revision)
}

// Capture only creates missing active languages; edited tracks always win.
func (s *SavedService) Capture(ctx context.Context, id string, doc Document) error {
	if doc.Status != "available" && doc.Status != "cc" && doc.Status != "ai" && doc.Status != "ai_mismatch" {
		return nil
	}
	if len(doc.Tracks) == 0 {
		return nil
	}
	for _, track := range doc.Tracks {
		if _, err := s.Save(ctx, id, track, 0); err != nil && !errors.Is(err, ErrSavedConflict) {
			return err
		}
	}
	return nil
}
func (s *SavedService) Delete(ctx context.Context, id, language string, revision int64) error {
	if !content.SpeechID(id) || !savedLanguage.MatchString(language) || revision <= 0 || revision >= MaxSavedRevision {
		return ErrSavedInvalid
	}
	return s.repository.DeleteSavedSubtitles(ctx, id, language, revision)
}
