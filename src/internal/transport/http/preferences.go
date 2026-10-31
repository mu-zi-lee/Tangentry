package httptransport

import (
	"encoding/json"
	"io"
	"net/http"

	"tangentry/internal/preferences"
)

type preferenceInput struct {
	Value    string `json:"value"`
	Revision int64  `json:"revision"`
}

func (h *Handler) preferenceGet(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if err := preferences.ValidateKey(key); err != nil {
		write(w, http.StatusBadRequest, apiError{"invalid_preference_key", "不支持这个界面偏好。"})
		return
	}
	value, saved, err := h.preferenceValue(r, key)
	if err != nil {
		write(w, http.StatusServiceUnavailable, apiError{"preferences_unavailable", "界面偏好暂时不可用。"})
		return
	}
	write(w, http.StatusOK, map[string]any{"key": key, "value": value, "saved": saved})
}

func (h *Handler) preferencePut(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if err := preferences.ValidateKey(key); err != nil {
		write(w, http.StatusBadRequest, apiError{"invalid_preference_key", "不支持这个界面偏好。"})
		return
	}
	if h.preferences == nil {
		write(w, http.StatusServiceUnavailable, apiError{"preferences_unavailable", "界面偏好暂时不可用。"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, preferences.MaxValueSize+1024)
	var input preferenceInput
	decoder := json.NewDecoder(r.Body)
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		write(w, http.StatusBadRequest, apiError{"invalid_preference", "界面偏好格式无效。"})
		return
	}
	if err := preferences.ValidateValue(input.Value); err != nil {
		write(w, http.StatusBadRequest, apiError{"invalid_preference", "界面偏好值过长。"})
		return
	}
	if key == preferences.ThemeKey && preferences.ParseTheme(input.Value) != preferences.Theme(input.Value) {
		write(w, http.StatusBadRequest, apiError{"invalid_theme", "请选择浅色、深色或跟随系统。"})
		return
	}
	if key == preferences.AutomaticSubtitlesKey && input.Value != "true" && input.Value != "false" {
		write(w, http.StatusBadRequest, apiError{"invalid_preference", "自动字幕偏好值无效。"})
		return
	}
	if key == preferences.CardAppearanceKey || key == preferences.FontSettingsKey {
		var settings map[string]json.RawMessage
		if json.Unmarshal([]byte(input.Value), &settings) != nil || settings == nil {
			write(w, http.StatusBadRequest, apiError{"invalid_preference", "外观偏好格式无效。"})
			return
		}
	}
	if input.Revision < 1 {
		input.Revision = 1
	}
	if err := h.preferences.Set(r.Context(), key, input.Value, input.Revision); err != nil {
		write(w, http.StatusServiceUnavailable, apiError{"preferences_unavailable", "界面偏好未能保存，请检查数据目录权限。"})
		return
	}
	write(w, http.StatusOK, map[string]any{"key": key, "value": input.Value, "saved": true, "revision": input.Revision})
}

func (h *Handler) preferenceValue(r *http.Request, key string) (string, bool, error) {
	if h.preferences == nil {
		if key == preferences.ThemeKey {
			return string(preferences.ThemeSystem), false, nil
		}
		if key == preferences.AutomaticSubtitlesKey {
			return "true", false, nil
		}
		return "", false, nil
	}
	value, saved, err := h.preferences.Get(r.Context(), key)
	if err != nil {
		return "", false, err
	}
	if key == preferences.ThemeKey {
		theme := preferences.ParseTheme(value)
		if value == "" || theme == preferences.Theme(value) {
			return string(theme), saved, nil
		}
		return string(preferences.ThemeSystem), false, nil
	}
	if key == preferences.AutomaticSubtitlesKey && value != "true" && value != "false" {
		return "true", false, nil
	}
	return value, saved, nil
}
