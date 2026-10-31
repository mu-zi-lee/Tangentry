package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/egoist/mygo"
)

type fixturePlatformWindow struct {
	closed  atomic.Int32
	active  atomic.Int32
	cleaned atomic.Int32
	eval    func(context.Context, string) (any, error)
	load    func(string) error
	onClose func()
}

func (w *fixturePlatformWindow) Page() *mygo.Page { return nil }
func (w *fixturePlatformWindow) LoadURL(url string) error {
	if w.load != nil {
		return w.load(url)
	}
	return nil
}
func (w *fixturePlatformWindow) IsDestroyed() bool { return w.closed.Load() != 0 }
func (w *fixturePlatformWindow) Close() {
	w.closed.Add(1)
	if w.onClose != nil {
		w.onClose()
	}
}
func (w *fixturePlatformWindow) EvalContext(ctx context.Context, script string) (any, error) {
	if script == platformMediaBeginScript {
		w.active.Add(1)
	} else {
		w.cleaned.Add(1)
	}
	if w.eval != nil {
		return w.eval(ctx, script)
	}
	return true, ctx.Err()
}

func fixturePlatformBridge() (*platformPageBridge, *fixturePlatformWindow) {
	b, window := newPlatformPageBridge(), &fixturePlatformWindow{}
	b.createWindow = func(session *platformPageSession) (platformSessionWindow, error) {
		close(session.ready)
		return window, nil
	}
	return b, window
}

func mustAcquirePlatform(t *testing.T, b *platformPageBridge, ctx context.Context) *platformPageLease {
	t.Helper()
	lease, err := b.acquire(ctx, "test", "https://fixture.invalid/")
	if err != nil {
		t.Fatal(err)
	}
	return lease
}

func TestPlatformSessionIdleRenewsFullInterval(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		first := mustAcquirePlatform(t, b, context.Background())
		first.release()
		time.Sleep(44 * time.Second)
		second := mustAcquirePlatform(t, b, context.Background())
		time.Sleep(2 * time.Minute)
		if window.IsDestroyed() {
			t.Fatal("active session reclaimed")
		}
		second.release()
		time.Sleep(44 * time.Second)
		if window.IsDestroyed() {
			t.Fatal("session did not receive full idle interval")
		}
		time.Sleep(time.Second)
		synctest.Wait()
		if window.closed.Load() != 1 || len(b.sessions) != 0 {
			t.Fatal("idle session was not removed and closed exactly once")
		}
	})
}

func TestPlatformSessionQueueCancellationAndShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		first := mustAcquirePlatform(t, b, context.Background())
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() {
			lease, err := b.acquire(ctx, "test", "fixture")
			if lease != nil {
				lease.release()
			}
			done <- err
		}()
		synctest.Wait()
		if first.session.users != 2 {
			t.Fatal("queued request did not reserve session")
		}
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("queue cancellation = %v", err)
		}
		if first.session.users != 1 || window.active.Load() != 1 {
			t.Fatal("canceled queue entered operation or leaked reservation")
		}
		window.onClose = func() { b.mu.Lock(); defer b.mu.Unlock() }
		b.Close()
		b.Close()
		synctest.Wait()
		if first.ctx.Err() == nil || window.closed.Load() != 1 {
			t.Fatal("shutdown did not cancel active request or closed twice")
		}
		first.release()
		if window.cleaned.Load() != 0 || first.session.closeAt != nil {
			t.Fatal("shutdown evaluated JavaScript or restarted timer")
		}
		if _, err := b.acquire(context.Background(), "test", "fixture"); err == nil {
			t.Fatal("closed bridge accepted request")
		}
	})
}

func TestPlatformSessionQueuedRequestBlocksIdleTimer(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		first := mustAcquirePlatform(t, b, context.Background())
		done := make(chan *platformPageLease, 1)
		go func() { done <- mustAcquirePlatform(t, b, context.Background()) }()
		synctest.Wait()
		first.release()
		second := <-done
		time.Sleep(2 * platformFetchIdle)
		if window.IsDestroyed() || second.session.closeAt != nil {
			t.Fatal("queued/active session armed idle timer")
		}
		if window.cleaned.Load() != 1 || window.active.Load() != 2 {
			t.Fatal("next operation ran without previous media cleanup")
		}
		second.release()
		time.Sleep(platformFetchIdle)
		synctest.Wait()
		if window.closed.Load() != 1 {
			t.Fatal("final lease did not schedule reclamation")
		}
	})
}

