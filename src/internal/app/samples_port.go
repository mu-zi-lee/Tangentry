package app

import (
	"context"
	"log/slog"
	"time"
)

// SeedSamples loads the bundled starter library when the library is empty and
// the user has not turned the offer off. Entry points call it after New and
// before serving; it never fails startup, because a seeding problem must not
// prevent the app from running.
func (a *Application) SeedSamples() {
	if a == nil || a.samples == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := a.samples.AutoLoad(ctx); err != nil {
		slog.Warn("Bundled sample library was not seeded", "error", err)
	}
}
