package dashboard

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// envd's ConnectRPC JSON transport works over the runtime's HTTP/1.1 proxy.
// Wire fields mirror thirdparty/envd/proto/process.proto; no guest changes.
func (s *Server) envdRequest(ctx context.Context, sandbox, token, method string, body any, stream bool) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	contentType := "application/json"
	if stream {
		data = connectEnvelope(data)
		contentType = "application/connect+json"
	}
	target := *s.upstream
	target.Path = "/process.Process/" + method
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Connect-Protocol-Version", "1")
	request.Header.Set("x-agentenv-sandbox-id", sandbox)
	request.Header.Set("x-agentenv-target-port", "49983")
	if token != "" {
		request.Header.Set("X-Access-Token", token)
	}
	request.SetBasicAuth("root", "")
	response, err := s.streamClient.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("envd %s returned HTTP %d", method, response.StatusCode)
	}
	return response, nil
}

func (s *Server) envdUnary(ctx context.Context, sandbox, token, method string, body any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	response, err := s.envdRequest(ctx, sandbox, token, method, body, false)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, err = readLimited(response.Body)
	return err
}

func connectEnvelope(data []byte) []byte {
	frame := make([]byte, len(data)+5)
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(data)))
	copy(frame[5:], data)
	return frame
}

func readEnvelope(reader io.Reader) ([]byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(header[1:])
	if size > 1<<20 {
		return nil, errors.New("envd frame exceeds 1 MiB")
	}
	if header[0] != 0 && header[0] != 2 {
		return nil, errors.New("unsupported envd frame flags")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	if header[0] == 2 {
		var end struct {
			Error *struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(data, &end); err != nil {
			return nil, errors.New("invalid envd end frame")
		}
		if end.Error != nil {
			return nil, fmt.Errorf("envd stream ended: %s", end.Error.Code)
		}
		return nil, io.EOF
	}
	return data, nil
}
