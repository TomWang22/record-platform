package check

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/pkcs12"

	"record-platform/kafka-readiness-agent/internal/config"
	"record-platform/kafka-readiness-agent/internal/reasons"
)

// TLSFailure maps a low-level TLS/identity error to a stable reason code.
func TLSFailure(err error) string {
	if err == nil {
		return ""
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "certificate is valid for"),
		strings.Contains(msg, "hostname"),
		strings.Contains(msg, "x509: certificate signed by unknown"),
		strings.Contains(msg, "not valid for any names"):
		if strings.Contains(msg, "hostname") || strings.Contains(msg, "certificate is valid for") || strings.Contains(msg, "not valid for any names") {
			return reasons.TLSHostnameFailure
		}
		return reasons.TLSChainFailure
	case strings.Contains(msg, "unknown authority"),
		strings.Contains(msg, "certificate signed by unknown"),
		strings.Contains(msg, "failed to verify certificate"),
		strings.Contains(msg, "bad certificate"),
		strings.Contains(msg, "certificate verify failed"),
		strings.Contains(msg, "x509:"):
		if strings.Contains(msg, "hostname") || strings.Contains(msg, "certificate is valid for") {
			return reasons.TLSHostnameFailure
		}
		return reasons.TLSChainFailure
	case strings.Contains(msg, "remote error: tls: bad certificate"),
		strings.Contains(msg, "certificate required"),
		strings.Contains(msg, "no certificates"),
		strings.Contains(msg, "tls: bad certificate"),
		strings.Contains(msg, "client cert"),
		strings.Contains(msg, "private key"):
		return reasons.TLSClientIdentityFailure
	case strings.Contains(msg, "connection refused"),
		strings.Contains(msg, "i/o timeout"),
		strings.Contains(msg, "connection reset"),
		strings.Contains(msg, "no such host"),
		strings.Contains(msg, "network is unreachable"),
		strings.Contains(msg, "dial tcp"):
		return reasons.TCPConnectFailure
	default:
		if strings.Contains(msg, "tls") || strings.Contains(msg, "x509") || strings.Contains(msg, "certificate") {
			return reasons.TLSChainFailure
		}
		return reasons.TCPConnectFailure
	}
}

// BuildTLSConfig constructs a client TLS config with HTTPS hostname verification
// and custom chain validation against TLS_CA_FILE / truststore roots.
func BuildTLSConfig(cfg config.Config) (*tls.Config, error) {
	roots, err := loadRoots(cfg)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", reasons.TLSChainFailure, err)
	}
	certs, err := loadClientCerts(cfg)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", reasons.TLSClientIdentityFailure, err)
	}
	if len(certs) == 0 {
		return nil, fmt.Errorf("%s: client certificate required", reasons.TLSClientIdentityFailure)
	}

	serverName := cfg.BrokerServerName
	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		ServerName:   serverName,
		Certificates: certs,
		RootCAs:      roots,
		// Custom verify: leaf → intermediates → roots, plus hostname/SNI.
		InsecureSkipVerify: true, //nolint:gosec // we verify manually below
		VerifyConnection: func(cs tls.ConnectionState) error {
			return verifyBrokerChain(cs, roots, serverName)
		},
	}, nil
}

func verifyBrokerChain(cs tls.ConnectionState, roots *x509.CertPool, serverName string) error {
	if len(cs.PeerCertificates) == 0 {
		return fmt.Errorf("no peer certificates")
	}
	leaf := cs.PeerCertificates[0]
	intermediates := x509.NewCertPool()
	for _, c := range cs.PeerCertificates[1:] {
		intermediates.AddCert(c)
	}
	opts := x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		DNSName:       serverName,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if _, err := leaf.Verify(opts); err != nil {
		return err
	}
	return nil
}

