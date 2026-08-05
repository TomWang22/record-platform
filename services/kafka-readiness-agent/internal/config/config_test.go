package config_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"record-platform/kafka-readiness-agent/internal/config"
)

func TestLoadFromEnvPEM(t *testing.T) {
	dir := t.TempDir()
	cert := filepath.Join(dir, "tls.crt")
	key := filepath.Join(dir, "tls.key")
	ca := filepath.Join(dir, "ca.pem")
	for _, p := range []string{cert, key, ca} {
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("POD_NAME", "kafka-1")
	t.Setenv("NAMESPACE", "record-platform")
	t.Setenv("TLS_CERT_FILE", cert)
	t.Setenv("TLS_KEY_FILE", key)
	t.Setenv("TLS_CA_FILE", ca)
	t.Setenv("NODE_ID", "")
	t.Setenv("BROKER_ADDR", "")
	t.Setenv("BROKER_SERVER_NAME", "")
	t.Setenv("POLL_INTERVAL", "")
	t.Setenv("FRESHNESS_THRESHOLD", "")
	t.Setenv("HTTP_ADDR", "127.0.0.1:8099")

	cfg, err := config.LoadFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.NodeID != 1 {
		t.Fatalf("NodeID=%d", cfg.NodeID)
	}
	if cfg.BrokerAddr != "kafka-1.kafka.record-platform.svc.cluster.local:9093" {
		t.Fatalf("BrokerAddr=%s", cfg.BrokerAddr)
	}
	if cfg.PollInterval != 5*time.Second {
		t.Fatalf("PollInterval=%s", cfg.PollInterval)
	}
	if cfg.FreshnessThreshold != 30*time.Second {
		t.Fatalf("Freshness=%s", cfg.FreshnessThreshold)
	}
}

func TestLoadRequiresTLS(t *testing.T) {
	t.Setenv("POD_NAME", "kafka-0")
	t.Setenv("NAMESPACE", "record-platform")
	t.Setenv("TLS_CERT_FILE", "")
	t.Setenv("TLS_KEY_FILE", "")
	t.Setenv("TLS_CA_FILE", "")
	t.Setenv("KEYSTORE_PATH", "")
	t.Setenv("TRUSTSTORE_PATH", "")
	_, err := config.LoadFromEnv()
	if err == nil {
		t.Fatal("expected error")
	}
}
