// Package samples embeds the bundled starter documents so a fresh install can
// read and retrieve immediately, without network access.
//
// The PDFs remain the property of their publishers (see assets/NOTICE.md); they
// are shipped for local reading and research and are not relicensed under the
// project's MIT license.
package samples

import (
	"embed"
	"encoding/json"
	"fmt"

	"tangentry/internal/samples"
)

//go:embed assets/*.pdf assets/*.pages.json
var bundle embed.FS

// Bundle implements samples.Assets over the embedded files.
type Bundle struct{}

// PDF returns the bytes of a bundled document.
func (Bundle) PDF(name string) ([]byte, error) {
	if name == "" {
		return nil, fmt.Errorf("samples: empty document name")
	}
	data, err := bundle.ReadFile("assets/" + name)
	if err != nil {
		return nil, fmt.Errorf("samples: read %s: %w", name, err)
	}
	return data, nil
}

// PageText returns the bundled page text and its recorded provenance.
func (Bundle) PageText(name string) (samples.PageTextFile, error) {
	if name == "" {
		return samples.PageTextFile{}, fmt.Errorf("samples: empty page-text name")
	}
	data, err := bundle.ReadFile("assets/" + name)
	if err != nil {
		return samples.PageTextFile{}, fmt.Errorf("samples: read %s: %w", name, err)
	}
	var file samples.PageTextFile
	if err := json.Unmarshal(data, &file); err != nil {
		return samples.PageTextFile{}, fmt.Errorf("samples: decode %s: %w", name, err)
	}
	return file, nil
}

var _ samples.Assets = Bundle{}
