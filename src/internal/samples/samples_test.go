package samples

import (
	"strings"
	"testing"
)

func TestShouldSeed(t *testing.T) {
	cases := []struct {
		name         string
		libraryEmpty bool
		state        State
		want         bool
	}{
		{"empty library, enabled, never seeded", true, State{Enabled: true}, true},
		{"library has content", false, State{Enabled: true}, false},
		{"user turned the offer off", true, State{Enabled: false}, false},
		{"already seeded before", true, State{Enabled: true, Seeded: true}, false},
		{"default state on an empty library", true, DefaultState(), true},
		{"disabled and seeded", true, State{Enabled: false, Seeded: true}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldSeed(tc.libraryEmpty, tc.state); got != tc.want {
				t.Fatalf("ShouldSeed = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestDefaultStateIsOptOut(t *testing.T) {
	state := DefaultState()
	if !state.Enabled {
		t.Fatal("a fresh install should offer the starter library")
	}
	if state.Seeded {
		t.Fatal("a fresh install has not seeded yet")
	}
}

func TestParseState(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want State
	}{
		{"empty falls back to the default", "", DefaultState()},
		{"corrupt json falls back", "{not json", DefaultState()},
		{"json array falls back", "[]", DefaultState()},
		{"unknown fields are ignored", `{"enabled":false,"extra":1}`, State{Enabled: false}},
		{"explicit value wins", `{"enabled":true,"seeded":true}`, State{Enabled: true, Seeded: true}},
		{"disabled", `{"enabled":false,"seeded":false}`, State{Enabled: false}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ParseState(tc.raw); got != tc.want {
				t.Fatalf("ParseState(%q) = %+v, want %+v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestSerializeStateRoundTripsWithinThePreferenceLimit(t *testing.T) {
	for _, state := range []State{DefaultState(), {Enabled: false, Seeded: true}} {
		encoded, err := SerializeState(state)
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) > 256 {
			t.Fatalf("encoded state is %d bytes, over the preference limit", len(encoded))
		}
		if got := ParseState(encoded); got != state {
			t.Fatalf("round trip = %+v, want %+v", got, state)
		}
	}
}

func TestCatalogIsWellFormed(t *testing.T) {
	if len(Catalog) == 0 {
		t.Fatal("the starter library is empty")
	}
	seen := map[string]bool{}
	for _, material := range Catalog {
		if material.ID == "" || material.Title == "" {
			t.Fatalf("incomplete catalog entry: %+v", material)
		}
		if seen[material.ID] {
			t.Fatalf("duplicate catalog id %q", material.ID)
		}
		seen[material.ID] = true
		if material.Filename == "" || material.PageText == "" {
			t.Fatalf("%s is missing its bundled files", material.ID)
		}
		if !strings.HasSuffix(material.Filename, ".pdf") {
			t.Fatalf("%s filename is not a PDF", material.ID)
		}
		if !strings.HasSuffix(material.PageText, ".pages.json") {
			t.Fatalf("%s page text is not a JSON file", material.ID)
		}
		if material.Source == "" {
			t.Fatalf("%s has no source attribution", material.ID)
		}
	}
}

func TestByID(t *testing.T) {
	first := Catalog[0]
	if got, ok := ByID(first.ID); !ok || got.Title != first.Title {
		t.Fatalf("ByID(%q) = %+v, %v", first.ID, got, ok)
	}
	if _, ok := ByID("missing"); ok {
		t.Fatal("ByID accepted an unknown id")
	}
}

func TestIsSeeded(t *testing.T) {
	ids := []string{"pdf:a", "pdf:b"}
	cases := []struct {
		name string
		ids  []string
		have map[string]bool
		want bool
	}{
		{"all present", ids, map[string]bool{"pdf:a": true, "pdf:b": true}, true},
		{"one missing", ids, map[string]bool{"pdf:a": true}, false},
		{"none present", ids, map[string]bool{}, false},
		{"empty catalog is not seeded", nil, map[string]bool{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsSeeded(tc.ids, tc.have); got != tc.want {
				t.Fatalf("IsSeeded = %v, want %v", got, tc.want)
			}
		})
	}
}
