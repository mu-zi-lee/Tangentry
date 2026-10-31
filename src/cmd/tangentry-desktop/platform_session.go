package main

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

type platformPageLease struct {
	session     *platformPageSession
	ctx         context.Context
	cancel      context.CancelFunc
	stop        func() bool
	reused      bool
	locked      bool
	initialized bool
	once        sync.Once
}

// Reserve before waiting for creation or the operation slot. Queued requests
// keep the session alive, but neither creation nor native calls hold b.mu.
func (b *platformPageBridge) acquire(ctx context.Context, platform, origin string) (*platformPageLease, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil, errors.New("平台页面桥已关闭")
	}
	session := b.sessions[platform]
	reused := session != nil && !session.closing
	if !reused {
		life, cancel := context.WithCancel(context.Background())
		session = &platformPageSession{bridge: b, platform: platform, origin: origin, ctx: life, cancel: cancel, initialized: make(chan struct{}), operation: make(chan struct{}, 1), ready: make(chan struct{})}
		session.blockedNavigation.Store("")
		b.sessions[platform] = session
	}
	session.users++
	session.stopTimerLocked()
	b.mu.Unlock()
	if !reused {
		go session.initialize()
	}
	requestCtx, cancel := context.WithCancel(ctx)
	lease := &platformPageLease{session: session, ctx: requestCtx, cancel: cancel, reused: reused}
	lease.stop = context.AfterFunc(session.ctx, cancel)
	if err := lease.start(); err != nil {
		lease.release()
		return nil, err
	}
	return lease, nil
}

func (session *platformPageSession) initialize() {
	b := session.bridge
	create := b.createWindow
	if create == nil {
		create = createPlatformPageWindow
	}
	var window platformSessionWindow
	err := session.ctx.Err()
	if err == nil {
		window, err = create(session)
	}
	b.mu.Lock()
	session.window = window
	closing := session.closing
	b.mu.Unlock()
	if err == nil && !closing && window != nil {
		err = window.LoadURL(session.origin)
	}
	b.mu.Lock()
	if closing || session.closing {
		err = context.Canceled
	}
	if err != nil || window == nil {
		if err == nil {
			err = errors.New("平台请求窗口创建失败")
		}
		session.retireLocked()
	}
	session.initErr = err
	close(session.initialized)
	b.mu.Unlock()
	if err != nil {
		session.destroyWindow(window)
	}
}

func (lease *platformPageLease) start() error {
	session := lease.session
	select {
	case <-session.initialized:
	case <-lease.ctx.Done():
		return lease.ctx.Err()
	}
	if session.initErr != nil {
		return session.initErr
	}
	select {
	case session.operation <- struct{}{}:
		lease.locked = true
	case <-lease.ctx.Done():
		return lease.ctx.Err()
	}
	if err := lease.ctx.Err(); err != nil {
		return err
	}
	if err := session.ctx.Err(); err != nil {
		return err
	}
	lease.initialized = true
	if err := waitPlatformPage(lease.ctx, session.ready); err != nil {
		return err
	}
	return session.setMediaActive(lease.ctx, true)
}

func (session *platformPageSession) setMediaActive(ctx context.Context, active bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := session.ctx.Err(); err != nil {
		return err
	}
	if session.window == nil || session.window.IsDestroyed() {
		return context.Canceled
	}
	script := platformMediaCleanupScript
	if active {
		script = platformMediaBeginScript
	}
	_, err := evalWithRetry(ctx, session.window.EvalContext, script)
	return err
}

func (lease *platformPageLease) release() {
	lease.once.Do(func() {
		session, b := lease.session, lease.session.bridge
		var cleanupErr error
		// Keep serialization through cleanup. Cancellation of the original
		// request does not skip cleanup; bridge shutdown still cancels it.
		if lease.initialized {
			cleanupCtx, cancel := context.WithTimeout(session.ctx, time.Second)
			if cleanupCtx.Err() == nil {
				if cleanupErr = session.setMediaActive(cleanupCtx, false); cleanupErr != nil {
					slog.Debug("平台请求页面媒体清理失败", "platform", session.platform, "error", cleanupErr)
				}
			}
			cancel()
		}
		if cleanupErr != nil {
			// A timed-out evaluation can still finish in WebKit. Do not let
			// its late cleanup race the next request on this same page.
			b.mu.Lock()
			session.retireLocked()
			b.mu.Unlock()
		}
		if lease.locked {
			<-session.operation
		}
		lease.stop()
		lease.cancel()
		b.mu.Lock()
		session.users--
		if session.users == 0 && !session.closing && b.sessions[session.platform] == session {
			session.lastUsed = time.Now()
			session.armCloseLocked(platformFetchIdle)
		}
		b.mu.Unlock()
		if cleanupErr != nil {
			session.destroyWindow(session.window)
		}
	})
}

// All metadata and timer transitions are protected exclusively by bridge.mu.
func (session *platformPageSession) stopTimerLocked() {
	if session.closeAt != nil {
		session.closeAt.Stop()
		session.closeAt = nil
	}
	session.closeGeneration++
}

func (session *platformPageSession) armCloseLocked(delay time.Duration) {
	session.stopTimerLocked()
	generation := session.closeGeneration
	session.closeAt = time.AfterFunc(delay, func() { session.closeIdle(generation) })
}

func (session *platformPageSession) closeIdle(generation uint64) {
	b := session.bridge
	b.mu.Lock()
	if session.closing || b.sessions[session.platform] != session || session.users != 0 || session.closeGeneration != generation {
		b.mu.Unlock()
		return
	}
	if remaining := platformFetchIdle - time.Since(session.lastUsed); remaining > 0 {
		session.armCloseLocked(remaining)
		b.mu.Unlock()
		return
	}
	session.retireLocked()
	window := session.window
	b.mu.Unlock()
	slog.Info("平台请求窗口空闲回收", "platform", session.platform, "idle", platformFetchIdle)
	session.destroyWindow(window)
}

func (session *platformPageSession) retireLocked() {
	session.stopTimerLocked()
	session.closing = true
	session.cancel()
	if session.bridge.sessions[session.platform] == session {
		delete(session.bridge.sessions, session.platform)
	}
}

func (session *platformPageSession) destroyWindow(window platformSessionWindow) {
	if window != nil && session.destroyed.CompareAndSwap(false, true) && !window.IsDestroyed() {
		window.Close()
	}
}

func (b *platformPageBridge) Close() {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	type pendingClose struct {
		session *platformPageSession
		window  platformSessionWindow
	}
	windows := make([]pendingClose, 0, len(b.sessions))
	for _, session := range b.sessions {
		session.retireLocked()
		windows = append(windows, pendingClose{session, session.window})
	}
	b.mu.Unlock()
	// This may run on the UI thread: never wait for an operation or evaluate JS.
	for _, item := range windows {
		item.session.destroyWindow(item.window)
	}
}
