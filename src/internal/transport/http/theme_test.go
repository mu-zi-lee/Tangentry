package httptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"tangentry/internal/adapters/filesystem"
	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/preferences"
)

func newThemeTestHandler(t *testing.T, store *filesystem.ThemePreferences) http.Handler {
	t.Helper()
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(content.NewService(db), discovery.NewService(testProvider{}), fstest.MapFS{
		"index.html": {Data: []byte(`<script>const theme = "__TANGENTRY_THEME__"; const saved = "__TANGENTRY_THEME_SAVED__"; const appearance = "__TANGENTRY_APPEARANCE__"</script>`)},
	}, Options{Preferences: store})
}

func themeRequest(handler http.Handler, method, path string, body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1"+path, body)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestThemeAPIReadsWritesAndValidates(t *testing.T) {
	store := filesystem.NewThemePreferences(filepath.Join(t.TempDir(), "preferences.json"))
	handler := newThemeTestHandler(t, store)

	response := themeRequest(handler, http.MethodGet, "/api/settings/theme", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("default GET status = %d", response.Code)
	}
	var initial struct {
		Theme string `json:"theme"`
		Saved bool   `json:"saved"`
	}
	if err := json.NewDecoder(response.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if initial.Theme != string(preferences.ThemeSystem) || initial.Saved {
		t.Fatalf("default theme = %+v", initial)
	}

	response = themeRequest(handler, http.MethodPut, "/api/settings/theme", bytes.NewBufferString(`{"theme":"dark"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", response.Code, response.Body.String())
	}
	response = themeRequest(handler, http.MethodGet, "/api/settings/theme", nil)
	var saved struct {
		Theme string `json:"theme"`
		Saved bool   `json:"saved"`
	}
	if err := json.NewDecoder(response.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.Theme != string(preferences.ThemeDark) || !saved.Saved {
		t.Fatalf("saved theme = %+v", saved)
	}

	for _, payload := range []string{`{"theme":"neon"}`, `{"theme":"dark"} trailing`} {
		response = themeRequest(handler, http.MethodPut, "/api/settings/theme", bytes.NewBufferString(payload))
		if response.Code != http.StatusBadRequest {
			t.Errorf("payload %q status = %d", payload, response.Code)
		}
	}
}

func TestThemeAPIValueSurvivesHandlerReconstruction(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	first := filesystem.NewThemePreferences(path)
	if err := first.Save(context.Background(), preferences.ThemeLight); err != nil {
		t.Fatal(err)
	}
	second := filesystem.NewThemePreferences(path)
	handler := newThemeTestHandler(t, second)
	response := themeRequest(handler, http.MethodGet, "/api/settings/theme", nil)
	var value struct {
		Theme string `json:"theme"`
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || value.Theme != string(preferences.ThemeLight) {
		t.Fatalf("reopened theme status=%d value=%q", response.Code, value.Theme)
	}
}

func TestInterfacePreferenceAPIUsesValidatedKeyValueProtocol(t *testing.T) {
	store := filesystem.NewPreferences(filepath.Join(t.TempDir(), "preferences.json"))
	handler := newThemeTestHandler(t, store)
	response := themeRequest(handler, http.MethodPut, "/api/preferences/theme", bytes.NewBufferString(`{"value":"dark"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("generic PUT status = %d, body = %s", response.Code, response.Body.String())
	}
	response = themeRequest(handler, http.MethodGet, "/api/preferences/theme", nil)
	var saved struct {
		Key   string `json:"key"`
		Value string `json:"value"`
		Saved bool   `json:"saved"`
	}
	if err := json.NewDecoder(response.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || saved.Key != "theme" || saved.Value != "dark" || !saved.Saved {
		t.Fatalf("generic preference = %+v status=%d", saved, response.Code)
	}
	for path, payload := range map[string]string{
		"/api/preferences/unknown": `{"value":"dark"}`,
		"/api/preferences/theme":   `{"value":"neon"}`,
	} {
		response = themeRequest(handler, http.MethodPut, path, bytes.NewBufferString(payload))
		if response.Code != http.StatusBadRequest {
			t.Errorf("invalid request %s status = %d", path, response.Code)
		}
	}
	response = themeRequest(handler, http.MethodPut, "/api/preferences/theme", bytes.NewBufferString(`{"value":"`+strings.Repeat("x", preferences.MaxValueSize+1)+`"}`))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("oversized value status = %d", response.Code)
	}
}

func TestInterfacePreferenceAPIRejectsOlderRevision(t *testing.T) {
	store := filesystem.NewPreferences(filepath.Join(t.TempDir(), "preferences.json"))
	handler := newThemeTestHandler(t, store)
	for _, payload := range []string{`{"value":"dark","revision":20}`, `{"value":"light","revision":10}`} {
		response := themeRequest(handler, http.MethodPut, "/api/preferences/theme", bytes.NewBufferString(payload))
		if response.Code != http.StatusOK {
			t.Fatalf("revision PUT status=%d body=%s", response.Code, response.Body.String())
		}
	}
	response := themeRequest(handler, http.MethodGet, "/api/preferences/theme", nil)
	var value struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	if value.Value != string(preferences.ThemeDark) {
		t.Fatalf("older revision changed theme=%q", value.Value)
	}
}

func TestIndexHTMLInjectsPersistedThemeBeforeAppScripts(t *testing.T) {
	store := filesystem.NewThemePreferences(filepath.Join(t.TempDir(), "preferences.json"))
	if err := store.Save(context.Background(), preferences.ThemeDark); err != nil {
		t.Fatal(err)
	}
	handler := newThemeTestHandler(t, store)
	response := themeRequest(handler, http.MethodGet, "/", nil)
	body, _ := io.ReadAll(response.Body)
	html := string(body)
	if response.Code != http.StatusOK {
		t.Fatalf("index status = %d", response.Code)
	}
	if !strings.Contains(html, `const theme = "dark"`) || !strings.Contains(html, `const saved = true`) {
		t.Fatalf("theme was not injected: %s", html)
	}
	if strings.Contains(html, "__TANGENTRY_THEME") {
		t.Fatalf("placeholder leaked into HTML: %s", html)
	}
}

func TestSourceIndexHTMLInjectsStartupPreferences(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, saved := range []bool{false, true} {
		t.Run(map[bool]string{false: "defaults", true: "persisted"}[saved], func(t *testing.T) {
			store := filesystem.NewPreferences(filepath.Join(t.TempDir(), "preferences.json"))
			theme, appearance := "system", "{}"
			if saved {
				theme = "dark"
				if err := store.Save(context.Background(), preferences.ThemeDark); err != nil {
					t.Fatal(err)
				}
				value := `{"width":360,"excerpt":false}`
				if err := store.Set(context.Background(), preferences.CardAppearanceKey, value, 1); err != nil {
					t.Fatal(err)
				}
				encoded, _ := json.Marshal(map[string]string{preferences.CardAppearanceKey: value})
				appearance = string(encoded)
			}
			handler := &Handler{preferences: store}
			html := string(handler.injectTheme(httptest.NewRequest(http.MethodGet, "/", nil), data))
			encodedSaved, _ := json.Marshal(saved)
			for _, expected := range []string{
				`const injectedTheme = "` + theme + `"`,
				`const themeSaved = ` + string(encodedSaved) + ` === true`,
				`window.__TANGENTRY_APPEARANCE__ = ` + appearance,
			} {
				if !strings.Contains(html, expected) {
					t.Errorf("startup HTML missing %q: %s", expected, html)
				}
			}
			for _, placeholder := range []string{`"__TANGENTRY_THEME__"`, `"__TANGENTRY_THEME_SAVED__"`, `"__TANGENTRY_APPEARANCE__"`} {
				if strings.Contains(html, placeholder) {
					t.Errorf("startup placeholder not replaced: %s", placeholder)
				}
			}
		})
	}
}

func TestAppearancePreferencesSurviveNewHandlerAndOrigin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	handler := newThemeTestHandler(t, filesystem.NewPreferences(path))
	values := map[string]string{
		preferences.CardAppearanceKey: `{"width":360,"corners":"round","excerpt":false}`,
		preferences.FontSettingsKey:   `{"reading":"noto","fontSize":19,"lineHeight":"relaxed"}`,
	}
	for key, value := range values {
		payload, _ := json.Marshal(preferenceInput{Value: value, Revision: 20})
		response := themeRequest(handler, http.MethodPut, "/api/preferences/"+key, bytes.NewReader(payload))
		if response.Code != http.StatusOK {
			t.Fatalf("PUT %s status=%d body=%s", key, response.Code, response.Body.String())
		}
	}
	restarted := newThemeTestHandler(t, filesystem.NewPreferences(path))
	for key, value := range values {
		response := themeRequest(restarted, http.MethodGet, "/api/preferences/"+key, nil)
		var stored struct {
			Value string `json:"value"`
			Saved bool   `json:"saved"`
		}
		if err := json.NewDecoder(response.Body).Decode(&stored); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || !stored.Saved || stored.Value != value {
			t.Fatalf("restarted %s = %+v status=%d", key, stored, response.Code)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:54321/", nil)
	response := httptest.NewRecorder()
	restarted.ServeHTTP(response, request)
	encoded, _ := json.Marshal(values)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "const appearance = "+string(encoded)) {
		t.Fatalf("appearance not injected on new origin: %s", response.Body.String())
	}
	if strings.Contains(response.Body.String(), "__TANGENTRY_APPEARANCE__") {
		t.Fatal("appearance placeholder leaked into HTML")
	}
}

func TestAppearancePreferencesRejectNonObjectJSON(t *testing.T) {
	handler := newThemeTestHandler(t, filesystem.NewPreferences(filepath.Join(t.TempDir(), "preferences.json")))
	for _, key := range []string{preferences.CardAppearanceKey, preferences.FontSettingsKey} {
		for _, value := range []string{"null", "[]", "true", "broken"} {
			payload, _ := json.Marshal(preferenceInput{Value: value})
			response := themeRequest(handler, http.MethodPut, "/api/preferences/"+key, bytes.NewReader(payload))
			if response.Code != http.StatusBadRequest {
				t.Errorf("%s accepted %q status=%d", key, value, response.Code)
			}
		}
	}
}