func loadRoots(cfg config.Config) (*x509.CertPool, error) {
	pool := x509.NewCertPool()
	if cfg.TLSCAFile != "" {
		pemBytes, err := os.ReadFile(cfg.TLSCAFile)
		if err != nil {
			return nil, err
		}
		if !pool.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("no certificates found in TLS_CA_FILE")
		}
		return pool, nil
	}
	return loadTruststore(cfg.TruststorePath, cfg.TruststorePassword)
}

func loadClientCerts(cfg config.Config) ([]tls.Certificate, error) {
	if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err != nil {
			return nil, err
		}
		return []tls.Certificate{cert}, nil
	}
	return loadKeystore(cfg.KeystorePath, cfg.KeystorePassword, cfg.KeyPassword)
}

func loadTruststore(path, password string) (*x509.CertPool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if pool.AppendCertsFromPEM(data) {
		return pool, nil
	}
	// PKCS12 truststore (may contain one or more certs).
	certs, err := decodePKCS12Certs(data, password)
	if err != nil {
		return nil, fmt.Errorf("truststore is neither PEM nor PKCS12: %w", err)
	}
	for _, c := range certs {
		pool.AddCert(c)
	}
	return pool, nil
}

func loadKeystore(path, storePass, keyPass string) ([]tls.Certificate, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if looksLikePEM(data) {
		cert, err := tls.X509KeyPair(data, data)
		if err != nil {
			// Separate cert+key PEM concatenated, or key-only failure — try split blocks.
			return loadPEMKeyPairBlocks(data, keyPass)
		}
		return []tls.Certificate{cert}, nil
	}
	if keyPass == "" {
		keyPass = storePass
	}
	priv, cert, err := pkcs12.Decode(data, storePass)
	if err != nil {
		// Some stores use key password separately; try keyPass.
		if keyPass != storePass {
			priv, cert, err = pkcs12.Decode(data, keyPass)
		}
		if err != nil {
			return nil, fmt.Errorf("keystore PKCS12 decode: %w", err)
		}
	}
	_ = keyPass
	tlsCert := tls.Certificate{
		Certificate: [][]byte{cert.Raw},
		PrivateKey:  priv,
		Leaf:        cert,
	}
	return []tls.Certificate{tlsCert}, nil
}

func loadPEMKeyPairBlocks(data []byte, _ string) ([]tls.Certificate, error) {
	var certPEM, keyPEM []byte
	rest := data
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		switch block.Type {
		case "CERTIFICATE":
			certPEM = append(certPEM, pem.EncodeToMemory(block)...)
		case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY":
			keyPEM = append(keyPEM, pem.EncodeToMemory(block)...)
		}
	}
	if len(certPEM) == 0 || len(keyPEM) == 0 {
		return nil, fmt.Errorf("PEM keystore missing certificate or private key")
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	return []tls.Certificate{cert}, nil
}

func looksLikePEM(data []byte) bool {
	return strings.Contains(string(data), "-----BEGIN ")
}

func decodePKCS12Certs(data []byte, password string) ([]*x509.Certificate, error) {
	// Try single-cert decode first.
	_, cert, err := pkcs12.Decode(data, password)
	if err == nil && cert != nil {
		return []*x509.Certificate{cert}, nil
	}
	blocks, err2 := pkcs12.ToPEM(data, password)
	if err2 != nil {
		if err != nil {
			return nil, err
		}
		return nil, err2
	}
	var out []*x509.Certificate
	for _, b := range blocks {
		if b.Type != "CERTIFICATE" {
			continue
		}
		c, err := x509.ParseCertificate(b.Bytes)
		if err != nil {
			continue
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no certificates in PKCS12")
	}
	return out, nil
}

// ClassifyVerifyError maps x509.UnknownAuthorityError / HostnameError / etc.
func ClassifyVerifyError(err error) string {
	if err == nil {
		return ""
	}
	switch err.(type) {
	case x509.HostnameError:
		return reasons.TLSHostnameFailure
	case x509.UnknownAuthorityError, x509.CertificateInvalidError:
		return reasons.TLSChainFailure
	default:
		return TLSFailure(err)
	}
}
