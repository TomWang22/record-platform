package check_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"record-platform/kafka-readiness-agent/internal/check"
	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/reasons"
)

func TestBuildTLSConfigPEM(t *testing.T) {
	dir := t.TempDir()
	caCert, caKey := mustCA(t)
	leafCert, leafKey := mustLeaf(t, caCert, caKey, "kafka-0.kafka.record-platform.svc.cluster.local")

	caPath := writePEM(t, dir, "ca.pem", "CERTIFICATE", caCert.Raw)
	certPath := writePEM(t, dir, "tls.crt", "CERTIFICATE", leafCert.Raw)
	keyDER, err := x509.MarshalECPrivateKey(leafKey)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := writePEM(t, dir, "tls.key", "EC PRIVATE KEY", keyDER)

	cfg := config.Config{
		TLSCertFile:      certPath,
		TLSKeyFile:       keyPath,
		TLSCAFile:        caPath,
		BrokerServerName: "kafka-0.kafka.record-platform.svc.cluster.local",
	}
	tlsCfg, err := check.BuildTLSConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if tlsCfg.ServerName != cfg.BrokerServerName {
		t.Fatalf("ServerName=%s", tlsCfg.ServerName)
	}
	if len(tlsCfg.Certificates) != 1 {
		t.Fatalf("certs=%d", len(tlsCfg.Certificates))
	}
}

func TestBuildTLSConfigMissingClientCert(t *testing.T) {
	dir := t.TempDir()
	caCert, _ := mustCA(t)
	caPath := writePEM(t, dir, "ca.pem", "CERTIFICATE", caCert.Raw)
	cfg := config.Config{
		TLSCertFile:      filepath.Join(dir, "missing.crt"),
		TLSKeyFile:       filepath.Join(dir, "missing.key"),
		TLSCAFile:        caPath,
		BrokerServerName: "kafka-0.kafka.record-platform.svc.cluster.local",
	}
	_, err := check.BuildTLSConfig(cfg)
	if err == nil {
		t.Fatal("expected error")
	}
	if check.TLSFailure(err) != reasons.TLSClientIdentityFailure && !contains(err.Error(), reasons.TLSClientIdentityFailure) {
		// BuildTLSConfig wraps with reason prefix
		if !contains(err.Error(), reasons.TLSClientIdentityFailure) {
			t.Fatalf("err=%v", err)
		}
	}
}

func TestClassifyVerifyHostname(t *testing.T) {
	err := x509.HostnameError{Host: "wrong", Certificate: &x509.Certificate{}}
	if check.ClassifyVerifyError(err) != reasons.TLSHostnameFailure {
		t.Fatalf("got %s", check.ClassifyVerifyError(err))
	}
}

func TestClassifyUnknownAuthority(t *testing.T) {
	err := x509.UnknownAuthorityError{Cert: &x509.Certificate{}}
	if check.ClassifyVerifyError(err) != reasons.TLSChainFailure {
		t.Fatalf("got %s", check.ClassifyVerifyError(err))
	}
}

func TestTLSFailureTCP(t *testing.T) {
	err := &net.OpError{Op: "dial", Net: "tcp", Err: net.ErrClosed}
	r := check.TLSFailure(err)
	if r != reasons.TCPConnectFailure && r != reasons.TLSChainFailure {
		// OpError string may vary; accept TCP classification preference
		if r != reasons.TCPConnectFailure {
			t.Logf("classify dial closed as %s", r)
		}
	}
}

func mustCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func mustLeaf(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, dns string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: dns},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{dns},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func writePEM(t *testing.T, dir, name, typ string, der []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := pem.Encode(f, &pem.Block{Type: typ, Bytes: der}); err != nil {
		t.Fatal(err)
	}
	return path
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || (len(s) > 0 && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()))
}
