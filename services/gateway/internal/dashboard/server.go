// Package dashboard provides the optional browser-facing gateway. Its upstream
// is either one AgentENV node or an existing cluster gateway.
package dashboard

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const cookieName = "aenv_dashboard_session"
const sessionLifetime = 8 * time.Hour
const maxBody = 4 << 20

type Options struct {
	Upstream     string
	AssetsDir    string
	PublicOrigin string
	APIKey       string
}

type session struct {
	expires time.Time
	ctx     context.Context
	cancel  context.CancelFunc
}

type Server struct {
	upstream     *url.URL
	assets       string
	origin       string
	secure       bool
	apiKey       string
	client       *http.Client
	streamClient *http.Client
	mu           sync.Mutex
	sessions     map[[32]byte]*session
	shells       sync.WaitGroup
	closed       bool
}

func New(options Options) (*Server, error) {
	upstream, err := parseOrigin(options.Upstream)
	if err != nil {
		return nil, fmt.Errorf("dashboard upstream: %w", err)
	}
	origin, err := parseOrigin(options.PublicOrigin)
	if err != nil {
		return nil, fmt.Errorf("dashboard public origin: %w", err)
	}
	if options.APIKey == "" {
		return nil, errors.New("dashboard requires an API key")
	}
	assets, err := filepath.Abs(options.AssetsDir)
	if err != nil {
		return nil, err
	}
	if stat, err := os.Stat(filepath.Join(assets, "index.html")); err != nil || !stat.Mode().IsRegular() {
		return nil, errors.New("dashboard assets_dir must contain a built index.html; run npm run build in web/")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 15 * time.Second
	transport.Proxy = nil // Runtime traffic must not pass through an environment HTTP proxy.
	noRedirect := func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &Server{
		upstream: upstream, assets: assets, origin: strings.TrimRight(origin.String(), "/"), secure: origin.Scheme == "https", apiKey: options.APIKey,
		client:       &http.Client{Transport: transport, Timeout: 5 * time.Minute, CheckRedirect: noRedirect},
		streamClient: &http.Client{Transport: transport, CheckRedirect: noRedirect},
		sessions:     make(map[[32]byte]*session),
	}, nil
}

func parseOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("must be an http(s) origin without credentials, path, query or fragment")
	}
	u.Path = ""
	return u, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if r.Header.Get("Origin") != s.origin {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
	}
	if r.URL.Path == "/dashboard/session" {
		s.handleSession(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/dashboard/") {
		current := s.authenticate(r)
		if current == nil {
			http.Error(w, "login required", http.StatusUnauthorized)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/dashboard/shell/") {
			s.handleShell(w, r, current)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/dashboard/api/") {
			s.handleAPI(w, r)
			return
		}
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	s.serveAsset(w, r)
}

func (s *Server) authenticate(r *http.Request) *session {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	key := sha256.Sum256([]byte(cookie.Value))
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.sessions[key]
	if current != nil && time.Now().Before(current.expires) {
		return current
	}
	if current != nil {
		current.cancel()
		delete(s.sessions, key)
	}
	return nil
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			APIKey string `json:"apiKey"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
			http.Error(w, "invalid login request", http.StatusBadRequest)
			return
		}
		supplied, expected := sha256.Sum256([]byte(body.APIKey)), sha256.Sum256([]byte(s.apiKey))
		if subtle.ConstantTimeCompare(supplied[:], expected[:]) != 1 {
			http.Error(w, "invalid API key", http.StatusUnauthorized)
			return
		}
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			http.Error(w, "could not create session", http.StatusInternalServerError)
			return
		}
		token := base64.RawURLEncoding.EncodeToString(random)
		key := sha256.Sum256([]byte(token))
		now := time.Now()
		s.mu.Lock()
		for id, old := range s.sessions {
			if !now.Before(old.expires) {
				old.cancel()
				delete(s.sessions, id)
			}
		}
		if s.closed {
			s.mu.Unlock()
			http.Error(w, "dashboard is stopping", http.StatusServiceUnavailable)
			return
		}
		if len(s.sessions) >= 128 {
			s.mu.Unlock()
			http.Error(w, "too many sessions", http.StatusTooManyRequests)
			return
		}
		// Logging in again rotates the current browser session.
		if old, err := r.Cookie(cookieName); err == nil {
			oldKey := sha256.Sum256([]byte(old.Value))
			if existing := s.sessions[oldKey]; existing != nil {
				existing.cancel()
				delete(s.sessions, oldKey)
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		current := &session{expires: now.Add(sessionLifetime), ctx: ctx, cancel: cancel}
		s.sessions[key] = current
		s.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/dashboard", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds())})
		writeJSON(w, map[string]any{"authenticated": true, "expiresAt": current.expires})
	case http.MethodGet:
		current := s.authenticate(r)
		if current == nil {
			http.Error(w, "login required", http.StatusUnauthorized)
			return
		}
		writeJSON(w, map[string]any{"authenticated": true, "expiresAt": current.expires})
	case http.MethodDelete:
		if cookie, err := r.Cookie(cookieName); err == nil {
			key := sha256.Sum256([]byte(cookie.Value))
			s.mu.Lock()
			if current := s.sessions[key]; current != nil {
				current.cancel()
				delete(s.sessions, key)
			}
			s.mu.Unlock()
		}
		http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/dashboard", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

var resourceID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// Only control-plane routes used by the dashboard are exposed. In particular,
// browser-controlled proxy headers or arbitrary guest URLs are never forwarded.
func allowedAPI(method, path string) bool {
	if method == http.MethodGet {
		return path == "/nodes" || path == "/v2/sandboxes" || path == "/snapshots" || path == "/volumes"
	}
	if method == http.MethodPost && (path == "/sandboxes-cold" || path == "/v2/sandboxes") {
		return true
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 2 && parts[0] == "sandboxes" && resourceID.MatchString(parts[1]) {
		return method == http.MethodDelete
	}
	if len(parts) == 3 && parts[0] == "sandboxes" && resourceID.MatchString(parts[1]) && method == http.MethodPost {
		return parts[2] == "pause" || parts[2] == "snapshots"
	}
	return len(parts) == 4 && parts[0] == "v2" && parts[1] == "sandboxes" && resourceID.MatchString(parts[2]) && parts[3] == "connect" && method == http.MethodPost
}

func (s *Server) handleAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/dashboard/api")
	if !allowedAPI(r.Method, path) {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}
	target := *s.upstream
	target.Path, target.RawQuery = path, r.URL.RawQuery
	request, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		http.Error(w, "invalid upstream request", http.StatusBadRequest)
		return
	}
	request.Header.Set("X-API-Key", s.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		http.Error(w, "AgentENV is unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	data, err := readLimited(response.Body)
	if err != nil {
		http.Error(w, "invalid or oversized upstream response", http.StatusBadGateway)
		return
	}
	// envd and data-plane credentials stay server-side, including create responses.
	if len(data) > 0 && strings.Contains(response.Header.Get("Content-Type"), "json") {
		var value any
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		if decoder.Decode(&value) != nil {
			http.Error(w, "invalid upstream JSON response", http.StatusBadGateway)
			return
		}
		stripTokens(value)
		data, _ = json.Marshal(value)
	}
	for _, header := range []string{"Content-Type", "X-Next-Token", "X-Total-Running"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(data)
}

func stripTokens(value any) {
	switch v := value.(type) {
	case map[string]any:
		delete(v, "envdAccessToken")
		delete(v, "trafficAccessToken")
		for _, child := range v {
			stripTokens(child)
		}
	case []any:
		for _, child := range v {
			stripTokens(child)
		}
	}
}

func readLimited(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBody {
		return nil, errors.New("response too large")
	}
	return data, nil
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	if !filepath.IsLocal(path) || strings.Contains(path, "\\") {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.assets, path)
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		if strings.HasPrefix(path, "assets/") || filepath.Ext(path) != "" {
			http.NotFound(w, r)
			return
		}
		file = filepath.Join(s.assets, "index.html")
	}
	http.ServeFile(w, r, file)
}

// Close revokes browser sessions and waits for their PTYs to be cleaned up.
// http.Server.Shutdown alone does not close hijacked WebSocket connections.
func (s *Server) Close() {
	s.mu.Lock()
	s.closed = true
	for key, current := range s.sessions {
		current.cancel()
		delete(s.sessions, key)
	}
	s.mu.Unlock()
	s.shells.Wait()
	s.client.CloseIdleConnections()
	s.streamClient.CloseIdleConnections()
}
