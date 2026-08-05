package agent_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"record-platform/kafka-readiness-agent/internal/agent"
	"record-platform/kafka-readiness-agent/internal/check"
	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/httpapi"
	"record-platform/kafka-readiness-agent/internal/reasons"
)

func testCfg() config.Config {
	return config.Config{
		PodName:            "kafka-0",
		Namespace:          "record-platform",
		NodeID:             0,
		BrokerAddr:         "kafka-0.kafka.record-platform.svc.cluster.local:9093",
		BrokerServerName:   "kafka-0.kafka.record-platform.svc.cluster.local",
		HTTPAddr:           "127.0.0.1:0",
		PollInterval:       time.Hour,
		FreshnessThreshold: 30 * time.Second,
		ReconnectGrace:     60 * time.Second,
		CheckTimeout:       2 * time.Second,
	}
}

func newTestAgent(t *testing.T, fake *check.FakeChecker) (*agent.Agent, *httpapi.Server) {
	t.Helper()
	ag := agent.New(testCfg(), fake, nil)
	srv := httpapi.New("127.0.0.1:0", ag)
	return ag, srv
}

func getJSON(t *testing.T, h http.Handler, path string) (int, map[string]any) {
	t.Helper()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	h.ServeHTTP(rr, req)
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v body=%s", err, rr.Body.String())
	}
	return rr.Code, body
}

func TestReadyValidLocalBroker(t *testing.T) {
	fake := check.NewFake(0)
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())

	code, body := getJSON(t, srv.Handler(), "/readyz")
	if code != http.StatusOK {
		t.Fatalf("status=%d body=%v", code, body)
	}
	if body["status"] != "READY" {
		t.Fatalf("want READY got %v", body["status"])
	}
}

func TestNotReadyReasons(t *testing.T) {
	cases := []struct {
		name   string
		result check.Result
		want   string
	}{
		{"wrong_root", check.Result{Reason: reasons.TLSChainFailure, Message: "bad root"}, reasons.TLSChainFailure},
		{"hostname", check.Result{Reason: reasons.TLSHostnameFailure, Message: "bad host"}, reasons.TLSHostnameFailure},
		{"absent_client_cert", check.Result{Reason: reasons.TLSClientIdentityFailure, Message: "no cert"}, reasons.TLSClientIdentityFailure},
		{"bad_eku", check.Result{Reason: reasons.TLSChainFailure, Message: "eku"}, reasons.TLSChainFailure},
		{"malformed_apiversions", check.Result{Reason: reasons.ApiVersionsFailure, Message: "malformed"}, reasons.ApiVersionsFailure},
		{"disconnect", check.Result{Reason: reasons.ApiVersionsFailure, Message: "disconnect"}, reasons.ApiVersionsFailure},
		{"metadata_timeout", check.Result{Reason: reasons.MetadataFailure, Message: "timeout"}, reasons.MetadataFailure},
		{"wrong_node", check.Result{Reason: reasons.LocalNodeIDMismatch, Message: "mismatch", ObservedNodeID: 2}, reasons.LocalNodeIDMismatch},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := check.NewFake(0)
			fake.SetResult(tc.result)
			ag, srv := newTestAgent(t, fake)
			ag.ForcePoll(context.Background())
			code, body := getJSON(t, srv.Handler(), "/readyz")
			if code != http.StatusServiceUnavailable {
				t.Fatalf("status=%d", code)
			}
			if body["status"] != "NOT_READY" {
				t.Fatalf("status field %v", body["status"])
			}
			if body["reason"] != tc.want {
				t.Fatalf("reason=%v want %s", body["reason"], tc.want)
			}
		})
	}
}

func TestStaleLastSuccess(t *testing.T) {
	fake := check.NewFake(0)
	cfg := testCfg()
	cfg.FreshnessThreshold = 50 * time.Millisecond
	ag := agent.New(cfg, fake, nil)
	srv := httpapi.New("127.0.0.1:0", ag)

	ag.ForcePoll(context.Background())
	code, _ := getJSON(t, srv.Handler(), "/readyz")
	if code != http.StatusOK {
		t.Fatalf("expected READY before stale, got %d", code)
	}

	time.Sleep(80 * time.Millisecond)
	code, body := getJSON(t, srv.Handler(), "/readyz")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("expected NOT_READY after stale, got %d", code)
	}
	if body["reason"] != reasons.StaleLastSuccess {
		t.Fatalf("reason=%v", body["reason"])
	}
}

func TestConcurrentReadyzDoesNotCreateClients(t *testing.T) {
	fake := check.NewFake(0)
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())
	before := fake.ClientCreations()
	if before != 1 {
		t.Fatalf("creations=%d want 1", before)
	}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rr := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		}()
	}
	wg.Wait()

	if fake.ClientCreations() != before {
		t.Fatalf("concurrent readyz created clients: before=%d after=%d", before, fake.ClientCreations())
	}
	if fake.CheckCount() != 1 {
		t.Fatalf("readyz must not invoke Check; checks=%d", fake.CheckCount())
	}
}

func TestRestartRecoveryViaReset(t *testing.T) {
	fake := check.NewFake(0)
	fake.SetResult(check.Result{Reason: reasons.TCPConnectFailure, Message: "down"})
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())
	code, body := getJSON(t, srv.Handler(), "/readyz")
	if code != http.StatusServiceUnavailable || body["reason"] != reasons.TCPConnectFailure {
		t.Fatalf("expected TCP failure, got %d %v", code, body)
	}
	if fake.ResetCount() < 1 {
		t.Fatalf("expected Reconnect/Reset after failure")
	}

	fake.SetResult(check.Result{OK: true, ObservedNodeID: 0, Message: "ok"})
	ag.ForcePoll(context.Background())
	code, body = getJSON(t, srv.Handler(), "/readyz")
	if code != http.StatusOK || body["status"] != "READY" {
		t.Fatalf("expected recovery READY, got %d %v", code, body)
	}
	if fake.ClientCreations() < 2 {
		t.Fatalf("expected new client after reset, creations=%d", fake.ClientCreations())
	}
}

func TestStatusHasNoSecrets(t *testing.T) {
	fake := check.NewFake(0)
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())

	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/status", nil))
	raw, _ := io.ReadAll(rr.Body)
	s := strings.ToLower(string(raw))
	forbidden := []string{"password", "private_key", "-----begin", "keystore_password", "truststore_password", "secret"}
	for _, f := range forbidden {
		if strings.Contains(s, f) {
			t.Fatalf("status JSON contains forbidden token %q: %s", f, s)
		}
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"password", "tls_key", "keystore_password", "cert_pem"} {
		if _, ok := body[k]; ok {
			t.Fatalf("status has secret field %s", k)
		}
	}
}

func TestLivezAlwaysOK(t *testing.T) {
	fake := check.NewFake(0)
	fake.SetResult(check.Result{Reason: reasons.MetadataFailure, Message: "x"})
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())
	code, body := getJSON(t, srv.Handler(), "/livez")
	if code != http.StatusOK || body["status"] != "LIVE" {
		t.Fatalf("livez=%d %v", code, body)
	}
}

func TestInjectStale(t *testing.T) {
	fake := check.NewFake(0)
	cfg := testCfg()
	cfg.FreshnessThreshold = 10 * time.Millisecond
	ag := agent.New(cfg, fake, nil)
	ag.InjectSuccess(time.Now().Add(-time.Second))
	ok, reason, _ := ag.Ready()
	if ok || reason != reasons.StaleLastSuccess {
		t.Fatalf("ok=%v reason=%s", ok, reason)
	}
}
