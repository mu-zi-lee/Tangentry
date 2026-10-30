package sqlite

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"tangentry/internal/subtitles"
	"testing"
)

func TestSavedSubtitlesDurableCASAndTombstone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "saved.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s := subtitles.NewSavedService(store)
	ctx := context.Background()
	id := "bilibili:BV17x411w7KC"
	track := subtitles.Track{Language: "zh", Label: "中文", Cues: []subtitles.Cue{{Start: 1, End: 2, Text: "独立字幕"}}}
	first, err := s.Save(ctx, id, track, 0)
	if err != nil || first.Revision != 1 {
		t.Fatal(first, err)
	}
	if _, err := s.Save(ctx, id, track, 0); !errors.Is(err, subtitles.ErrSavedConflict) {
		t.Fatal("create overwrote", err)
	}
	changed, err := s.Save(ctx, id, track, first.Revision)
	if err != nil || changed.Revision != 2 {
		t.Fatal(changed, err)
	}
	if err := s.Delete(ctx, id, "zh", first.Revision); !errors.Is(err, subtitles.ErrSavedConflict) {
		t.Fatal("stale delete")
	}
	if err := s.Delete(ctx, id, "zh", changed.Revision); err != nil {
		t.Fatal(err)
	}
	re, err := s.Save(ctx, id, track, 0)
	if err != nil || re.Revision != 4 {
		t.Fatal("tombstone reset", re, err)
	}
	if _, err := s.Save(ctx, id, track, first.Revision); !errors.Is(err, subtitles.ErrSavedConflict) {
		t.Fatal("ABA overwrite")
	}
	store.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s = subtitles.NewSavedService(store)
	values, err := s.List(ctx, id)
	if err != nil || len(values) != 1 || values[0].Track.Cues[0].Text != "独立字幕" {
		t.Fatal(values, err)
	}
	if values, err := s.List(ctx, "bilibili:BV1Pyta66EDh"); err != nil || len(values) != 0 {
		t.Fatal("content leak")
	}
	for i := 1; i < subtitles.MaxSavedLanguages; i++ {
		track.Language = fmt.Sprintf("lang-%d", i)
		if _, err := s.Save(ctx, id, track, 0); err != nil {
			t.Fatal(err)
		}
	}
	track.Language = "overflow"
	if _, err := s.Save(ctx, id, track, 0); !errors.Is(err, subtitles.ErrSavedLimit) {
		t.Fatal("limit", err)
	}
	items, _ := store.List(ctx)
	jobs, _ := store.ListDownloads(ctx)
	if len(items) != 0 || len(jobs) != 0 {
		t.Fatal("unexpected side effects")
	}
}

func TestSavedYouTubeCaptionsStayIndependentAndDurable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "youtube-captions.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	service := subtitles.NewSavedService(store)
	track := subtitles.Track{Language: "en", Label: "英语", Cues: []subtitles.Cue{{Start: 1, End: 2, Text: "saved YouTube text"}}}
	saved, err := service.Save(ctx, "youtube:jNQXAC9IVRw", track, 0)
	if err != nil || saved.ContentID != "youtube:jNQXAC9IVRw" {
		t.Fatal("YouTube storage failed", err)
	}
	store.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service = subtitles.NewSavedService(store)
	values, err := service.List(ctx, "youtube:jNQXAC9IVRw")
	if err != nil || len(values) != 1 || values[0].Track.Cues[0].Text != track.Cues[0].Text {
		t.Fatal("YouTube caption not durable")
	}
	if values, err := service.List(ctx, "bilibili:BV17x411w7KC"); err != nil || len(values) != 0 {
		t.Fatal("YouTube caption leaked to Bilibili")
	}
	if _, err := service.Save(ctx, "youtube:invalid", track, 0); !errors.Is(err, subtitles.ErrSavedInvalid) {
		t.Fatal("invalid YouTube identity accepted")
	}
	if err := service.Delete(ctx, saved.ContentID, "en", saved.Revision); err != nil {
		t.Fatal(err)
	}
}

func TestManualSubtitleSelectionReplacesTrackAndSurvivesCaptureAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "selected-captions.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	service := subtitles.NewSavedService(store)
	id := "youtube:N6FkmdL0Lg0"
	english := subtitles.Track{Language: "en", Label: "English", Source: "youtube", Cues: []subtitles.Cue{{Start: 0, End: 2, Text: "Original English"}}}
	chinese := subtitles.Track{Language: "zh-Hans", Label: "中文", Source: "youtube", Translated: true, SourceLanguage: "en", Cues: []subtitles.Cue{{Start: 0, End: 2, Text: "平台中文"}}}
	first, err := service.SaveSelected(ctx, id, english, 0)
	if err != nil || !first.Selected {
		t.Fatal(first, err)
	}
	second, err := service.SaveSelected(ctx, id, chinese, 0)
	if err != nil || !second.Selected {
		t.Fatal(second, err)
	}
	// A stale write must roll back the change to the selected language too.
	if _, err := service.SaveSelected(ctx, id, english, 99); !errors.Is(err, subtitles.ErrSavedConflict) {
		t.Fatal("stale selection accepted", err)
	}
	current, _ := service.List(ctx, id)
	if len(current) != 2 || current[0].Selected || !current[1].Selected {
		t.Fatal("selection changed after rejected write", current)
	}
	english.Cues[0].Text = "Manually selected replacement"
	replacement, err := service.SaveSelected(ctx, id, english, first.Revision)
	if err != nil || replacement.Revision != first.Revision+1 {
		t.Fatal(replacement, err)
	}
	if err := service.Capture(ctx, id, subtitles.Document{Status: "available", Tracks: []subtitles.Track{chinese}}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	current, err = subtitles.NewSavedService(store).List(ctx, id)
	if err != nil || len(current) != 2 || !current[0].Selected || current[1].Selected || current[0].Track.Cues[0].Text != english.Cues[0].Text || !current[1].Track.Translated || current[1].Track.SourceLanguage != "en" {
		t.Fatal("manual selection lost", current, err)
	}
}