func TestPlatformSessionReleaseAfterSuccessFailureCancelAndTimeout(t *testing.T) {
	for _, outcome := range []string{"success", "failure", "cancel", "timeout"} {
		t.Run(outcome, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				b, window := fixturePlatformBridge()
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				lease := mustAcquirePlatform(t, b, ctx)
				switch outcome {
				case "cancel":
					cancel()
				case "timeout":
					time.Sleep(time.Second)
				case "failure":
					window.eval = func(context.Context, string) (any, error) { return nil, errors.New("fixture JavaScript failure") }
				}
				lease.release()
				lease.release()
				if window.cleaned.Load() != 1 || lease.session.users != 0 {
					t.Fatal("exit path did not clean and release exactly once")
				}
				time.Sleep(platformFetchIdle)
				synctest.Wait()
				if window.closed.Load() != 1 {
					t.Fatal("exit path leaked idle window")
				}
			})
		})
	}
}

func TestPlatformSessionCleanupHasIndependentBoundedContext(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		ctx, cancel := context.WithCancel(context.Background())
		lease := mustAcquirePlatform(t, b, ctx)
		cancel()
		window.eval = func(ctx context.Context, _ string) (any, error) {
			if ctx.Err() != nil {
				t.Fatal("cleanup inherited canceled request")
			}
			<-ctx.Done()
			return nil, ctx.Err()
		}
		started := time.Now()
		lease.release()
		if time.Since(started) != time.Second {
			t.Fatal("cleanup timeout is not bounded to one second")
		}
		b.Close()
	})
}

func TestPlatformSessionStaleTimerAndOldWindowCannotRemoveReplacement(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, oldWindow := fixturePlatformBridge()
		first := mustAcquirePlatform(t, b, context.Background())
		first.release()
		generation := first.session.closeGeneration
		second := mustAcquirePlatform(t, b, context.Background())
		first.session.closeIdle(generation)
		if oldWindow.IsDestroyed() {
			t.Fatal("stale timer closed live session")
		}
		second.release()
		b.mu.Lock()
		first.session.retireLocked()
		b.mu.Unlock()
		newWindow := &fixturePlatformWindow{}
		b.createWindow = func(s *platformPageSession) (platformSessionWindow, error) { close(s.ready); return newWindow, nil }
		third := mustAcquirePlatform(t, b, context.Background())
		b.mu.Lock()
		first.session.retireLocked()
		b.mu.Unlock()
		first.session.closeIdle(first.session.closeGeneration)
		if b.sessions["test"] != third.session || newWindow.IsDestroyed() {
			t.Fatal("old session removed replacement")
		}
		third.release()
		b.Close()
		first.session.destroyWindow(oldWindow)
	})
}

func TestPlatformSessionCloseDuringCreation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		started, resume := make(chan struct{}), make(chan struct{})
		b.createWindow = func(s *platformPageSession) (platformSessionWindow, error) {
			close(started)
			<-resume
			close(s.ready)
			return window, nil
		}
		done := make(chan error, 1)
		go func() { _, err := b.acquire(context.Background(), "test", "fixture"); done <- err }()
		<-started
		b.Close()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("creation cancellation = %v", err)
		}
		close(resume)
		synctest.Wait()
		if window.closed.Load() != 1 || len(b.sessions) != 0 {
			t.Fatal("late creation leaked window or reinserted session")
		}
	})
}

func TestPlatformSessionCreationFailureReleasesAndRetries(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		failure := errors.New("fixture creation failure")
		b.createWindow = func(*platformPageSession) (platformSessionWindow, error) { return window, failure }
		if _, err := b.acquire(context.Background(), "test", "fixture"); !errors.Is(err, failure) {
			t.Fatal(err)
		}
		synctest.Wait()
		if len(b.sessions) != 0 || window.closed.Load() != 1 {
			t.Fatal("failed creation was retained")
		}
		b.Close()
	})
}

func TestPlatformSessionCloseDuringInitialLoad(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		started, resume := make(chan struct{}), make(chan struct{})
		window.load = func(string) error { close(started); <-resume; return nil }
		done := make(chan error, 1)
		go func() { _, err := b.acquire(context.Background(), "test", "fixture"); done <- err }()
		<-started
		b.Close()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("initial load cancellation = %v", err)
		}
		close(resume)
		synctest.Wait()
		if window.closed.Load() != 1 || len(b.sessions) != 0 {
			t.Fatal("initial load reinserted or leaked closing window")
		}
	})
}

func TestPlatformSessionFailedCleanupCancelsQueuedRequests(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b, window := fixturePlatformBridge()
		first := mustAcquirePlatform(t, b, context.Background())
		done := make(chan error, 1)
		go func() {
			lease, err := b.acquire(context.Background(), "test", "fixture")
			if lease != nil {
				lease.release()
			}
			done <- err
		}()
		synctest.Wait()
		window.eval = func(context.Context, string) (any, error) { return nil, errors.New("fixture cleanup failure") }
		first.release()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("queue after failed cleanup = %v", err)
		}
		if window.active.Load() != 1 || window.closed.Load() != 1 {
			t.Fatal("dirty session reused after failed cleanup")
		}
	})
}
