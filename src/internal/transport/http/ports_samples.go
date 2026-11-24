package httptransport

import (
	"context"

	"tangentry/internal/samples"
)

// SamplesService controls the bundled starter library: a few public documents
// seeded so a user with an empty library can read and try retrieval at once.
// Seeding is opt-out, runs at most once automatically, and removal is final
// until the user asks again.
type SamplesService interface {
	Status(ctx context.Context) (samples.Status, error)
	SetEnabled(ctx context.Context, enabled bool) (samples.Status, error)
	Load(ctx context.Context) (samples.Status, error)
	Remove(ctx context.Context) (samples.Status, error)
}
