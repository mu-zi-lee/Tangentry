package httptransport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tangentry/internal/samples"
)

type fakeSamples struct {
	status  samples.Status
	err     error
	gotBool *bool
	loads   int
	removes int
}

func (f *fakeSamples) Status(context.Context) (samples.Status, error) { return f.status, f.err }

func (f *fakeSamples) SetEnabled(_ context.Context, enabled bool) (samples.Status, error) {
	f.gotBool = &enabled
	return f.status, f.err
}

func (f *fakeSamples) Load(context.Context) (samples.Status, error) {
	f.loads++
	return f.status, f.err
}

func (f *fakeSamples) Remove(context.Context) (samples.Status, error) {
	f.removes++
	return f.status, f.err
}

func samplesRequest(t *testing.T, method, path, body string) *http.Request {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, reader)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

func samplesFixture() samples.Status {
	return samples.Status{
		Enabled: true,
		Seeded:  true,
		Items: []samples.Item{
			{ID: "pdf:aaa", Title: "示例一", Source: "香港特別行政區政府", Note: "原生文本層", Present: true},
			{ID: "pdf:bbb", Title: "示例二", Source: "香港特別行政區政府", Note: "PaddleOCR", Present: false},
		},
	}
}

func TestSamplesStatusGet(t *testing.T) {
	service := &fakeSamples{status: samplesFixture()}
	h := &samplesHandler{service: service}
	w := httptest.NewRecorder()
	h.samplesStatusGet(w, samplesRequest(t, http.MethodGet, "/api/samples", ""))

	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var body samples.Status
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Enabled || !body.Seeded || len(body.Items) != 2 {
		t.Fatalf("body = %+v", body)
	}
	if body.Items[1].Present {
		t.Fatal("per-item presence must be reported truthfully")
	}
}

func TestSamplesStatusGetRejectsQuery(t *testing.T) {
	h := &samplesHandler{service: &fakeSamples{}}
	w := httptest.NewRecorder()
	h.samplesStatusGet(w, samplesRequest(t, http.MethodGet, "/api/samples?x=1", ""))
	if w.Code != 400 {
		t.Fatalf("status = %d", w.Code)
	}
}

func TestSamplesSettingsPut(t *testing.T) {
	service := &fakeSamples{status: samplesFixture()}
	h := &samplesHandler{service: service}
	w := httptest.NewRecorder()
	h.samplesSettingsPut(w, samplesRequest(t, http.MethodPut, "/api/samples", `{"enabled":false}`))
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	if service.gotBool == nil || *service.gotBool {
		t.Fatalf("enabled not forwarded: %v", service.gotBool)
	}
}

func TestSamplesSettingsPutGuards(t *testing.T) {
	service := &fakeSamples{status: samplesFixture()}
	h := &samplesHandler{service: service}
	cases := []struct{ name, body string }{
		{"missing field", `{}`},
		{"unknown field", `{"enabled":true,"bogus":1}`},
		{"wrong type", `{"enabled":"yes"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.samplesSettingsPut(w, samplesRequest(t, http.MethodPut, "/api/samples", tc.body))
			if w.Code != 400 {
				t.Fatalf("%s = %d: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}
	if service.gotBool != nil {
		t.Fatal("a rejected body must not reach the service")
	}
}

func TestSamplesLoadAndRemoveAreSeparateActions(t *testing.T) {
	service := &fakeSamples{status: samplesFixture()}
	h := &samplesHandler{service: service}

	w := httptest.NewRecorder()
	h.samplesLoad(w, samplesRequest(t, http.MethodPost, "/api/samples/load", ""))
	if w.Code != 200 || service.loads != 1 {
		t.Fatalf("load = %d, calls = %d", w.Code, service.loads)
	}
	if service.removes != 0 {
		t.Fatal("loading must not remove anything")
	}

	w = httptest.NewRecorder()
	h.samplesRemove(w, samplesRequest(t, http.MethodDelete, "/api/samples", ""))
	if w.Code != 200 || service.removes != 1 {
		t.Fatalf("remove = %d, calls = %d", w.Code, service.removes)
	}
}

func TestSamplesUnavailable(t *testing.T) {
	h := &samplesHandler{}
	cases := []struct {
		name string
		call func(http.ResponseWriter, *http.Request)
	}{
		{"status", h.samplesStatusGet},
		{"settings", h.samplesSettingsPut},
		{"load", h.samplesLoad},
		{"remove", h.samplesRemove},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.call(w, samplesRequest(t, http.MethodGet, "/api/samples", ""))
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("%s = %d", tc.name, w.Code)
			}
		})
	}
}

func TestSamplesRoutesRegistered(t *testing.T) {
	service := &fakeSamples{status: samplesFixture()}
	h := NewWithDependencies(Dependencies{Samples: service}, nil)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/samples"},
		{http.MethodDelete, "/api/samples"},
		{http.MethodPost, "/api/samples/load"},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, "http://127.0.0.1"+tc.path, nil))
		if w.Code == http.StatusNotFound || w.Code == http.StatusMethodNotAllowed {
			t.Fatalf("%s %s not routed: %d", tc.method, tc.path, w.Code)
		}
	}
}
