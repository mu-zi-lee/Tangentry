package httptransport

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"
	"tangentry/internal/subtitles"
)

func (h *mediaHandler) savedSubtitleList(w http.ResponseWriter, r *http.Request) {
	if h.media.SavedSubtitles == nil {
		write(w, 503, apiError{"saved_subtitles_unavailable", "本机字幕暂时不可用。"})
		return
	}
	values, err := h.media.SavedSubtitles.List(r.Context(), r.URL.Query().Get("contentId"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"tracks": values})
}
func (h *mediaHandler) savedSubtitleSave(w http.ResponseWriter, r *http.Request) {
	if h.media.SavedSubtitles == nil {
		write(w, 503, apiError{"saved_subtitles_unavailable", "本机字幕暂时不可用。"})
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		write(w, 415, apiError{"invalid_input", "请使用 JSON 格式提交字幕。"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var input struct {
		Revision *int64 `json:"revision"`
		Selected bool   `json:"selected"`
		Track    *struct {
			Language       *string `json:"language"`
			Label          *string `json:"label"`
			Automatic      *bool   `json:"automatic"`
			Source         *string `json:"source"`
			Mismatch       *bool   `json:"mismatch"`
			Translated     bool    `json:"translated"`
			SourceLanguage string  `json:"sourceLanguage"`
			Cues           []struct {
				Start *float64 `json:"start"`
				End   *float64 `json:"end"`
				Text  *string  `json:"text"`
			} `json:"cues"`
		} `json:"track"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || input.Revision == nil || input.Track == nil || input.Track.Language == nil || input.Track.Label == nil || input.Track.Automatic == nil || *input.Track.Language != r.PathValue("language") {
		fail(w, subtitles.ErrSavedInvalid)
		return
	}
	track := subtitles.Track{Language: *input.Track.Language, Label: *input.Track.Label, Automatic: *input.Track.Automatic, Translated: input.Track.Translated, SourceLanguage: input.Track.SourceLanguage, Cues: make([]subtitles.Cue, 0, len(input.Track.Cues))}
	if input.Track.Source != nil {
		track.Source = *input.Track.Source
	}
	if input.Track.Mismatch != nil {
		track.Mismatch = *input.Track.Mismatch
	}
	for _, cue := range input.Track.Cues {
		if cue.Start == nil || cue.End == nil || cue.Text == nil {
			fail(w, subtitles.ErrSavedInvalid)
			return
		}
		track.Cues = append(track.Cues, subtitles.Cue{Start: *cue.Start, End: *cue.End, Text: *cue.Text})
	}
	save := h.media.SavedSubtitles.Save
	if input.Selected {
		save = h.media.SavedSubtitles.SaveSelected
	}
	value, err := save(r.Context(), r.PathValue("contentId"), track, *input.Revision)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, value)
}
func (h *mediaHandler) savedSubtitleDelete(w http.ResponseWriter, r *http.Request) {
	if h.media.SavedSubtitles == nil {
		write(w, 503, apiError{"saved_subtitles_unavailable", "本机字幕暂时不可用。"})
		return
	}
	revision, err := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if err != nil {
		fail(w, subtitles.ErrSavedInvalid)
		return
	}
	if err := h.media.SavedSubtitles.Delete(r.Context(), r.PathValue("contentId"), r.PathValue("language"), revision); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}
