package httpapi

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"record-platform/kafka-readiness-agent/internal/agent"
)

// Server exposes loopback health endpoints for the readiness agent.
type Server struct {
	addr   string
	agent  *agent.Agent
	server *http.Server
}

// New builds an HTTP server bound to addr (must be loopback in production).
func New(addr string, ag *agent.Agent) *Server {
	s := &Server{addr: addr, agent: ag}
	mux := http.NewServeMux()
	mux.HandleFunc("/livez", s.handleLivez)
	mux.HandleFunc("/readyz", s.handleReadyz)
	mux.HandleFunc("/status", s.handleStatus)
	mux.Handle("/metrics", promhttp.Handler())
	s.server = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
	return s
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	return s.server.Serve(ln)
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}

// Handler exposes the mux for tests.
func (s *Server) Handler() http.Handler { return s.server.Handler }

func (s *Server) handleLivez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "LIVE"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, _ *http.Request) {
	ok, reason, msg := s.agent.Ready()
	if ok {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "READY",
			"message": msg,
		})
		return
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"status":  "NOT_READY",
		"reason":  reason,
		"message": msg,
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.agent.Snapshot())
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	_ = enc.Encode(v)
}
