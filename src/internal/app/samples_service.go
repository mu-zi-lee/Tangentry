// Bundled starter library: seeds a few public documents so a user with an empty
// library can read and try question-relevant retrieval immediately.
//
// Seeding writes the per-page text BEFORE saving the library item: the saved
// hook runs synchronously and reuses stored pages whose document hash matches,
// so a native extraction can never overwrite baked OCR text with mojibake.

package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"tangentry/internal/adapters/filesystem"
	"tangentry/internal/adapters/sqlite"
	"tangentry/internal/content"
	"tangentry/internal/preferences"
	"tangentry/internal/retrieval"
	"tangentry/internal/samples"
)

type samplesService struct {
	assets samples.Assets
	store  *sqlite.Store
	docs   *filesystem.Documents
	prefs  preferences.Store
	mu     sync.Mutex
}

func newSamplesService(assets samples.Assets, store *sqlite.Store, docs *filesystem.Documents, prefs preferences.Store) *samplesService {
	return &samplesService{assets: assets, store: store, docs: docs, prefs: prefs}
}

func (s *samplesService) state(ctx context.Context) samples.State {
	if s.prefs == nil {
		return samples.DefaultState()
	}
	raw, _, err := s.prefs.Get(ctx, preferences.SamplesKey)
	if err != nil {
		return samples.DefaultState()
	}
	return samples.ParseState(raw)
}

func (s *samplesService) saveState(ctx context.Context, state samples.State) error {
	if s.prefs == nil {
		return nil
	}
	encoded, err := samples.SerializeState(state)
	if err != nil {
		return err
	}
	return s.prefs.Set(ctx, preferences.SamplesKey, encoded)
}

// ids derives the library ID of every bundled document from its bytes, matching
// the content-addressed ID the document importer assigns.
func (s *samplesService) ids() (map[string]string, error) {
	out := make(map[string]string, len(samples.Catalog))
	for _, material := range samples.Catalog {
		data, err := s.assets.PDF(material.Filename)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(data)
		out[material.ID] = "pdf:" + hex.EncodeToString(sum[:])
	}
	return out, nil
}

// Status reports the preference, whether every sample is present, and per-item
// presence so the UI can explain what is missing.
func (s *samplesService) Status(ctx context.Context) (samples.Status, error) {
	ids, err := s.ids()
	if err != nil {
		return samples.Status{}, err
	}
	state := s.state(ctx)
	status := samples.Status{Enabled: state.Enabled, Items: make([]samples.Item, 0, len(samples.Catalog))}
	present := 0
	for _, material := range samples.Catalog {
		id := ids[material.ID]
		_, err := s.store.Get(ctx, id)
		exists := err == nil
		if exists {
			present++
		}
		status.Items = append(status.Items, samples.Item{
			ID: id, Title: material.Title, Source: material.Source, Note: material.Note, Present: exists,
		})
	}
	status.Seeded = present == len(samples.Catalog)
	return status, nil
}

// SetEnabled toggles automatic seeding on an empty library.
func (s *samplesService) SetEnabled(ctx context.Context, enabled bool) (samples.Status, error) {
	s.mu.Lock()
	state := s.state(ctx)
	state.Enabled = enabled
	err := s.saveState(ctx, state)
	s.mu.Unlock()
	if err != nil {
		return samples.Status{}, err
	}
	return s.Status(ctx)
}

// Load imports every bundled document that is not already present.
func (s *samplesService) Load(ctx context.Context) (samples.Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.seed(ctx); err != nil {
		return samples.Status{}, err
	}
	state := s.state(ctx)
	state.Seeded = true
	_ = s.saveState(ctx, state)
	return s.Status(ctx)
}

// Remove deletes the bundled documents from the library and marks seeding as
// done, so an explicit removal is never undone by the automatic pass.
func (s *samplesService) Remove(ctx context.Context) (samples.Status, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids, err := s.ids()
	if err != nil {
		return samples.Status{}, err
	}
	for _, material := range samples.Catalog {
		id := ids[material.ID]
		if err := s.store.Delete(ctx, id); err != nil && !errors.Is(err, content.ErrNotFound) {
			return samples.Status{}, err
		}
	}
	state := s.state(ctx)
	state.Seeded = true
	if err := s.saveState(ctx, state); err != nil {
		return samples.Status{}, err
	}
	return s.Status(ctx)
}

// AutoLoad seeds once when the library is empty and the preference is enabled.
func (s *samplesService) AutoLoad(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.state(ctx)
	if !state.Enabled || state.Seeded {
		return nil
	}
	items, err := s.store.List(ctx)
	if err != nil {
		return err
	}
	if !samples.ShouldSeed(len(items) == 0, state) {
		return nil
	}
	if err := s.seed(ctx); err != nil {
		return err
	}
	state.Seeded = true
	return s.saveState(ctx, state)
}

// seed writes page text first, then the library item, for every missing sample.
// A single bad bundle entry is logged and skipped so the others still load.
func (s *samplesService) seed(ctx context.Context) error {
	ids, err := s.ids()
	if err != nil {
		return err
	}
	var failures []error
	for _, material := range samples.Catalog {
		id := ids[material.ID]
		if _, err := s.store.Get(ctx, id); err == nil {
			continue
		} else if !errors.Is(err, content.ErrNotFound) {
			return err
		}
		if err := s.seedOne(ctx, material, id); err != nil {
			slog.Warn("Bundled sample could not be seeded", "sample", material.ID, "error", err)
			failures = append(failures, fmt.Errorf("%s: %w", material.ID, err))
			continue
		}
		slog.Info("Seeded sample document", "contentId", id, "title", material.Title)
	}
	return errors.Join(failures...)
}

func (s *samplesService) seedOne(ctx context.Context, material samples.Material, id string) error {
	data, err := s.assets.PDF(material.Filename)
	if err != nil {
		return err
	}
	pageText, err := s.assets.PageText(material.PageText)
	if err != nil {
		return err
	}
	if pageText.DocumentSHA256 != id[len("pdf:"):] {
		return fmt.Errorf("bundled page text is for a different document")
	}
	if len(pageText.Pages) == 0 {
		return fmt.Errorf("bundled page text is empty")
	}
	doc := retrieval.PDFDocument{
		SHA256:    pageText.DocumentSHA256,
		PageCount: len(pageText.Pages),
		Pages:     make([]retrieval.Page, 0, len(pageText.Pages)),
	}
	for i, page := range pageText.Pages {
		if page.Page != i+1 {
			return fmt.Errorf("bundled page text is out of order at %d", i)
		}
		doc.Pages = append(doc.Pages, retrieval.Page{
			Number:           page.Page,
			Text:             page.Text,
			DocumentSHA256:   pageText.DocumentSHA256,
			Extractor:        pageText.Extractor,
			ExtractorVersion: pageText.ExtractorVersion,
		})
	}
	// content.Validate requires a host-bearing URL; documentGet rewrites the
	// "/library" suffix to the real document file URL at read time, exactly like
	// an upload through the HTTP API.
	item, err := s.docs.Import(ctx, bytes.NewReader(data), material.Title, "http://localhost/library")
	if err != nil {
		return err
	}
	if item.ID != id {
		return fmt.Errorf("imported id %s does not match the bundled bytes", item.ID)
	}
	// Before Save: the saved hook reuses stored pages with a matching hash.
	if err := s.store.SavePDFPages(ctx, item.ID, doc, time.Now().Unix()); err != nil {
		return err
	}
	_, err = s.store.Save(ctx, item)
	return err
}
