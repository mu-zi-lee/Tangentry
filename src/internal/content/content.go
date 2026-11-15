// Package content owns the saved content library, independent of platforms and UI.
package content

import (
	"context"
	"errors"
	"strings"
	"time"
)

var ErrInvalid = errors.New("invalid content")
var ErrNotFound = errors.New("content not found")

type Repository interface {
	List(context.Context) ([]Item, error)
	// Page lists matching saved items as cards, newest first.
	Page(context.Context, Query) (Page, error)
	Get(context.Context, string) (Item, error)
	Save(context.Context, Item) (Item, error)
	Delete(context.Context, string) error
}

type Service struct {
	repository Repository
	savedHook  func(context.Context, Item)
}

func NewService(repository Repository) *Service { return &Service{repository: repository} }

// SetSavedHook connects an optional observer invoked after each successful
// save, at the composition root before serving (e.g. PDF text extraction).
// The hook never fails the save itself.
func (s *Service) SetSavedHook(hook func(context.Context, Item)) { s.savedHook = hook }

func (s *Service) List(ctx context.Context) ([]Item, error) { return s.repository.List(ctx) }

func (s *Service) Page(ctx context.Context, q Query) (Page, error) {
	q.Q = strings.TrimSpace(q.Q)
	if !ValidQuery(q) {
		return Page{}, ErrInvalid
	}
	return s.repository.Page(ctx, q)
}

// Get reads one saved item; ErrNotFound when it is not in the library.
func (s *Service) Get(ctx context.Context, id string) (Item, error) { return s.repository.Get(ctx, id) }

func (s *Service) Save(ctx context.Context, item Item) (Item, error) {
	item.PreviewText = ""
	if item.Partial {
		return Item{}, ErrInvalid
	}
	if err := Validate(item); err != nil {
		return Item{}, err
	}
	item.SavedAt = time.Now().Unix()
	saved, err := s.repository.Save(ctx, item)
	if err == nil && s.savedHook != nil {
		s.savedHook(ctx, saved)
	}
	return saved, err
}

func (s *Service) Delete(ctx context.Context, id string) error {
	if id == "" {
		return ErrInvalid
	}
	return s.repository.Delete(ctx, id)
}
