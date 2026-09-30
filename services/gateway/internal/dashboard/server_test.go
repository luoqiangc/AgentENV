package dashboard

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const testKey = "e2b_dashboard_test_key_01234567890123456789"
const testOrigin = "http://dashboard.test"

func newTestServer(t *testing.T, upstream http.Handler) (*Server, *httptest.Server, *http.Client) {
	t.Helper()
	backend := httptest.NewServer(upstream)
	t.Cleanup(backend.Close)
	assets := t.TempDir()
	if err := os.WriteFile(filepath.Join(assets, "index.html"), []byte("dashboard app"), 0600); err != nil {
		t.Fatal(err)
	}
	server, err := New(Options{Upstream: backend.URL, AssetsDir: assets, PublicOrigin: testOrigin, APIKey: testKey})
	if err != nil {
		t.Fatal(err)
	}
	browser := httptest.NewServer(server)
	t.Cleanup(browser.Close)
	t.Cleanup(server.Close)
	jar, _ := cookiejar.New(nil)
	return server, browser, &http.Client{Jar: jar}
}

func request(t *testing.T, client *http.Client, method, target, body, origin string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Origin", origin)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
func login(t *testing.T, client *http.Client, target string) {
	t.Helper()
	response := request(t, client, "POST", target+"/dashboard/session", `{"apiKey":"`+testKey+`"}`, testOrigin)
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("login: %d", response.StatusCode)
	}
	cookie := response.Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/dashboard" {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
}

func TestColdStartWaitsBeyondShellHandshakeTimeout(t *testing.T) {
	server, browser, client := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sandboxes-cold" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		// Image preparation finishes before the API can send response headers.
		time.Sleep(100 * time.Millisecond)
		writeJSON(w, map[string]string{"sandboxID": "slow-image-sandbox"})
	}))
	// Scale down the shell handshake deadline to keep the regression fast.
	server.streamClient.Transport.(*http.Transport).ResponseHeaderTimeout = 20 * time.Millisecond
	login(t, client, browser.URL)
	response := request(t, client, "POST", browser.URL+"/dashboard/api/sandboxes-cold", `{"image":"python:3.12"}`, testOrigin)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("cold start was cut short: HTTP %d %s", response.StatusCode, body)
	}
}

func TestSessionAndProxyIsolation(t *testing.T) {
	calls := 0
	server, browser, client := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-API-Key") != testKey {
			t.Error("missing configured API key")
		}
		for _, header := range []string{"Cookie", "e2b-sandbox-id", "x-agentenv-target-port", "Authorization"} {
			if r.Header.Get(header) != "" {
				t.Errorf("forwarded browser header %s", header)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Next-Token", "next-page")
		w.Header().Set("Set-Cookie", "backend-cookie=secret")
		_, _ = io.WriteString(w, `[{"sandboxID":"sbx-1","envdAccessToken":"secret","trafficAccessToken":"secret","memoryMB":1024}]`)
	}))
	for _, tc := range []struct {
		method, path, body, origin string
		status                     int
	}{
		{"GET", "/dashboard/api/v2/sandboxes", "", "", 401},
		{"POST", "/dashboard/session", `{"apiKey":"` + testKey + `"}`, "http://attacker.test", 403},
		{"POST", "/dashboard/session", `{"apiKey":"wrong"}`, testOrigin, 401},
		{"GET", "/sandboxes", "", "", 200}, // SPA deep link
		{"GET", "/assets/missing.js", "", "", 404},
	} {
		response := request(t, client, tc.method, browser.URL+tc.path, tc.body, tc.origin)
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Errorf("%s: %d != %d", tc.path, response.StatusCode, tc.status)
		}
	}
	login(t, client, browser.URL)
	req, _ := http.NewRequest("GET", browser.URL+"/dashboard/api/v2/sandboxes", nil)
	req.Header.Set("e2b-sandbox-id", "other-sandbox")
	req.Header.Set("x-agentenv-target-port", "22")
	req.Header.Set("Authorization", "Bearer attacker")
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if strings.Contains(string(data), "secret") || len(response.Cookies()) != 0 {
		t.Fatal("upstream credentials exposed")
	}
	if response.Header.Get("X-Next-Token") != "next-page" {
		t.Fatal("pagination header lost")
	}
	if calls != 1 {
		t.Fatalf("upstream calls: %d", calls)
	}
	for _, path := range []string{"/dashboard/api/proxy", "/dashboard/api/process.Process/Start"} {
		response = request(t, client, "GET", browser.URL+path, "", testOrigin)
		response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatalf("arbitrary proxy accepted: %s", path)
		}
	}
	response = request(t, client, "DELETE", browser.URL+"/dashboard/api/sandboxes/sbx-1", "", "http://attacker.test")
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("mutation did not require same origin")
	}
	// Expired sessions cannot access the API.
	server.mu.Lock()
	for _, current := range server.sessions {
		current.expires = time.Now().Add(-time.Second)
	}
	server.mu.Unlock()
	response = request(t, client, "GET", browser.URL+"/dashboard/session", "", "")
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("expired session accepted")
	}
	login(t, client, browser.URL)
	response = request(t, client, "DELETE", browser.URL+"/dashboard/session", "", testOrigin)
	response.Body.Close()
	response = request(t, client, "GET", browser.URL+"/dashboard/api/nodes", "", "")
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("logout did not invalidate session")
	}
}

