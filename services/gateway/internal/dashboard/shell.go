package dashboard

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

type shellInput struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

type processEvent struct {
	Event struct {
		Start *struct {
			PID uint32 `json:"pid"`
		} `json:"start"`
		Data *struct {
			PTY    []byte `json:"pty"`
			Stdout []byte `json:"stdout"`
			Stderr []byte `json:"stderr"`
		} `json:"data"`
		End *struct {
			ExitCode int `json:"exitCode"`
		} `json:"end"`
	} `json:"event"`
}

func (s *Server) handleShell(w http.ResponseWriter, r *http.Request, current *session) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		http.Error(w, "dashboard is stopping", http.StatusServiceUnavailable)
		return
	}
	s.shells.Add(1)
	s.mu.Unlock()
	defer s.shells.Done()
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("Origin") != s.origin {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	sandbox := strings.TrimPrefix(r.URL.Path, "/dashboard/shell/")
	if !resourceID.MatchString(sandbox) {
		http.Error(w, "invalid sandbox ID", http.StatusBadRequest)
		return
	}
	cols, colsErr := strconv.Atoi(r.URL.Query().Get("cols"))
	rows, rowsErr := strconv.Atoi(r.URL.Query().Get("rows"))
	if colsErr != nil || rowsErr != nil || !validSize(cols, rows) {
		http.Error(w, "invalid terminal dimensions", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithDeadline(current.ctx, current.expires)
	defer cancel()
	stop := context.AfterFunc(r.Context(), cancel)
	defer stop()
	token, status, err := s.shellToken(ctx, sandbox)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	// The exact configured Origin was checked above, including its scheme and port.
	connection, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer connection.CloseNow()
	connection.SetReadLimit(64 << 10)
	tagBytes := make([]byte, 16)
	if _, err := rand.Read(tagBytes); err != nil {
		return
	}
	tag := "dashboard-" + base64.RawURLEncoding.EncodeToString(tagBytes)
	selector := map[string]any{"tag": tag}

	inputs := make(chan shellInput, 8)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			kind, data, err := connection.Read(ctx)
			if err != nil {
				cancel()
				return
			}
			var message shellInput
			if kind != websocket.MessageText || json.Unmarshal(data, &message) != nil {
				cancel()
				return
			}
			select {
			case inputs <- message:
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() { cancel(); connection.CloseNow(); <-readDone }()

	// A unique process tag allows cleanup even if the browser disconnects before
	// the first Start event supplies a PID. Closing a tab only kills its own PTY.
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = s.envdUnary(cleanup, sandbox, token, "SendSignal", map[string]any{"process": selector, "signal": "SIGNAL_SIGKILL"})
	}()
	startTimeout := time.AfterFunc(20*time.Second, cancel)
	defer startTimeout.Stop()
	response, err := s.envdRequest(ctx, sandbox, token, "Start", map[string]any{
		"process": map[string]any{"cmd": "/agentenv/bin/busybox", "args": []string{"sh", "-c", "if [ -x /bin/bash ] && /bin/bash -c 'exit 0' >/dev/null 2>&1; then exec /bin/bash; fi; if [ -x /bin/sh ] && /bin/sh -c 'exit 0' >/dev/null 2>&1; then exec /bin/sh; fi; exec /agentenv/bin/busybox sh"}, "envs": map[string]string{"TERM": "xterm-256color", "LANG": "C.UTF-8"}},
		"pty":     map[string]any{"size": map[string]int{"cols": cols, "rows": rows}}, "stdin": true, "tag": tag,
	}, true)
	if err != nil {
		sendShellJSON(ctx, connection, map[string]any{"type": "error", "message": "Could not start the terminal. Check that the sandbox is running and envd is reachable."})
		return
	}
	defer response.Body.Close()
	outputDone := make(chan error, 1)
	ready := make(chan struct{})
	go func() {
		started := false
		for {
			data, err := readEnvelope(response.Body)
			if err != nil {
				outputDone <- err
				return
			}
			var event processEvent
			if err := json.Unmarshal(data, &event); err != nil {
				outputDone <- err
				return
			}

			if chunk := event.Event.Data; chunk != nil {
				for _, bytes := range [][]byte{chunk.PTY, chunk.Stdout, chunk.Stderr} {
					if len(bytes) > 0 {
						// Start only means the process exists. Shell initialization can
						// flush the PTY input queue; wait for its first output before
						// allowing the browser to type into this session.
						if !started {
							started = true
							startTimeout.Stop()
							close(ready)
							if err := sendShellJSON(ctx, connection, map[string]any{"type": "ready"}); err != nil {
								outputDone <- err
								return
							}
						}
						if err := sendShell(ctx, connection, websocket.MessageBinary, bytes); err != nil {
							outputDone <- err
							return
						}
					}
				}
			}
			if end := event.Event.End; end != nil {
				_ = sendShellJSON(ctx, connection, map[string]any{"type": "exit", "code": end.ExitCode})
				outputDone <- nil
				return
			}
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case err := <-outputDone:
			if err != nil {
				_ = sendShellJSON(ctx, connection, map[string]any{"type": "error", "message": "Terminal connection ended. The sandbox may have paused or become unavailable."})
			}
			return
		case input := <-inputs:
			select {
			case <-ready:
			default:
				continue
			}
			var err error
			switch input.Type {
			case "input":
				err = s.envdUnary(ctx, sandbox, token, "SendInput", map[string]any{"process": selector, "input": map[string]string{"pty": base64.StdEncoding.EncodeToString([]byte(input.Data))}})
			case "resize":
				if !validSize(input.Cols, input.Rows) {
					return
				}
				err = s.envdUnary(ctx, sandbox, token, "Update", map[string]any{"process": selector, "pty": map[string]any{"size": map[string]int{"cols": input.Cols, "rows": input.Rows}}})
			default:
				return
			}
			if err != nil {
				_ = sendShellJSON(ctx, connection, map[string]any{"type": "error", "message": "Terminal input failed. Reopen the shell to start a new session."})
				return
			}
		}
	}
}

func validSize(cols, rows int) bool { return cols >= 2 && cols <= 500 && rows >= 1 && rows <= 200 }

func sendShell(ctx context.Context, connection *websocket.Conn, kind websocket.MessageType, data []byte) error {
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return connection.Write(writeCtx, kind, data)
}
func sendShellJSON(ctx context.Context, connection *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return sendShell(ctx, connection, websocket.MessageText, data)
}

func (s *Server) shellToken(ctx context.Context, sandbox string) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	target := *s.upstream
	target.Path = "/sandboxes/" + sandbox
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	request.Header.Set("X-API-Key", s.apiKey)
	response, err := s.client.Do(request)
	if err != nil {
		return "", http.StatusBadGateway, errors.New("AgentENV is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusNotFound {
			return "", http.StatusNotFound, errors.New("sandbox not found")
		}
		return "", http.StatusBadGateway, errors.New("could not access sandbox")
	}
	var detail struct {
		State string `json:"state"`
		Token string `json:"envdAccessToken"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBody)).Decode(&detail); err != nil {
		return "", http.StatusBadGateway, errors.New("invalid sandbox details")
	}
	if detail.State != "running" {
		return "", http.StatusConflict, errors.New("resume the sandbox before opening a terminal")
	}
	return detail.Token, http.StatusOK, nil
}
