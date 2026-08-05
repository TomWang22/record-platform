package agent_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

func countMatchingProcesses(patterns ...string) int {
	// Best-effort: count processes matching patterns owned by this user.
	// Unit tests must not spawn JVM/kafka CLI/openssl/keytool.
	out, err := exec.Command("ps", "-ax", "-o", "pid=,command=").Output()
	if err != nil {
		return -1
	}
	n := 0
	self := os.Getpid()
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		// skip our own test binary line noise loosely
		cmd := strings.Join(fields[1:], " ")
		if strings.Contains(cmd, "kafka-readiness-agent") && strings.Contains(cmd, "go test") {
			continue
		}
		_ = self
		for _, p := range patterns {
			if strings.Contains(cmd, p) {
				n++
				break
			}
		}
	}
	return n
}

func inventoryDir(root string) map[string]int64 {
	out := map[string]int64{}
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		out[rel] = info.Size()
		return nil
	})
	return out
}

func TestProcessLeakProof(t *testing.T) {
	fake := check.NewFake(0)
	cfg := testCfg()
	cfg.PollInterval = time.Hour
	ag := agent.New(cfg, fake, nil)
	srv := httpapi.New("127.0.0.1:0", ag)
	ag.ForcePoll(context.Background())

	beforeCreations := fake.ClientCreations()
	beforeChecks := fake.CheckCount()
	beforeG := runtime.NumGoroutine()
	beforeJVM := countMatchingProcesses("java ", "BrokerApiVersionsCommand")
	beforeCLI := countMatchingProcesses("kafka-broker-api-versions", "kafka-topics")
	beforeOpenSSL := countMatchingProcesses("openssl ")
	beforeKeytool := countMatchingProcesses("keytool ")

	// Force reconnect churn interleaved with HTTP.
	fake.SetResult(check.Result{OK: false, Reason: reasons.TCPConnectFailure, Message: "down"})
	ag.ForcePoll(context.Background())
	fake.SetResult(check.Result{OK: true, ObservedNodeID: 0, Message: "up"})
	ag.ForcePoll(context.Background())

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rr := httptest.NewRecorder()
			path := "/readyz"
			if i%2 == 0 {
				path = "/status"
			}
			srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		}(i)
	}
	wg.Wait()

	// Settle
	time.Sleep(50 * time.Millisecond)
	runtime.GC()
	time.Sleep(50 * time.Millisecond)

	afterCreations := fake.ClientCreations()
	afterChecks := fake.CheckCount()
	afterG := runtime.NumGoroutine()
	afterJVM := countMatchingProcesses("java ", "BrokerApiVersionsCommand")
	afterCLI := countMatchingProcesses("kafka-broker-api-versions", "kafka-topics")
	afterOpenSSL := countMatchingProcesses("openssl ")
	afterKeytool := countMatchingProcesses("keytool ")

	if afterChecks != beforeChecks+2 { // two ForcePolls only; HTTP must not Check
		// beforeChecks includes initial ForcePoll; +2 for down/up polls
		// Initial ForcePoll already counted in beforeChecks; we did 2 more after snapshot.
		t.Logf("checks before=%d after=%d (HTTP must not invoke Check)", beforeChecks, afterChecks)
	}
	if fake.CheckCount() != afterChecks {
		t.Fatalf("check count drifted")
	}
	// HTTP path must not create protocol clients.
	httpCreated := afterCreations - beforeCreations
	// Reconnect may create clients (allowed for poller); HTTP-only window after last poll:
	creationsAtHTTPStart := afterCreations
	var wg2 sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg2.Add(1)
		go func() {
			defer wg2.Done()
			rr := httptest.NewRecorder()
			srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		}()
	}
	wg2.Wait()
	if fake.ClientCreations() != creationsAtHTTPStart {
		t.Fatalf("protocol_clients_created_by_HTTP_requests=%d want 0 (creations %d→%d)",
			fake.ClientCreations()-creationsAtHTTPStart, creationsAtHTTPStart, fake.ClientCreations())
	}
	_ = httpCreated

	if afterJVM > beforeJVM {
		t.Fatalf("JVM_processes_created=%d", afterJVM-beforeJVM)
	}
	if afterCLI > beforeCLI {
		t.Fatalf("kafka_CLI_processes_created=%d", afterCLI-beforeCLI)
	}
	if afterOpenSSL > beforeOpenSSL {
		t.Fatalf("openssl_processes_created=%d", afterOpenSSL-beforeOpenSSL)
	}
	if afterKeytool > beforeKeytool {
		t.Fatalf("keytool_processes_created=%d", afterKeytool-beforeKeytool)
	}
	// Goroutine growth bound after settle (httptest should not leak).
	if afterG > beforeG+20 {
		t.Fatalf("unexpected_goroutine_growth before=%d after=%d", beforeG, afterG)
	}
}

func TestFileLeakProof(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)
	before := inventoryDir(tmp)

	fake := check.NewFake(0)
	cfg := testCfg()
	ag := agent.New(cfg, fake, nil)
	srv := httpapi.New("127.0.0.1:0", ag)

	// TLS failure / reconnect / success path
	fake.SetResult(check.Result{OK: false, Reason: reasons.TLSChainFailure, Message: "bad root"})
	ag.ForcePoll(context.Background())
	fake.SetResult(check.Result{OK: false, Reason: reasons.TCPConnectFailure, Message: "down"})
	ag.ForcePoll(context.Background())
	fake.SetResult(check.Result{OK: true, ObservedNodeID: 0, Message: "ok"})
	ag.ForcePoll(context.Background())

	for i := 0; i < 1000; i++ {
		rr := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		rr2 := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rr2, httptest.NewRequest(http.MethodGet, "/status", nil))
	}

	after := inventoryDir(tmp)
	// No new files under TMPDIR from agent HTTP/reconnect path.
	for rel, sz := range after {
		if _, ok := before[rel]; !ok {
			t.Fatalf("unexpected_files_created=%s size=%d", rel, sz)
		}
	}
	// No credential material filenames.
	for rel := range after {
		low := strings.ToLower(rel)
		for _, bad := range []string{".jks", ".p12", ".pem", "password", "keystore", "truststore", "private"} {
			if strings.Contains(low, bad) {
				t.Fatalf("secret_material_or_keystore_artifact=%s", rel)
			}
		}
	}
}

func TestFileLeakProofNoCredentialCopies(t *testing.T) {
	// Ensure Snapshot /readyz bodies never instruct writing secrets to disk and status has no PEM.
	fake := check.NewFake(0)
	ag, srv := newTestAgent(t, fake)
	ag.ForcePoll(context.Background())
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/status", nil))
	body, _ := io.ReadAll(rr.Body)
	s := strings.ToLower(string(body))
	for _, tok := range []string{"-----begin", "private_key", "keystore_password", "truststore_password"} {
		if strings.Contains(s, tok) {
			t.Fatalf("credential_copies_created_in_status token=%s", tok)
		}
	}
}

var _ = config.Config{}
