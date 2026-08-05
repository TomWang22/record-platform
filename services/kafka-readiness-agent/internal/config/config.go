package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration loaded from the environment.
type Config struct {
	PodName   string
	Namespace string
	NodeID    int32

	// BrokerAddr is host:port for the local INTERNAL listener.
	BrokerAddr string
	// BrokerServerName is the FQDN used for TLS SNI / hostname verification.
	BrokerServerName string

	HTTPAddr string

	PollInterval       time.Duration
	FreshnessThreshold time.Duration
	ReconnectGrace     time.Duration
	CheckTimeout       time.Duration

	// PEM preferred (tests + converted k8s mounts).
	TLSCertFile string
	TLSKeyFile  string
	TLSCAFile   string

	// Alternate: PEM or PKCS12 keystore/truststore paths.
	KeystorePath     string
	KeystorePassword string
	TruststorePath   string
	TruststorePassword string
	KeyPassword      string
}

// LoadFromEnv reads configuration from process environment.
func LoadFromEnv() (Config, error) {
	cfg := Config{
		PodName:   firstNonEmpty(os.Getenv("POD_NAME"), os.Getenv("HOSTNAME")),
		Namespace: firstNonEmpty(os.Getenv("NAMESPACE"), os.Getenv("POD_NAMESPACE"), "record-platform"),
		HTTPAddr:  firstNonEmpty(os.Getenv("HTTP_ADDR"), "127.0.0.1:8099"),

		TLSCertFile: os.Getenv("TLS_CERT_FILE"),
		TLSKeyFile:  os.Getenv("TLS_KEY_FILE"),
		TLSCAFile:   os.Getenv("TLS_CA_FILE"),

		KeystorePath:       firstNonEmpty(os.Getenv("KEYSTORE_PATH"), os.Getenv("TLS_KEYSTORE_PATH")),
		KeystorePassword:   firstNonEmpty(os.Getenv("KEYSTORE_PASSWORD"), readPasswordFile(os.Getenv("KEYSTORE_PASSWORD_FILE"))),
		TruststorePath:     firstNonEmpty(os.Getenv("TRUSTSTORE_PATH"), os.Getenv("TLS_TRUSTSTORE_PATH")),
		TruststorePassword: firstNonEmpty(os.Getenv("TRUSTSTORE_PASSWORD"), readPasswordFile(os.Getenv("TRUSTSTORE_PASSWORD_FILE"))),
		KeyPassword:        firstNonEmpty(os.Getenv("KEY_PASSWORD"), readPasswordFile(os.Getenv("KEY_PASSWORD_FILE"))),
	}

	if cfg.KeyPassword == "" {
		cfg.KeyPassword = cfg.KeystorePassword
	}

	nodeIDStr := firstNonEmpty(os.Getenv("NODE_ID"), os.Getenv("KAFKA_NODE_ID"))
	if nodeIDStr == "" && cfg.PodName != "" {
		if i := strings.LastIndex(cfg.PodName, "-"); i >= 0 && i+1 < len(cfg.PodName) {
			nodeIDStr = cfg.PodName[i+1:]
		}
	}
	if nodeIDStr == "" {
		return cfg, fmt.Errorf("NODE_ID (or POD_NAME ordinal) is required")
	}
	n, err := strconv.ParseInt(nodeIDStr, 10, 32)
	if err != nil {
		return cfg, fmt.Errorf("invalid NODE_ID %q: %w", nodeIDStr, err)
	}
	cfg.NodeID = int32(n)

	fqdn := firstNonEmpty(
		os.Getenv("BROKER_SERVER_NAME"),
		os.Getenv("BROKER_FQDN"),
	)
	if fqdn == "" {
		if cfg.PodName == "" {
			return cfg, fmt.Errorf("POD_NAME or BROKER_SERVER_NAME is required")
		}
		fqdn = fmt.Sprintf("%s.kafka.%s.svc.cluster.local", cfg.PodName, cfg.Namespace)
	}
	cfg.BrokerServerName = fqdn

	addr := os.Getenv("BROKER_ADDR")
	if addr == "" {
		port := firstNonEmpty(os.Getenv("BROKER_PORT"), "9093")
		addr = fqdn + ":" + port
	}
	cfg.BrokerAddr = addr

	cfg.PollInterval, err = parseDurationEnv("POLL_INTERVAL", 5*time.Second)
	if err != nil {
		return cfg, err
	}
	cfg.FreshnessThreshold, err = parseDurationEnv("FRESHNESS_THRESHOLD", 30*time.Second)
	if err != nil {
		return cfg, err
	}
	cfg.ReconnectGrace, err = parseDurationEnv("RECONNECT_GRACE", 60*time.Second)
	if err != nil {
		return cfg, err
	}
	cfg.CheckTimeout, err = parseDurationEnv("CHECK_TIMEOUT", 10*time.Second)
	if err != nil {
		return cfg, err
	}

	if err := cfg.validateTLS(); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func (c Config) validateTLS() error {
	pemSet := c.TLSCertFile != "" || c.TLSKeyFile != "" || c.TLSCAFile != ""
	if pemSet {
		if c.TLSCertFile == "" || c.TLSKeyFile == "" || c.TLSCAFile == "" {
			return fmt.Errorf("TLS_CERT_FILE, TLS_KEY_FILE, and TLS_CA_FILE must all be set together")
		}
		return nil
	}
	if c.KeystorePath == "" || c.TruststorePath == "" {
		return fmt.Errorf("set TLS_CERT_FILE/TLS_KEY_FILE/TLS_CA_FILE or KEYSTORE_PATH+TRUSTSTORE_PATH")
	}
	return nil
}

func parseDurationEnv(key string, def time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s=%q: %w", key, v, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return d, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func readPasswordFile(path string) string {
	if path == "" {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}