func TestShellBridgesPTYAndCleansUpOnLogout(t *testing.T) {
	inputs := make(chan string, 1)
	started := make(chan struct{})
	outputAllowed := make(chan struct{})
	resizes := make(chan int, 1)
	killed := make(chan struct{}, 1)
	server, browser, client := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sandboxes/sbx-1" {
			writeJSON(w, map[string]string{"state": "running", "envdAccessToken": "guest-token"})
			return
		}
		if r.Header.Get("X-Access-Token") != "guest-token" || r.Header.Get("x-agentenv-sandbox-id") != "sbx-1" || r.Header.Get("x-agentenv-target-port") != "49983" {
			t.Error("incorrect trusted guest routing")
		}
		switch r.URL.Path {
		case "/process.Process/Start":
			if r.Header.Get("Content-Type") != "application/connect+json" {
				t.Error("wrong streaming content type")
			}
			data, err := readEnvelope(r.Body)
			if err != nil {
				t.Error(err)
				return
			}
			var start struct {
				Tag string `json:"tag"`
				PTY struct {
					Size struct {
						Cols int `json:"cols"`
					} `json:"size"`
				} `json:"pty"`
			}
			if json.Unmarshal(data, &start) != nil || !strings.HasPrefix(start.Tag, "dashboard-") || start.PTY.Size.Cols != 80 {
				t.Error("bad PTY start")
			}
			w.Header().Set("Content-Type", "application/connect+json")
			_, _ = w.Write(connectEnvelope([]byte(`{"event":{"start":{"pid":42}}}`)))
			w.(http.Flusher).Flush()
			close(started)
			select {
			case <-outputAllowed:
			case <-r.Context().Done():
				return
			}
			_, _ = w.Write(connectEnvelope([]byte(`{"event":{"data":{"pty":"aGVsbG8NCg=="}}}`)))
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		case "/process.Process/SendInput":
			var data struct {
				Input struct {
					PTY []byte `json:"pty"`
				} `json:"input"`
			}
			_ = json.NewDecoder(r.Body).Decode(&data)
			inputs <- string(data.Input.PTY)
			writeJSON(w, map[string]any{})
		case "/process.Process/Update":
			var data struct {
				PTY struct {
					Size struct {
						Cols int `json:"cols"`
					} `json:"size"`
				} `json:"pty"`
			}
			_ = json.NewDecoder(r.Body).Decode(&data)
			resizes <- data.PTY.Size.Cols
			writeJSON(w, map[string]any{})
		case "/process.Process/SendSignal":
			killed <- struct{}{}
			writeJSON(w, map[string]any{})
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	_ = server
	login(t, client, browser.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, strings.Replace(browser.URL, "http:", "ws:", 1)+"/dashboard/shell/sbx-1?cols=80&rows=24", &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Origin": []string{testOrigin}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	<-started
	type received struct {
		kind websocket.MessageType
		data []byte
		err  error
	}
	first := make(chan received, 1)
	go func() {
		kind, data, err := conn.Read(ctx)
		first <- received{kind, data, err}
	}()
	select {
	case <-first:
		t.Fatal("browser became ready before the shell produced output")
	case <-time.After(30 * time.Millisecond):
	}
	close(outputAllowed)
	message := <-first
	kind, data, err := message.kind, message.data, message.err
	if err != nil || kind != websocket.MessageText || !bytes.Contains(data, []byte(`"ready"`)) {
		t.Fatalf("ready: %s %v", data, err)
	}
	kind, data, err = conn.Read(ctx)
	if err != nil || kind != websocket.MessageBinary || string(data) != "hello\r\n" {
		t.Fatalf("PTY output: %q %v", data, err)
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"input","data":"echo hi\r\u0003"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case input := <-inputs:
		if input != "echo hi\r\x03" {
			t.Fatalf("input: %q", input)
		}
	case <-ctx.Done():
		t.Fatal("no input")
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":100,"rows":30}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case cols := <-resizes:
		if cols != 100 {
			t.Fatal("wrong size")
		}
	case <-ctx.Done():
		t.Fatal("no resize")
	}
	response := request(t, client, "DELETE", browser.URL+"/dashboard/session", "", testOrigin)
	response.Body.Close()
	if _, _, err := conn.Read(ctx); err == nil {
		t.Fatal("logout left WebSocket open")
	}
	select {
	case <-killed:
	case <-ctx.Done():
		t.Fatal("PTY was not cleaned up")
	}
}

func TestShellRejectsCrossOriginAndPaused(t *testing.T) {
	_, browser, client := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]string{"state": "paused"}) }))
	login(t, client, browser.URL)
	for _, tc := range []struct {
		origin string
		status int
	}{{"http://attacker.test", 403}, {testOrigin, 409}} {
		response := request(t, client, "GET", browser.URL+"/dashboard/shell/sbx-1?cols=80&rows=24", "", tc.origin)
		response.Body.Close()
		if response.StatusCode != tc.status {
			t.Fatalf("shell status: %d != %d", response.StatusCode, tc.status)
		}
	}
}

func TestEnvelopeBoundsAndErrors(t *testing.T) {
	oversized := make([]byte, 5)
	binary.BigEndian.PutUint32(oversized[1:], 2<<20)
	compressed := connectEnvelope([]byte(`{}`))
	compressed[0] = 1
	end := connectEnvelope([]byte(`{"error":{"code":"unavailable"}}`))
	end[0] = 2
	for _, frame := range [][]byte{oversized, compressed, end, {0, 0}} {
		if _, err := readEnvelope(bytes.NewReader(frame)); err == nil {
			t.Fatal("bad envelope accepted")
		}
	}
	data, err := readEnvelope(bytes.NewReader(connectEnvelope([]byte(`{"event":{}}`))))
	if err != nil || string(data) != `{"event":{}}` {
		t.Fatalf("valid frame: %q %v", data, err)
	}
}
