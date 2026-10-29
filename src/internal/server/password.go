package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	sessionCookie   = "tangentry-session"
	sessionLifetime = 30 * 24 * time.Hour
	maxSessions     = 256
	failedLoginWait = time.Second
)

// LoadPassword returns the configured password, or the one stored in the data
// directory, creating it on first run. generated reports a new password, which
// the caller shows once so the owner can sign in.
func LoadPassword(dataDir, configured string) (password string, generated bool, err error) {
	if configured != "" {
		return configured, false, nil
	}
	filename := filepath.Join(dataDir, "admin-password")
	if data, err := os.ReadFile(filename); err == nil {
		if password := strings.TrimSpace(string(data)); password != "" {
			return password, false, nil
		}
		return "", false, errors.New(filename + " is empty; remove it to generate a new password")
	} else if !os.IsNotExist(err) {
		return "", false, err
	}
	password = rand.Text()
	file, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", false, err
	}
	if _, err := file.WriteString(password + "\n"); err != nil {
		file.Close()
		return "", false, err
	}
	return password, true, file.Close()
}

// PasswordGate admits browsers that signed in with the server password. It is
// the headless server's counterpart of the desktop loopback session.
type PasswordGate struct {
	next     http.Handler
	password [sha256.Size]byte
	now      func() time.Time
	mu       sync.Mutex
	sessions map[string]time.Time
	// failures serializes rejected sign-ins, limiting guesses to one a second.
	failures sync.Mutex
}

func NewPasswordGate(next http.Handler, password string) *PasswordGate {
	return &PasswordGate{next: next, password: sha256.Sum256([]byte(password)), now: time.Now, sessions: make(map[string]time.Time)}
}

// NewLocalDevelopmentHandler serves a deliberately loopback-only development
// server without a sign-in page while retaining same-origin protection.
func NewLocalDevelopmentHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(r) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/healthz" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		forward(next, w, r)
	})
}

func (g *PasswordGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	switch {
	case r.URL.Path == "/healthz" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Path == "/login" && r.Method == http.MethodPost:
		g.login(w, r)
	case g.authenticated(r):
		forward(g.next, w, r)
	case strings.HasPrefix(r.URL.Path, "/api/"):
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"unauthorized","message":"登录已失效，请刷新页面后重新登录。"}` + "\n"))
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		loginPage(w, http.StatusOK, "")
	default:
		http.Error(w, "sign in required", http.StatusUnauthorized)
	}
}

func (g *PasswordGate) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	expires, ok := g.sessions[cookie.Value]
	if ok && g.now().After(expires) {
		delete(g.sessions, cookie.Value)
		return false
	}
	return ok
}

func (g *PasswordGate) login(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	attempt := sha256.Sum256([]byte(r.PostFormValue("password")))
	if subtle.ConstantTimeCompare(attempt[:], g.password[:]) != 1 {
		g.failures.Lock()
		time.Sleep(failedLoginWait)
		g.failures.Unlock()
		loginPage(w, http.StatusUnauthorized, "密码不正确。")
		return
	}
	token := rand.Text()
	now := g.now()
	g.mu.Lock()
	for existing, expires := range g.sessions {
		if now.After(expires) || len(g.sessions) >= maxSessions {
			delete(g.sessions, existing)
		}
	}
	g.sessions[token] = now.Add(sessionLifetime)
	g.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", MaxAge: int(sessionLifetime / time.Second),
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
	})
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 Tangentry</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f4;--panel:#fff;--text:#1c1917;--muted:#78716c;--line:#d6d3d1;--accent:#2563eb;--error:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#171717;--panel:#262626;--text:#f5f5f4;--muted:#a8a29e;--line:#404040;--accent:#60a5fa;--error:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:16px}
form{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 20px;color:var(--muted)}
label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{width:100%;margin-top:16px;padding:10px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
[role=alert]{color:var(--error);margin:12px 0 0}
</style></head><body>
<form method="post" action="/login"><h1>Tangentry</h1><p>输入服务器密码以继续。</p>
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
{{if .}}<p role="alert">{{.}}</p>{{end}}<button type="submit">登录</button></form>
</body></html>
`))

func loginPage(w http.ResponseWriter, status int, message string) {
	header := w.Header()
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	header.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
	header.Set("X-Frame-Options", "DENY")
	header.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = loginTemplate.Execute(w, message)
}
