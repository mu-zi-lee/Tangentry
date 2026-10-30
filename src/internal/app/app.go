// Package app is the composition root; feature modules do not import it.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"tangentry/internal/agent"
	"tangentry/internal/agent/gateway"
	"tangentry/internal/ai"
	"tangentry/internal/backup"
	"tangentry/internal/config"
	"tangentry/internal/credentials"
	"tangentry/internal/discovery"
	"tangentry/internal/downloads"
	"tangentry/internal/favoritesync"
	"tangentry/internal/platformfetch"
	"tangentry/internal/playback"
	"tangentry/internal/transcription"
)

type Application struct {
	runtime       *runtimeState
	shell         *shellState
	subscriptions subscriptionManager
	dataDir       string
	assets        fs.FS
	option        Options
	agent         *agent.Service
	agentGateway  *gateway.Gateway
	mu            sync.Mutex
	agentMu       sync.Mutex
}

// PlatformPageFetcher is the native-shell port for same-origin requests in a
// platform WebView. The underlying interface lives in the dependency-neutral
// platformfetch package so adapters can consume it without importing app.
type PlatformPageFetcher = platformfetch.Fetcher
type PlatformPageRequest = platformfetch.Request
type PlatformPageResponse = platformfetch.Response

// Options replaces external platform I/O. Test fixtures are outside product code.
type Options struct {
	AITranslator        ai.Translator
	AISummarizer        ai.Summarizer
	FavoritesRemote     favoritesync.Remote
	TranscriptionEngine transcription.Engine
	Playback            func(context.Context, string) (playback.Source, error)
	BilibiliAudio       func(context.Context, string) (transcription.Audio, error)
	Recommendations     func(context.Context, string) (discovery.Feed, error)
	Platform            discovery.Provider
	PublicHTTP          *http.Client
	AudioHTTP           *http.Client
	// PlatformPageFetcher lets a native shell execute same-origin requests in
	// the platform's authenticated WebView. A nil value keeps headless/server
	// builds on their existing HTTP clients.
	PlatformPageFetcher platformfetch.Fetcher
	// CredentialKey is supplied by a native shell from its system credential
	// store. A nil key keeps headless/server storage compatible with older data.
	CredentialKey []byte
}

// closers releases services in reverse start order.
type closers []func() error

func (c *closers) add(close func()) {
	*c = append(*c, func() error { close(); return nil })
}

func (c *closers) addErr(close func() error) { *c = append(*c, close) }

func (c closers) close() error {
	var err error
	for i := len(c) - 1; i >= 0; i-- {
		err = errors.Join(err, c[i]())
	}
	return err
}

func New(dataDir string, assets fs.FS, options ...Options) (application *Application, err error) {
	var option Options
	if len(options) > 0 {
		option = options[0]
	}
	configuration, err := config.Load(dataDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	if err := backup.ApplyPendingRestore(dataDir); err != nil {
		return nil, err
	}
	services, started, err := newServices(dataDir, configuration, option)
	if err != nil {
		return nil, err
	}
	runtime := &runtimeState{
		handler:       newHTTPHandler(newHTTPWiring(services), assets),
		downloads:     services.features.downloads,
		transcription: services.features.transcription,
		cookies:       services.runtime.cookies,
		closers:       started,
	}
	shell := &shellState{
		downloads: services.features.downloads,
		models: &modelDirectoryState{
			modelDownloads: services.features.modelDownloads,
			transcription:  services.features.transcription,
			modelDir:       services.features.modelDir,
		},
	}
	application = &Application{
		runtime:       runtime,
		shell:         shell,
		subscriptions: services.features.sources,
		agent:         agent.New(newAgentProvider(services), services.runtime.store),
		dataDir:       dataDir, assets: assets, option: option,
	}
	runtime.handler = agentSettingsHandler(application, runtime.handler)
	if err := application.startConfiguredAgentGateway(); err != nil {
		_ = application.Close()
		return nil, err
	}
	return application, nil
}

func agentSettingsHandler(application *Application, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/settings/agent" {
			next.ServeHTTP(w, r)
			return
		}
		if !agentSettingsRequestAllowed(r) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		switch r.Method {
		case http.MethodGet:
			settings, status, err := application.AgentIntegration(r.Context())
			if err != nil {
				http.Error(w, err.Error(), http.StatusServiceUnavailable)
				return
			}
			activity, err := application.agent.Activity(r.Context(), 12)
			if err != nil {
				http.Error(w, "could not read Agent activity", http.StatusServiceUnavailable)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"settings": settings, "status": status, "activity": activity})
		case http.MethodPut:
			r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			var settings agent.IntegrationSettings
			if err := decoder.Decode(&settings); err != nil || decoder.Decode(new(any)) != io.EOF {
				http.Error(w, "invalid JSON", http.StatusBadRequest)
				return
			}
			status, err := application.ConfigureAgentIntegration(r.Context(), settings)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			effective, _, _ := application.AgentIntegration(r.Context())
			activity, _ := application.agent.Activity(r.Context(), 12)
			_ = json.NewEncoder(w).Encode(map[string]any{"settings": effective, "status": status, "activity": activity})
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}

func agentSettingsRequestAllowed(r *http.Request) bool {
	host := r.Host
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	} else if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return false
	}
	parsedIP := net.ParseIP(strings.Trim(host, "[]"))
	if host != "localhost" && (parsedIP == nil || !parsedIP.IsLoopback()) {
		return false
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == r.Host && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == ""
}

type runtimeState struct {
	handler       http.Handler
	downloads     *downloads.Service
	transcription *transcription.Service
	cookies       *credentials.Store
	closers       closers
	closeOnce     sync.Once
	closeErr      error
}

func (r *runtimeState) HTTPHandler() http.Handler { return r.handler }

func (r *runtimeState) Close() error {
	r.closeOnce.Do(func() { r.closeErr = r.closers.close() })
	return r.closeErr
}

func (a *Application) HTTPHandler() http.Handler {
	a.mu.Lock()
	runtime := a.runtime
	a.mu.Unlock()
	return runtime.HTTPHandler()
}

func (a *Application) Close() error {
	if a == nil {
		return nil
	}
	a.agentMu.Lock()
	defer a.agentMu.Unlock()
	a.mu.Lock()
	gatewayInstance := a.agentGateway
	a.agentGateway = nil
	a.mu.Unlock()
	if gatewayInstance != nil {
		_ = gatewayInstance.Close()
	}
	if a.agent != nil {
		a.agent.Close()
	}
	return a.runtime.Close()
}
